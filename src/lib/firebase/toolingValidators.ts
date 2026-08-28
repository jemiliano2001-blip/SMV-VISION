import type { Timestamp } from 'firebase/firestore';
import type { ToolingPurchaseItem, ToolingCategory, IsoMaterialGroup } from '../tooling/types';

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
function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const p = Number.parseFloat(v);
    return Number.isNaN(p) ? fallback : p;
  }
  return fallback;
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

const VALID_CATEGORIES: ToolingCategory[] = [
  'inserto_torneado',
  'inserto_fresado',
  'inserto_roscado',
  'inserto_ranurado',
  'endmill',
  'porta_torno',
  'cono_fresadora',
  'boquilla_collet',
  'broca',
  'machuelo',
  'refaccion_torx',
];

function categoryOf(v: unknown): ToolingCategory {
  return VALID_CATEGORIES.includes(v as ToolingCategory) ? (v as ToolingCategory) : 'inserto_torneado';
}

export function normalizeToolingPurchaseItem(id: string, raw: unknown): ToolingPurchaseItem | null {
  if (!isPlainObject(raw) || typeof id !== 'string' || id.length === 0) return null;
  if (!isNonEmptyString(raw.codigoISO) && !isNonEmptyString(raw.descripcion)) return null;

  return {
    id,
    codigoISO: str(raw.codigoISO, 'SIN CÓDIGO', ID_MAX),
    descripcion: str(raw.descripcion, '', STR_MAX),
    categoria: categoryOf(raw.categoria),
    marca: str(raw.marca, 'Genérico', ID_MAX),
    grado: raw.grado ? str(raw.grado, '', ID_MAX) : undefined,
    rompevirutas: raw.rompevirutas ? str(raw.rompevirutas, '', ID_MAX) : undefined,
    materialISO: (raw.materialISO as IsoMaterialGroup | 'Universal') || 'Universal',
    proveedor: str(raw.proveedor, '', ID_MAX),
    precioUnitario: num(raw.precioUnitario, 0),
    precioCaja: raw.precioCaja !== undefined ? num(raw.precioCaja, 0) : undefined,
    moneda: (raw.moneda === 'USD' ? 'USD' : 'MXN'),
    linkCompra: str(raw.linkCompra, '', STR_MAX),
    maquinaAsignada: raw.maquinaAsignada ? str(raw.maquinaAsignada, '', ID_MAX) : undefined,
    calificacion: raw.calificacion !== undefined ? num(raw.calificacion, 5) : undefined,
    rendimientoNotas: raw.rendimientoNotas ? str(raw.rendimientoNotas, '', STR_MAX) : undefined,
    stockActual: raw.stockActual !== undefined ? num(raw.stockActual, 0) : undefined,
    stockMinimo: raw.stockMinimo !== undefined ? num(raw.stockMinimo, 0) : undefined,
    createdAtUTC: ts(raw.createdAtUTC),
    updatedAtUTC: ts(raw.updatedAtUTC),
  };
}
