import type { Timestamp } from 'firebase/firestore';
import type { PurchaseItem, PurchaseItemType } from '../../types';

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

const VALID_TYPES: PurchaseItemType[] = ['metal', 'ensamble', 'herramienta', 'otro'];
function typeOf(v: unknown): PurchaseItemType {
  return VALID_TYPES.includes(v as PurchaseItemType) ? (v as PurchaseItemType) : 'otro';
}

export function normalizePurchaseItem(id: string, raw: unknown): PurchaseItem | null {
  if (!isPlainObject(raw) || typeof id !== 'string' || id.length === 0) return null;
  if (!isNonEmptyString(raw.nombre)) return null;
  return {
    id,
    nombre: str(raw.nombre, '', STR_MAX),
    tipo: typeOf(raw.tipo),
    sku: str(raw.sku, '', ID_MAX),
    proveedor: str(raw.proveedor, '', ID_MAX),
    link: str(raw.link, '', STR_MAX),
    notas: str(raw.notas, '', STR_MAX),
    createdAtUTC: ts(raw.createdAtUTC),
    updatedAtUTC: ts(raw.updatedAtUTC),
  };
}
