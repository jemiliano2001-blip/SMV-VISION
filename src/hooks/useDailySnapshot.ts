import { useEffect, useRef } from 'react';
import type { WorkOrder } from '../types';
import { buildSnapshotData, getTodaySnapshot, writeSnapshot } from '../lib/firebase/metricsSnapshots';
import { log } from '../lib/log';

/**
 * Writes a daily metric snapshot once per day on first app load.
 * Called after WorkOrdersContext has its first non-empty snapshot.
 * Fire-and-forget — errors are logged but never surfaced.
 */
export function useDailySnapshot(orders: WorkOrder[], isReady: boolean): void {
  const hasCaptured = useRef(false);

  useEffect(() => {
    if (!isReady || orders.length === 0 || hasCaptured.current) return;
    hasCaptured.current = true;

    void (async () => {
      const existing = await getTodaySnapshot();
      if (!existing.ok || existing.value !== null) {
        // Already captured today (or Firestore unavailable) — skip
        return;
      }
      const data = buildSnapshotData(orders);
      const result = await writeSnapshot(data);
      if (result.ok) {
        log.info('[useDailySnapshot] snapshot captured for', data.date);
      }
    })();
  }, [isReady, orders]);
}
