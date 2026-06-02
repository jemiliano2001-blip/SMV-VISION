/**
 * Lógica compartida de severidad y métricas de órdenes de trabajo.
 *
 * Extraída de WorkOrdersPanel para que el hook de resumen (rail + Inicio) y el
 * tablero de control usen exactamente el mismo cálculo, sin duplicar reglas.
 */

import type { WorkOrder, WorkOrderStatus } from '../../types';
import { daysUntilISODate } from '../age';

export type DueDateSeverity = 'overdue' | 'critical' | 'warning' | 'ok' | 'done' | 'unknown';

/** Severidad de la fecha límite de una orden según su estado. */
export function getDueDateSeverity(dueDate: string | null, status: WorkOrderStatus): DueDateSeverity {
  if (status === 'entregada') return 'done';
  if (!dueDate) return 'unknown';
  const days = daysUntilISODate(dueDate);
  if (days === null) return 'unknown';
  if (days < 0) return 'overdue';
  if (days <= 3) return 'critical';
  if (days <= 7) return 'warning';
  return 'ok';
}

/** Etiqueta legible de los días restantes hasta la fecha límite. */
export function dueDaysLabel(dueDate: string | null): string {
  if (!dueDate) return '';
  const days = daysUntilISODate(dueDate);
  if (days === null) return '';
  if (days < 0) return `Vencida hace ${Math.abs(days)}d`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `Vence en ${days}d`;
}

export interface ProdMetrics {
  avgCycleDays: number | null;
  onTimePct: number | null;
  latePct: number | null;
  inProgressCount: number;
  deliveredCount: number;
}

/** Métricas de producción a partir de las órdenes activas (no archivadas). */
export function calcMetrics(orders: WorkOrder[]): ProdMetrics {
  const active = orders.filter((o) => !o.archived);
  const inProgressCount = active.filter((o) => o.status === 'en_proceso').length;
  const delivered = active.filter((o) => o.status === 'entregada' && o.deliveredAtUTC && o.createdAtUTC);

  let avgCycleDays: number | null = null;
  let onTimePct: number | null = null;
  let latePct: number | null = null;

  if (delivered.length > 0) {
    const cycleDays = delivered.map((o) =>
      Math.max(0, Math.floor((new Date(o.deliveredAtUTC!).getTime() - new Date(o.createdAtUTC!).getTime()) / 86_400_000))
    );
    avgCycleDays = Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length);

    const withDue = delivered.filter((o) => o.dueDate);
    if (withDue.length > 0) {
      // A tiempo = entregada en o antes del fin del día límite, en hora local
      // (no UTC) para que el corte coincida con el día calendario del taller.
      const onTime = withDue.filter((o) => {
        const m = o.dueDate!.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return false;
        const dueEndLocal = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).getTime();
        return new Date(o.deliveredAtUTC!).getTime() <= dueEndLocal;
      }).length;
      onTimePct = Math.round((onTime / withDue.length) * 100);
      latePct = 100 - onTimePct;
    }
  }

  return { avgCycleDays, onTimePct, latePct, inProgressCount, deliveredCount: delivered.length };
}
