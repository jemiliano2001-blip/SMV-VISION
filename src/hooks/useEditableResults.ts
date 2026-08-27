import { useCallback, useState } from 'react';
import type { BoundingBox, Order } from '../types';
import { applyOrderCrop } from '../lib/orderCrop';

export interface UseEditableResultsOptions {
  results: Order[] | null;
  setResults: React.Dispatch<React.SetStateAction<Order[] | null>>;
}

export function useEditableResults({ results, setResults }: UseEditableResultsOptions) {
  // `editMode` activa la edición inline sobre la hoja. `originalResults` es el
  // snapshot para "Restaurar todo" (capturado perezosamente en la 1ª mutación).
  // `excludedOrders` son las órdenes excluidas (soft-delete reversible).
  const [editMode, setEditMode] = useState(false);
  const [originalResults, setOriginalResults] = useState<Order[] | null>(null);
  const [excludedOrders, setExcludedOrders] = useState<Array<{ order: Order }>>([]);

  const snapshotOriginalOnce = useCallback(() => {
    setOriginalResults((prev) => prev ?? (results ? [...results] : null));
  }, [results]);

  const handleEditCantidad = useCallback(
    (order: Order, nuevaCantidad: string) => {
      const clean = nuevaCantidad.trim();
      if (!clean || clean === order.cantidad) return;
      snapshotOriginalOnce();
      setResults((prev) => (prev ? prev.map((o) => (o === order ? { ...o, cantidad: clean } : o)) : prev));
    },
    [snapshotOriginalOnce, setResults],
  );

  const handleExcludeOrder = useCallback(
    (order: Order) => {
      snapshotOriginalOnce();
      setExcludedOrders((prev) => [...prev, { order }]);
      setResults((prev) => (prev ? prev.filter((o) => o !== order) : prev));
    },
    [snapshotOriginalOnce, setResults],
  );

  const handleRestoreOrder = useCallback(
    (entry: { order: Order }) => {
      setExcludedOrders((prev) => prev.filter((e) => e !== entry));
      setResults((prev) => (prev ? [...prev, entry.order] : [entry.order]));
    },
    [setResults],
  );

  const handleRestoreAll = useCallback(() => {
    const snapshot = originalResults;
    if (snapshot) setResults(snapshot);
    setExcludedOrders([]);
    setOriginalResults(null);
  }, [originalResults, setResults]);

  const handleUpdateOrderCrop = useCallback(
    (target: Order, newBox: BoundingBox, newCroppedUrl: string) => {
      snapshotOriginalOnce();
      setResults((prev) => applyOrderCrop(prev, target, newBox, newCroppedUrl));
    },
    [snapshotOriginalOnce, setResults],
  );

  return {
    editMode,
    setEditMode,
    originalResults,
    setOriginalResults,
    excludedOrders,
    setExcludedOrders,
    snapshotOriginalOnce,
    handleEditCantidad,
    handleExcludeOrder,
    handleRestoreOrder,
    handleRestoreAll,
    handleUpdateOrderCrop,
  };
}
