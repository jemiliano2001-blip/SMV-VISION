/**
 * Helpers de presentación para el PDF de reporte de órdenes.
 *
 * Todo aquí es puramente de formato del PDF — no toca el modelo de datos, el
 * panel de control ni Firestore. Cubre:
 *   - fecha de entrega (fecha de orden + ciclo) y su severidad/etiqueta
 *   - limpieza del nombre de pieza (prefijo de cliente repetitivo)
 *   - colapso de renglones visualmente idénticos en "×N"
 *   - resumen agregado para la banda del encabezado
 */

import type { Order } from '../types';
import { normalizePieceLabel } from './matching';
import { parseCantidadNumber, extractCantidadUnit } from './orderMerge';
import { parseDateToISO, addDaysToISODate, daysUntilISODate } from './age';

/** Ciclo estándar de producción (mismo valor que `DEFAULT_CYCLE_DAYS` en workOrders). */
export const REPORT_CYCLE_DAYS = 14;

export type DueSeverity = 'overdue' | 'critical' | 'warning' | 'ok' | 'unknown';

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Quita un prefijo de cliente entre paréntesis al inicio del nombre
 * ("(WESCON) SQUARE SWAGE BLOCK" → "SQUARE SWAGE BLOCK"). Solo afecta el
 * prefijo inicial; menciones a media frase ("… (wescon) …") se conservan.
 */
export function cleanPieceName(pieza: string): string {
  const stripped = pieza.replace(/^\s*\(\s*WESCON\s*\)\s*/i, '').trim();
  return stripped.length > 0 ? stripped : pieza.trim();
}

/**
 * Agrega el número de parte al nombre mostrado si no está ya contenido en él.
 * Sin esto, piezas distintas con descripción genérica ("Fabricación de pieza",
 * "WESCON PIN DE REMACHE", "BLOCKS") se ven idénticas en el reporte aunque
 * tengan códigos de parte diferentes (WCD03-1797-02 vs -03, etc.).
 */
export function withPartNumber(pieza: string, numeroParte?: string): string {
  const np = (numeroParte ?? '').trim();
  if (!np) return pieza;
  const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normNp = norm(np);
  if (normNp.length === 0 || norm(pieza).includes(normNp)) return pieza;
  return `${pieza}  ·  ${np}`;
}

/**
 * Fecha de entrega = fecha de orden más vieja + ciclo (14d). `null` si ninguna
 * línea es parseable.
 *
 * Un renglón puede juntar varias OTs (fechas multi-línea, ej. "13/05\n20/05\n
 * 28/05"). Se usa la MÁS VIEJA porque marca el compromiso más urgente: si esa
 * ya venció, el renglón debe verse como vencido aunque otras OTs estén al día.
 */
export function computeDueDate(order: Order): string | null {
  const lines = (order.fecha || '').split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
  let earliest: string | null = null;
  for (const line of lines) {
    const iso = parseDateToISO(line);
    // Las fechas ISO `YYYY-MM-DD` se comparan lexicográficamente = cronológicamente.
    if (iso && (earliest === null || iso < earliest)) earliest = iso;
  }
  return earliest ? addDaysToISODate(earliest, REPORT_CYCLE_DAYS) : null;
}

/** Severidad de la fecha de entrega (mismos umbrales que el panel de control). */
export function dueSeverity(dueDate: string | null): DueSeverity {
  if (!dueDate) return 'unknown';
  const d = daysUntilISODate(dueDate);
  if (d === null) return 'unknown';
  if (d < 0) return 'overdue';
  if (d <= 3) return 'critical';
  if (d <= 7) return 'warning';
  return 'ok';
}

/** Etiqueta corta de días hasta la entrega ("Vencida 5d", "Vence hoy", "Vence en 9d"). */
export function dueLabel(dueDate: string | null): string {
  if (!dueDate) return '';
  const d = daysUntilISODate(dueDate);
  if (d === null) return '';
  if (d < 0) return `Vencida ${Math.abs(d)}d`;
  if (d === 0) return 'Vence hoy';
  if (d === 1) return 'Vence mañana';
  return `Vence en ${d}d`;
}

/** Convierte una fecha ISO `YYYY-MM-DD` a `DD/MM/YYYY` para mostrar. */
export function fmtISOToDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Clave de ordenamiento por urgencia: días hasta la entrega (lo más vencido
 * primero). Órdenes sin fecha parseable van al final (+Infinity).
 */
export function dueDaysOrInfinity(order: Order): number {
  const due = computeDueDate(order);
  const d = due ? daysUntilISODate(due) : null;
  return d === null ? Number.POSITIVE_INFINITY : d;
}

/**
 * Colapsa renglones visualmente idénticos (mismo nombre, cantidad, SO y fecha)
 * en uno solo con sufijo "×N" y la cantidad sumada. Pensado para la sección de
 * pendientes, donde el extractor a veces produce varias líneas indistinguibles
 * (ej. "Fabricación de pieza" ×5 con el mismo SO). Mantiene orden de aparición.
 */
export function collapseDuplicateOrders(orders: Order[]): Order[] {
  const groups = new Map<string, Order[]>();
  const sigOrder: string[] = [];
  for (const o of orders) {
    // Incluye numero_parte en la firma: piezas con descripción idéntica pero
    // distinto código de parte (ej. "Fabricación de pieza" WCD03-1797-02 vs -03)
    // NO deben colapsarse — son piezas distintas que el extractor nombró igual.
    const sig = [
      normalizePieceLabel(o.pieza),
      (o.numero_parte ?? '').trim().toUpperCase(),
      o.cantidad.trim(),
      o.orden.trim(),
      o.fecha.trim(),
    ].join('||');
    if (!groups.has(sig)) {
      groups.set(sig, []);
      sigOrder.push(sig);
    }
    groups.get(sig)!.push(o);
  }

  const result: Order[] = [];
  for (const sig of sigOrder) {
    const g = groups.get(sig)!;
    if (g.length === 1) {
      result.push(g[0]);
      continue;
    }
    const base = g[0];
    const n = g.length;
    const qty = parseCantidadNumber(base.cantidad);
    let cantidad = base.cantidad;
    if (qty !== null) {
      const unit = extractCantidadUnit(base.cantidad);
      const total = qty * n;
      cantidad = unit ? `${formatNum(total)}\n${unit}` : formatNum(total);
    }
    result.push({ ...base, pieza: `${base.pieza} ×${n}`, cantidad });
  }
  return result;
}

export interface ReportSummary {
  renglones: number;
  urgentes: number;
  vencidas: number;
  criticas: number;
  totalPiezas: number;
}

/** Agrega métricas para la banda de resumen del encabezado. */
export function summarizeOrders(orders: Order[]): ReportSummary {
  let urgentes = 0;
  let vencidas = 0;
  let criticas = 0;
  let totalPiezas = 0;
  for (const o of orders) {
    if (o.prioridad === 'URGENTE') urgentes += 1;
    const sev = dueSeverity(computeDueDate(o));
    if (sev === 'overdue') vencidas += 1;
    else if (sev === 'critical') criticas += 1;
    const q = parseCantidadNumber(o.cantidad);
    if (q !== null) totalPiezas += q;
  }
  return { renglones: orders.length, urgentes, vencidas, criticas, totalPiezas };
}
