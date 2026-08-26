import { useEffect, useMemo, useState } from 'react';
import {
  subscribeToOdooSyncMeta,
  type OdooSyncMeta,
} from '../lib/firebase/syncMeta';

export interface UseSyncMetaResult {
  meta: OdooSyncMeta | null;
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

  useEffect(() => subscribeToOdooSyncMeta(setMeta), []);

  const totalToInvoiceOrders = useMemo(() => {
    if (!meta || !meta.partners) return 0;
    return meta.partners.reduce((sum, p) => sum + p.toInvoiceCount, 0);
  }, [meta]);

  const partnersCount = meta?.partners?.length ?? 0;
  const isError = meta?.status === 'error';
  const effectiveLastSyncDate = meta?.lastSuccessfulSyncAt ?? meta?.lastSyncAt ?? null;

  const isStale = useMemo(() => {
    if (!effectiveLastSyncDate) return false;
    const diffMinutes = (Date.now() - effectiveLastSyncDate.getTime()) / (1000 * 60);
    return diffMinutes > 35;
  }, [effectiveLastSyncDate]);

  return {
    meta,
    isStale,
    isError,
    totalToInvoiceOrders,
    partnersCount,
    effectiveLastSyncDate,
  };
}
