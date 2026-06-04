import React, { useCallback, useMemo, useState } from 'react';
import type { Order } from '../types';
import { updateCantidad, archiveWorkOrder } from '../lib/firebase/workOrders';
import { buildDedupeKey } from '../lib/workOrders/dedupe';

function dedupeKeyOfReportOrder(order: Order): string {
  return buildDedupeKey({
    soNumber: order.orden,
    poNumber: order.poNumber ?? '',
    numeroParte: order.numero_parte ?? '',
    pieza: order.pieza,
  });
}

export interface EditModeAPI {
  editMode: boolean;
  originalResults: Order[] | null;
  excludedOrders: Array<{ order: Order; workOrderId: string | null }>;
  auditedCount: number;
  snapshotOriginalOnce: () => void;
  handleEditCantidad: (order: Order, newValue: string) => void;
  handleExcludeOrder: (order: Order) => void;
  handleRestoreOrder: (entry: { order: Order; workOrderId: string | null }) => void;
  handleRestoreAll: () => void;
  setEditMode: (v: boolean) => void;
}

export function useEditMode(
  pipeline: {
    results: Order[] | null;
    setResults: React.Dispatch<React.SetStateAction<Order[] | null>>;
  },
  options: {
    findWorkOrderId: (order: Order) => string | null;
    onDataChanged: () => void;
  },
): EditModeAPI {
  const { results, setResults } = pipeline;
  const { findWorkOrderId, onDataChanged } = options;

  const [editMode, setEditMode] = useState(false);
  const [originalResults, setOriginalResults] = useState<Order[] | null>(null);
  const [excludedOrders, setExcludedOrders] = useState<
    Array<{ order: Order; workOrderId: string | null }>
  >([]);

  const snapshotOriginalOnce = useCallback(() => {
    setOriginalResults((prev) => prev ?? (results ? [...results] : null));
  }, [results]);

  const handleEditCantidad = useCallback(
    (order: Order, nuevaCantidad: string) => {
      const clean = nuevaCantidad.trim();
      if (!clean || clean === order.cantidad) return;
      snapshotOriginalOnce();
      setResults((prev) =>
        prev ? prev.map((o) => (o === order ? { ...o, cantidad: clean } : o)) : prev,
      );
      const woId = findWorkOrderId(order);
      if (woId) {
        void (async () => {
          const res = await updateCantidad(woId, clean);
          if (res.ok === false) console.warn('[smv-vision][report-edit] updateCantidad no aplicado:', res.reason);
          else onDataChanged();
        })();
      }
    },
    [snapshotOriginalOnce, setResults, findWorkOrderId, onDataChanged],
  );

  const handleExcludeOrder = useCallback(
    (order: Order) => {
      snapshotOriginalOnce();
      const woId = findWorkOrderId(order);
      setExcludedOrders((prev) => [...prev, { order, workOrderId: woId }]);
      setResults((prev) => (prev ? prev.filter((o) => o !== order) : prev));
      if (woId) {
        void (async () => {
          const res = await archiveWorkOrder(woId, true);
          if (res.ok === false) console.warn('[smv-vision][report-edit] archive no aplicado:', res.reason);
          else onDataChanged();
        })();
      }
    },
    [snapshotOriginalOnce, setResults, findWorkOrderId, onDataChanged],
  );

  const handleRestoreOrder = useCallback(
    (entry: { order: Order; workOrderId: string | null }) => {
      setExcludedOrders((prev) => prev.filter((e) => e !== entry));
      setResults((prev) => (prev ? [...prev, entry.order] : [entry.order]));
      if (entry.workOrderId) {
        void (async () => {
          const res = await archiveWorkOrder(entry.workOrderId!, false);
          if (res.ok) onDataChanged();
        })();
      }
    },
    [setResults, onDataChanged],
  );

  const handleRestoreAll = useCallback(() => {
    const snapshot = originalResults;
    const current = results ?? [];
    const excluded = excludedOrders;
    if (snapshot) setResults(snapshot);
    setExcludedOrders([]);
    setOriginalResults(null);
    void (async () => {
      let touched = false;
      for (const e of excluded) {
        if (e.workOrderId) {
          await archiveWorkOrder(e.workOrderId, false);
          touched = true;
        }
      }
      if (snapshot) {
        const currentByKey = new Map(
          current.map((o) => [dedupeKeyOfReportOrder(o), o.cantidad] as const),
        );
        for (const o of snapshot) {
          const key = dedupeKeyOfReportOrder(o);
          if (currentByKey.has(key) && currentByKey.get(key) !== o.cantidad) {
            const woId = findWorkOrderId(o);
            if (woId) {
              await updateCantidad(woId, o.cantidad);
              touched = true;
            }
          }
        }
      }
      if (touched) onDataChanged();
    })();
  }, [originalResults, results, excludedOrders, setResults, findWorkOrderId, onDataChanged]);

  const auditedCount = useMemo(
    () => (results ? results.filter((r) => r.haSidoAuditada).length : 0),
    [results],
  );

  return {
    editMode, originalResults, excludedOrders, auditedCount,
    snapshotOriginalOnce, handleEditCantidad, handleExcludeOrder,
    handleRestoreOrder, handleRestoreAll, setEditMode,
  };
}
