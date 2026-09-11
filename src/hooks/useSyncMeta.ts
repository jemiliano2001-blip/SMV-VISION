import { useEffect, useMemo, useState } from 'react';
import {
  subscribeToOdooSyncMeta,
  type OdooSyncMeta,
  type OdooSyncMetaState,
} from '../lib/firebase/syncMeta';

export interface UseSyncMetaResult {
  meta: OdooSyncMeta | null;
  state: OdooSyncMetaState;
  isStale: boolean;
  isError: boolean;
  totalToInvoiceOrders: number;
  partnersCount: number;
  effectiveLastSyncDate: Date | null;
}

/**
 * Subscribes to the syncMeta/odoo document and returns the latest value and derived health metrics.
 * meta === null means Firebase is not configured, the function has never run,
 * or the first snapshot hasn't arrived yet.
 */
export function useSyncMeta(): UseSyncMetaResult {
  const [meta, setMeta] = useState<OdooSyncMeta | null>(null);
  const [state, setState] = useState<OdooSyncMetaState>('loading');

  useEffect(
    () => subscribeToOdooSyncMeta((nextMeta, nextState) => {
      setMeta(nextMeta);
      setState(nextState);
    }),
    [],
  );

  const totalToInvoiceOrders = useMemo(() => {
    if (!meta || !meta.partners) return 0;
    return meta.partners.reduce((sum, p) => sum + p.toInvoiceCount, 0);
  }, [meta]);

  const partnersCount = meta?.partners?.length ?? 0;
  const isError = state === 'error' || meta?.status === 'error';
  const effectiveLastSyncDate = meta?.lastSuccessfulSyncAt ?? meta?.lastSyncAt ?? null;

  const isStale = useMemo(() => {
    if (!effectiveLastSyncDate) return false;
    const diffMinutes = (Date.now() - effectiveLastSyncDate.getTime()) / (1000 * 60);
    return diffMinutes > 35;
  }, [effectiveLastSyncDate]);

  return {
    meta,
    state,
    isStale,
    isError,
    totalToInvoiceOrders,
    partnersCount,
    effectiveLastSyncDate,
  };
}
