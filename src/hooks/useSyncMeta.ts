import { useEffect, useState } from 'react';
import {
  subscribeToOdooSyncMeta,
  type OdooSyncMeta,
} from '../lib/firebase/syncMeta';

/**
 * Subscribes to the syncMeta/odoo document and returns the latest value.
 * meta === null means Firebase is not configured, the function has never run,
 * or the first snapshot hasn't arrived yet — all three cases render nothing.
 */
export function useSyncMeta(): { meta: OdooSyncMeta | null } {
  const [meta, setMeta] = useState<OdooSyncMeta | null>(null);

  useEffect(() => subscribeToOdooSyncMeta(setMeta), []);

  return { meta };
}
