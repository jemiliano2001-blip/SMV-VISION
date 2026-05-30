/**
 * Validación/normalización de frontera para `workOrders` y `torneros`.
 * Mismo patrón que `toolcribValidators.ts`: documentos inválidos => null
 * (se descartan en el caller). Timestamps se normalizan a ISO UTC string.
 */

import type { Timestamp } from 'firebase/firestore';
import type { WorkOrder, WorkOrderStatus, Tornero } from '../../types';

const STR_MAX = 512;
const ID_MAX = 128;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
function str(v: unknown, fallback: string, maxLen = STR_MAX): string {
  if (typeof v !== 'string') return fallback;
  const t = v.trim();
  if (t.length === 0) return fallback;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}
function optStr(v: unknown, maxLen = STR_MAX): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function priority(v: unknown): 'URGENTE' | 'Normal' {
  return v === 'URGENTE' ? 'URGENTE' : 'Normal';
}
const VALID_STATUSES: WorkOrderStatus[] = ['pendiente', 'en_proceso', 'terminada', 'entregada'];
function statusOf(v: unknown): WorkOrderStatus {
  return VALID_STATUSES.includes(v as WorkOrderStatus) ? (v as WorkOrderStatus) : 'pendiente';
}
function hasTimestampShape(v: unknown): v is Timestamp {
  return isPlainObject(v) && typeof (v as { toDate?: unknown }).toDate === 'function';
}
function ts(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (hasTimestampShape(v)) { try { return v.toDate().toISOString(); } catch { return null; } }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function normalizeWorkOrder(id: string, raw: unknown): WorkOrder | null {
  if (!isPlainObject(raw) || typeof id !== 'string' || id.length === 0) return null;
  if (!isNonEmptyString(raw.pieza)) return null;
  return {
    id,
    poNumber: str(raw.poNumber, '', ID_MAX),
    soNumber: str(raw.soNumber, '', ID_MAX),
    otDate: str(raw.otDate, '', ID_MAX),
    customer: str(raw.customer, 'SUPRAJIT', ID_MAX),
    pieza: str(raw.pieza, '', STR_MAX),
    numeroParte: str(raw.numeroParte, '', ID_MAX),
    cantidad: str(raw.cantidad, '', ID_MAX),
    prioridad: priority(raw.prioridad),
    status: statusOf(raw.status),
    matchedPartId: optStr(raw.matchedPartId, ID_MAX),
    matchedDrawingId: optStr(raw.matchedDrawingId, ID_MAX),
    matchScore: num(raw.matchScore),
    deliveredToTornero: optStr(raw.deliveredToTornero, ID_MAX),
    deliveredAtUTC: ts(raw.deliveredAtUTC),
    deliveredByUid: optStr(raw.deliveredByUid, ID_MAX),
    dueDate: optStr(raw.dueDate, ID_MAX),
    assignedToTornero: optStr(raw.assignedToTornero, ID_MAX),
    assignedAtUTC: ts(raw.assignedAtUTC),
    finishedAtUTC: ts(raw.finishedAtUTC),
    notes: str(raw.notes, '', STR_MAX),
    sourcePdfName: str(raw.sourcePdfName, '', STR_MAX),
    archived: bool(raw.archived, false),
    createdAtUTC: ts(raw.createdAtUTC),
    updatedAtUTC: ts(raw.updatedAtUTC),
  };
}

export function normalizeTornero(id: string, raw: unknown): Tornero | null {
  if (!isPlainObject(raw) || typeof id !== 'string' || id.length === 0) return null;
  if (!isNonEmptyString(raw.name)) return null;
  const rawName = str(raw.name, '', ID_MAX);
  const name = rawName.replace(/\s+/g, ' ');
  return {
    id,
    name,
    active: bool(raw.active, true),
    createdAtUTC: ts(raw.createdAtUTC),
  };
}

/** Sanea un nombre de tornero para escritura. null => inválido. */
export function sanitizeTorneroName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(/\s+/g, ' ');
  if (t.length === 0 || t.length > 80) return null;
  return t;
}
