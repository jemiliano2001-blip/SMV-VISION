/**
 * useDashboardSummary
 *
 * Lectura ligera y de solo-lectura de las órdenes de trabajo para alimentar:
 *  - los badges del rail de navegación (pendientes, vencidas),
 *  - la portada "Inicio" (KPIs, lista de atención inmediata).
 *
 * Es independiente del estado interactivo de `WorkOrdersPanel` (que mantiene su
 * propia copia autoritativa para las mutaciones). Expone `refresh()` para que
 * Inicio/Control puedan revalidar tras un cambio. Nunca lanza: degrada a 0s.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { WorkOrder } from '../types';
import { listWorkOrders } from './firebase/workOrders';
import { calcMetrics, getDueDateSeverity, type ProdMetrics } from './workOrders/metrics';

export type DashboardStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DashboardCounts {
  overdue: number;
  critical: number;
  warning: number;
  urgent: number;
  pendiente: number;
  enProceso: number;
  terminada: number;
  entregada: number;
  activeTotal: number;
}

export interface DashboardSummary {
  status: DashboardStatus;
  /** Disponible solo cuando status === 'error'. */
  reason: 'not-configured' | 'not-authenticated' | 'error' | null;
  orders: WorkOrder[];
  counts: DashboardCounts;
  metrics: ProdMetrics;
  /** Órdenes que requieren atención (vencidas/críticas), ordenadas por urgencia. */
  attention: WorkOrder[];
}

const EMPTY_COUNTS: DashboardCounts = {
  overdue: 0, critical: 0, warning: 0, urgent: 0,
  pendiente: 0, enProceso: 0, terminada: 0, entregada: 0, activeTotal: 0,
};

const EMPTY_METRICS: ProdMetrics = {
  avgCycleDays: null, onTimePct: null, latePct: null, inProgressCount: 0, deliveredCount: 0,
};

export function useDashboardSummary(): { summary: DashboardSummary; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<DashboardStatus>('idle');
  const [reason, setReason] = useState<DashboardSummary['reason']>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);

  const refresh = useCallback(async () => {
    setStatus((prev) => (prev === 'idle' ? 'loading' : prev));
    const res = await listWorkOrders();
    if (res.ok === false) {
      setStatus('error');
      setReason(res.reason === 'not-configured' || res.reason === 'not-authenticated' ? res.reason : 'error');
      setOrders([]);
      return;
    }
    setReason(null);
    setOrders(res.value);
    setStatus('ready');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo<DashboardCounts>(() => {
    const active = orders.filter((o) => !o.archived);
    const openForAlerts = active.filter((o) => o.status !== 'entregada');
    return {
      overdue: openForAlerts.filter((o) => getDueDateSeverity(o.dueDate, o.status) === 'overdue').length,
      critical: openForAlerts.filter((o) => getDueDateSeverity(o.dueDate, o.status) === 'critical').length,
      warning: openForAlerts.filter((o) => getDueDateSeverity(o.dueDate, o.status) === 'warning').length,
      urgent: openForAlerts.filter((o) => o.prioridad === 'URGENTE').length,
      pendiente: active.filter((o) => o.status === 'pendiente').length,
      enProceso: active.filter((o) => o.status === 'en_proceso').length,
      terminada: active.filter((o) => o.status === 'terminada').length,
      entregada: active.filter((o) => o.status === 'entregada').length,
      activeTotal: active.length,
    };
  }, [orders]);

  const metrics = useMemo(() => calcMetrics(orders), [orders]);

  const attention = useMemo(() => {
    const sevRank: Record<string, number> = { overdue: 0, critical: 1, warning: 2 };
    return orders
      .filter((o) => !o.archived && o.status !== 'entregada')
      .map((o) => ({ o, sev: getDueDateSeverity(o.dueDate, o.status) }))
      .filter(({ sev }) => sev === 'overdue' || sev === 'critical' || sev === 'warning')
      .sort((a, b) => {
        if (a.sev !== b.sev) return sevRank[a.sev] - sevRank[b.sev];
        return (a.o.dueDate ?? '').localeCompare(b.o.dueDate ?? '');
      })
      .map(({ o }) => o);
  }, [orders]);

  const summary = useMemo<DashboardSummary>(
    () => ({
      status,
      reason,
      orders,
      counts: status === 'ready' ? counts : EMPTY_COUNTS,
      metrics: status === 'ready' ? metrics : EMPTY_METRICS,
      attention: status === 'ready' ? attention : [],
    }),
    [status, reason, orders, counts, metrics, attention],
  );

  return { summary, refresh };
}
