import { WorkOrderStatus } from '../../types';
import { DueDateSeverity } from '../../lib/workOrders/metrics';

export const SEVERITY_CLASSES: Record<DueDateSeverity, string> = {
  overdue:  'bg-danger/20 text-danger border-danger',
  critical: 'bg-accent/20 text-accent border-accent',
  warning:  'bg-warn/20 text-warn border-warn',
  ok:       'bg-ok/15 text-ok border-ok/60',
  done:     'bg-surface-2 text-ink-dim border-line',
  unknown:  'bg-surface-2 text-ink-dim border-line',
};

export const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  pendiente:  'PENDIENTE',
  en_proceso: 'EN PROCESO',
  terminada:  'TERMINADA',
  entregada:  'ENTREGADA',
};

export const STATUS_CHIP_CLASSES: Record<WorkOrderStatus, string> = {
  pendiente:  'bg-surface-2 text-ink-dim border border-line',
  en_proceso: 'bg-draft/20 text-draft border border-draft',
  terminada:  'bg-ok/20 text-ok border border-ok',
  entregada:  'bg-ink text-bg',
};

export const COLUMN_ACCENT: Record<WorkOrderStatus, string> = {
  pendiente:  'border-t-ink-dim',
  en_proceso: 'border-t-draft',
  terminada:  'border-t-ok',
  entregada:  'border-t-ink',
};

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtDateOnly(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-MX');
}

/**
 * Formatea una fecha de SOLO-FECHA (`YYYY-MM-DD`, ej. dueDate) sin desfase de
 * huso. `new Date("2025-06-15")` se interpreta como medianoche UTC y en MX
 * (UTC-6) se mostraría como el 14; por eso parseamos los componentes y los
 * tratamos como fecha local.
 */
export function fmtCalendarDate(iso: string | null): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return fmtDateOnly(iso);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es-MX');
}

export function oneLine(value: string | undefined | null): string {
  return (value ?? '').replace(/[\r\n]+/g, ' / ').replace(/\s+/g, ' ').trim();
}

export function norm(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
