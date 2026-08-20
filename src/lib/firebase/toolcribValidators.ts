/**
 * Validación de frontera para el dominio Tool Crib (catálogo documental).
 *
 * Principios (ver user_rules):
 * - Tipado estricto: sin `any`, sin `@ts-ignore`.
 * - Los datos que cruzan la frontera (Firestore -> UI y UI -> Firestore)
 *   pasan SIEMPRE por una normalización explícita.
 * - Timestamps: los documentos guardan siempre UTC (`serverTimestamp()` al
 *   escribir, `Timestamp` al leer). El formateo local es responsabilidad del
 *   componente de UI, no de esta capa.
 * - Trazabilidad: los `printLogs` no aceptan suplantación de `printedByUid`;
 *   el writer lo resuelve siempre desde el Auth activo.
 */

import type { Timestamp } from 'firebase/firestore';

/** Estado lógico de una parte en el catálogo. */
export type ToolcribPartStatus = 'active' | 'archived';

/** Origen físico del PDF maestro de un plano. */
export type ToolcribDrawingSourceType = 'network' | 'storage';

/** Origen de registro de impresión (para distinguir canales futuros). */
export type ToolcribPrintOrigin = 'toolcrib-v1-ui';

/** Forma canónica de una parte en el catálogo Tool Crib. */
export interface ToolcribPart {
  id: string;
  partNumber: string;
  customer: string;
  description: string;
  status: ToolcribPartStatus;
  /** ISO 8601 en UTC, normalizado en cliente a partir del Timestamp de Firestore. */
  createdAtUTC: string | null;
  updatedAtUTC: string | null;
}

/** Forma canónica de una revisión de plano para una parte. */
export interface ToolcribDrawing {
  id: string;
  partId: string;
  revision: string;
  isActive: boolean;
  sourceType: ToolcribDrawingSourceType;
  /** Ruta física (UNC para `network`, ruta relativa en Storage para `storage`). */
  sourcePath: string;
  /** URL HTTP(S) accesible desde navegador (opcional). */
  pdfUrl: string | null;
  /**
   * URL del STL exportado desde eDrawings (opcional). Usado por el visor 3D
   * en Biblioteca; null si la revisión no tiene malla.
   */
  stlUrl: string | null;
  /** Hash SHA-256 del contenido del PDF maestro (opcional, recomendado). */
  checksumSha256: string | null;
  effectiveFromUTC: string | null;
  createdAtUTC: string | null;
  createdByUid: string | null;
}

export interface ToolcribPrintLogInput {
  drawingId: string;
  partId: string;
  copies: number;
  orderRef: string | null;
}

export interface ValidatedToolcribPrintLogInput extends ToolcribPrintLogInput {
  origin: ToolcribPrintOrigin;
}

export type ValidationIssue = { path: string; message: string };

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

const PART_NUMBER_MAX_LEN = 128;
const CUSTOMER_MAX_LEN = 128;
const DESCRIPTION_MAX_LEN = 512;
const REVISION_MAX_LEN = 32;
const SOURCE_PATH_MAX_LEN = 1024;
const URL_MAX_LEN = 2048;
const CHECKSUM_LEN = 64;
const UID_MAX_LEN = 128;
const ORDER_REF_MAX_LEN = 128;
const DRAWING_ID_MAX_LEN = 128;
const PART_ID_MAX_LEN = 128;
const COPIES_MIN = 1;
const COPIES_MAX = 50;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasTimestampShape(value: unknown): value is Timestamp {
  if (!isPlainObject(value)) {
    return false;
  }
  const candidate = value as { toDate?: unknown };
  return typeof candidate.toDate === 'function';
}

function normalizeTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (hasTimestampShape(value)) {
    try {
      return value.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) {
      return null;
    }
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = new Date(trimmed);
    const time = parsed.getTime();
    if (Number.isNaN(time)) {
      return null;
    }
    return parsed.toISOString();
  }
  return null;
}

function normalizeStatus(value: unknown): ToolcribPartStatus {
  return value === 'archived' ? 'archived' : 'active';
}

function normalizeSourceType(value: unknown): ToolcribDrawingSourceType {
  return value === 'storage' ? 'storage' : 'network';
}

function readStringOr<T extends string>(value: unknown, fallback: T, maxLen: number): string | T {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return fallback;
    }
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
  }
  return fallback;
}

