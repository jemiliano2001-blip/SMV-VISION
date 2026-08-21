/**
 * Estado de sesión del puente orden↔plano.
 * Resolve puro en `lib/orderDrawingBridge.ts`; este hook solo guarda el Map.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyManualDrawingToLink,
  getCadDrawingSnapshot,
  getReportDrawingSnapshot,
  makeOrderDrawingLinkKey,
  resolveOrderDrawingLink,
  type ResolveOrderDrawingInput,
  viewFromSnapshot,
} from '../lib/orderDrawingBridge';
import type { PieceMatchSignals } from '../lib/matching';
import { listPartAliases, savePartAlias, type PartAliasDoc } from '../lib/firebase/aliases';
import type { OrderDrawingLink, ToolcribActiveDrawingView } from '../types';

export interface UseOrderDrawingBridgeResult {
  links: Readonly<Record<string, OrderDrawingLink>>;
  linkList: readonly OrderDrawingLink[];
  pendingKey: string | null;
  aliases: readonly PartAliasDoc[];
  resolveAndStore: (
    input: ResolveOrderDrawingInput,
    library: readonly ToolcribActiveDrawingView[],
    signalsByDrawingId?: ReadonlyMap<string, PieceMatchSignals>,
  ) => OrderDrawingLink;
  upsertManual: (key: string, view: ToolcribActiveDrawingView) => OrderDrawingLink | null;
  removeLink: (key: string) => void;
  getLink: (key: string) => OrderDrawingLink | undefined;
  clear: () => void;
  setPendingKey: (key: string | null) => void;
  /** Vista CAD lista para ToolcribPrintModal, o null. */
  getCadViewForPrint: (link: OrderDrawingLink) => ToolcribActiveDrawingView | null;
  /** Snapshot a adjuntar al reporte, o null. */
  getReportSnapshot: (link: OrderDrawingLink) => ReturnType<typeof getReportDrawingSnapshot>;
}

export function useOrderDrawingBridge(): UseOrderDrawingBridgeResult {
  const [links, setLinks] = useState<Record<string, OrderDrawingLink>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [aliases, setAliases] = useState<PartAliasDoc[]>([]);

  useEffect(() => {
    let alive = true;
    void listPartAliases().then((res) => {
      if (alive && res.ok) {
        setAliases(res.value);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const resolveAndStore = useCallback(
    (
      input: ResolveOrderDrawingInput,
      library: readonly ToolcribActiveDrawingView[],
      signalsByDrawingId?: ReadonlyMap<string, PieceMatchSignals>,
    ): OrderDrawingLink => {
      const link = resolveOrderDrawingLink(
        input,
        library,
        signalsByDrawingId,
        undefined,
        aliases,
      );
      setLinks((prev) => ({ ...prev, [link.key]: link }));
      return link;
    },
    [aliases],
  );

  const upsertManual = useCallback(
    (key: string, view: ToolcribActiveDrawingView): OrderDrawingLink | null => {
      let next: OrderDrawingLink | null = null;
      setLinks((prev) => {
        const base = prev[key];
        if (!base) return prev;
        next = applyManualDrawingToLink(base, view);

        // Guardar alias en Firestore para recordar el match en el futuro
        // El número de parte es la identidad más estable; si no existe,
        // guardamos la descripción completa, nunca una coincidencia parcial.
        const pattern = (base.numeroParte || base.pieza || '').trim();
        if (pattern) {
          void savePartAlias({
            pattern,
            partNumber: view.partNumber,
            drawingId: view.drawingId,
          }).then((res) => {
            if (res.ok) {
              setAliases((cur) => [
                ...cur.filter((a) => a.pattern.toUpperCase() !== pattern.toUpperCase()),
                {
                  id: res.value.id,
                  pattern,
                  partNumber: view.partNumber,
                  drawingId: view.drawingId,
                  createdAtUTC: new Date().toISOString(),
                  createdByUid: null,
                },
              ]);
            }
          });
        }

        return { ...prev, [key]: next };
      });
      return next;
    },
    [],
  );

  const removeLink = useCallback((key: string) => {
    setLinks((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
    setPendingKey((pk) => (pk === key ? null : pk));
  }, []);

  const getLink = useCallback(
    (key: string): OrderDrawingLink | undefined => links[key],
    [links],
  );

  const clear = useCallback(() => {
    setLinks({});
    setPendingKey(null);
  }, []);

  const getCadViewForPrint = useCallback((link: OrderDrawingLink) => {
    const snap = getCadDrawingSnapshot(link);
    return snap ? viewFromSnapshot(snap) : null;
  }, []);

  const getReportSnapshot = useCallback(
    (link: OrderDrawingLink) => getReportDrawingSnapshot(link),
    [],
  );

  const linkList = useMemo(() => Object.values(links), [links]);

  return {
    links,
    linkList,
    pendingKey,
    aliases,
    resolveAndStore,
    upsertManual,
    removeLink,
    getLink,
    clear,
    setPendingKey,
    getCadViewForPrint,
    getReportSnapshot,
  };
}

export { makeOrderDrawingLinkKey };
