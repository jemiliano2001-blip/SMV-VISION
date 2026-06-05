import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import type { WorkOrder } from '../../types';
import { getFirestoreClient } from './client';
import { calcMetrics, getDueDateSeverity } from '../workOrders/metrics';
import { log } from '../log';

const COLLECTION = 'dailyMetricSnapshots';

export interface DailyMetricSnapshot {
  date: string;
  onTimePercent: number | null;
  totalActive: number;
  overdueCount: number;
  criticalCount: number;
  byStage: Record<string, number>;
  byTornero: Record<string, number>;
}

type SnapshotResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Pure — computes snapshot data from current orders. No Firebase I/O. */
export function buildSnapshotData(orders: WorkOrder[]): DailyMetricSnapshot {
  const today = new Date().toISOString().slice(0, 10);
  const active = orders.filter((o) => !o.archived);
  const metrics = calcMetrics(orders);

  const byStage: Record<string, number> = {
    pendiente: 0, en_proceso: 0, terminada: 0, entregada: 0,
  };
  for (const o of active) {
    byStage[o.status] = (byStage[o.status] ?? 0) + 1;
  }

  const byTornero: Record<string, number> = {};
  for (const o of active.filter((o) => o.status !== 'entregada')) {
    const key = o.assignedToTornero ?? '__unassigned__';
    byTornero[key] = (byTornero[key] ?? 0) + 1;
  }

  const overdueCount = active.filter(
    (o) => getDueDateSeverity(o.dueDate, o.status) === 'overdue',
  ).length;
  const criticalCount = active.filter(
    (o) => getDueDateSeverity(o.dueDate, o.status) === 'critical',
  ).length;

  return {
    date: today,
    onTimePercent: metrics.onTimePct,
    totalActive: active.length,
    overdueCount,
    criticalCount,
    byStage,
    byTornero,
  };
}

/** Returns today's snapshot if it exists, null if it doesn't. */
export async function getTodaySnapshot(): Promise<SnapshotResult<DailyMetricSnapshot | null>> {
  const database = getFirestoreClient();
  if (!database) return { ok: false, reason: 'not-configured' };
  const today = new Date().toISOString().slice(0, 10);
  try {
    const snap = await getDoc(doc(database, COLLECTION, today));
    if (!snap.exists()) return { ok: true, value: null };
    return { ok: true, value: snap.data() as DailyMetricSnapshot };
  } catch (err) {
    log.warn('[metricsSnapshots] getTodaySnapshot failed', err);
    return { ok: false, reason: 'read-failed' };
  }
}

/** Writes today's snapshot. Overwrites if called more than once in a day. */
export async function writeSnapshot(data: DailyMetricSnapshot): Promise<SnapshotResult<void>> {
  const database = getFirestoreClient();
  if (!database) return { ok: false, reason: 'not-configured' };
  try {
    await setDoc(doc(database, COLLECTION, data.date), {
      ...data,
      capturedAt: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (err) {
    log.warn('[metricsSnapshots] writeSnapshot failed', err);
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * Returns up to n * 7 snapshots (n weeks), in chronological order.
 */
export async function getSnapshotsLastWeeks(
  n: number,
): Promise<SnapshotResult<DailyMetricSnapshot[]>> {
  const database = getFirestoreClient();
  if (!database) return { ok: false, reason: 'not-configured' };
  try {
    const q = query(
      collection(database, COLLECTION),
      orderBy('date', 'desc'),
      limit(n * 7),
    );
    const snap = await getDocs(q);
    const results: DailyMetricSnapshot[] = [];
    snap.forEach((d) => results.push(d.data() as DailyMetricSnapshot));
    return { ok: true, value: results.reverse() };
  } catch (err) {
    log.warn('[metricsSnapshots] getSnapshotsLastWeeks failed', err);
    return { ok: false, reason: 'read-failed' };
  }
}