function readOptionalString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function readChecksum(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Normaliza un documento crudo de `toolcribParts` a la forma canónica
 * consumida por la UI. Los documentos inválidos devuelven `null` y se
 * descartan en el caller (nunca se muestran datos parciales).
 */
export function normalizeToolcribPart(
  id: string,
  raw: unknown,
): ToolcribPart | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  if (!isNonEmptyString(raw.partNumber)) {
    return null;
  }

  const partNumber = readStringOr(raw.partNumber, '', PART_NUMBER_MAX_LEN);
  if (!partNumber) {
    return null;
  }

  return {
    id,
    partNumber,
    customer: readStringOr(raw.customer, 'SUPRAJIT', CUSTOMER_MAX_LEN),
    description: readStringOr(raw.description, '', DESCRIPTION_MAX_LEN),
    status: normalizeStatus(raw.status),
    createdAtUTC: normalizeTimestamp(raw.createdAtUTC),
    updatedAtUTC: normalizeTimestamp(raw.updatedAtUTC),
  };
}

/**
 * Normaliza un documento crudo de `toolcribDrawings` a la forma canónica.
 */
export function normalizeToolcribDrawing(
  id: string,
  raw: unknown,
): ToolcribDrawing | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  if (!isNonEmptyString(raw.partId) || !isNonEmptyString(raw.revision)) {
    return null;
  }

  const partId = readStringOr(raw.partId, '', PART_ID_MAX_LEN);
  const revision = readStringOr(raw.revision, '', REVISION_MAX_LEN);
  const sourcePath = readStringOr(raw.sourcePath, '', SOURCE_PATH_MAX_LEN);
  if (!partId || !revision) {
    return null;
  }

  return {
    id,
    partId,
    revision,
    isActive: readBoolean(raw.isActive, false),
    sourceType: normalizeSourceType(raw.sourceType),
    sourcePath,
    pdfUrl: readOptionalString(raw.pdfUrl, URL_MAX_LEN),
    stlUrl: readOptionalString(raw.stlUrl, URL_MAX_LEN),
    checksumSha256: readChecksum(raw.checksumSha256),
    effectiveFromUTC: normalizeTimestamp(raw.effectiveFromUTC),
    createdAtUTC: normalizeTimestamp(raw.createdAtUTC),
    createdByUid: readOptionalString(raw.createdByUid, UID_MAX_LEN),
  };
}

/**
 * Valida el input que el UI envía al writer de `toolcribPrintLogs`.
 * NO incluye `printedByUid` ni `printedAtUTC`: esos campos los fija el
 * writer usando la sesión autenticada y `serverTimestamp()`.
 */
export function validateToolcribPrintLogInput(
  raw: unknown,
): ValidationResult<ValidatedToolcribPrintLogInput> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      issues: [{ path: '$', message: 'input debe ser objeto' }],
    };
  }

  const drawingId = raw.drawingId;
  if (!isNonEmptyString(drawingId) || drawingId.trim().length > DRAWING_ID_MAX_LEN) {
    issues.push({ path: 'drawingId', message: 'debe ser string no vacío' });
  }

  const partId = raw.partId;
  if (!isNonEmptyString(partId) || partId.trim().length > PART_ID_MAX_LEN) {
    issues.push({ path: 'partId', message: 'debe ser string no vacío' });
  }

  const copiesRaw = raw.copies;
  let copies = COPIES_MIN;
  if (typeof copiesRaw === 'number' && Number.isFinite(copiesRaw)) {
    const rounded = Math.round(copiesRaw);
    if (rounded < COPIES_MIN || rounded > COPIES_MAX) {
      issues.push({
        path: 'copies',
        message: `copies debe estar entre ${COPIES_MIN} y ${COPIES_MAX}`,
      });
    } else {
      copies = rounded;
    }
  } else {
    issues.push({ path: 'copies', message: 'debe ser número finito' });
  }

  let orderRef: string | null = null;
  if (raw.orderRef === null || raw.orderRef === undefined) {
    orderRef = null;
  } else if (typeof raw.orderRef === 'string') {
    const trimmed = raw.orderRef.trim();
    orderRef = trimmed.length === 0
      ? null
      : trimmed.length > ORDER_REF_MAX_LEN
        ? trimmed.slice(0, ORDER_REF_MAX_LEN)
        : trimmed;
  } else {
    issues.push({ path: 'orderRef', message: 'debe ser string o null' });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      drawingId: (drawingId as string).trim(),
      partId: (partId as string).trim(),
      copies,
      orderRef,
      origin: 'toolcrib-v1-ui',
    },
  };
}

export const TOOLCRIB_VALIDATION_LIMITS = {
  PART_NUMBER_MAX_LEN,
  CUSTOMER_MAX_LEN,
  DESCRIPTION_MAX_LEN,
  REVISION_MAX_LEN,
  SOURCE_PATH_MAX_LEN,
  URL_MAX_LEN,
  CHECKSUM_LEN,
  UID_MAX_LEN,
  ORDER_REF_MAX_LEN,
  COPIES_MIN,
  COPIES_MAX,
} as const;
