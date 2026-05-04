/**
 * Capa de acceso a datos del catálogo Tool Crib (SMV-VISION v1).
 *
 * Contrato:
 * - Las funciones de lectura NUNCA lanzan: devuelven `{ ok: true, value }`
 *   o `{ ok: false, reason }`. Un fallo de red deja la UI operativa.
 * - El writer de `toolcribPrintLogs` también es fire-and-forget: si falla,
 *   la impresión del plano en el navegador sigue adelante.
 * - El `printedByUid` se resuelve siempre desde Firebase Auth en el writer:
 *   un caller malicioso no puede suplantar la identidad.
 * - Todos los timestamps persistidos usan `serverTimestamp()` => UTC.
 */

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  type DocumentReference,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';

import type { ToolcribActiveDrawingView } from '../../types';
import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
import {
  normalizeToolcribDrawing,
  normalizeToolcribPart,
  validateToolcribPrintLogInput,
  type ToolcribDrawing,
  type ToolcribPart,
  type ToolcribPrintLogInput,
  type ValidationIssue,
} from './toolcribValidators';

export const TOOLCRIB_PARTS_COLLECTION = 'toolcribParts';
export const TOOLCRIB_DRAWINGS_COLLECTION = 'toolcribDrawings';
export const TOOLCRIB_PRINT_LOGS_COLLECTION = 'toolcribPrintLogs';

/** Tope defensivo para evitar reads masivos en v1. */
const DEFAULT_PARTS_LIMIT = 500;
const DEFAULT_DRAWINGS_LIMIT = 1000;

export type ToolcribFailureReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'invalid-input'
  | 'read-failed'
  | 'write-failed'
  | 'not-found';

export type ToolcribResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ToolcribFailureReason; issues?: ValidationIssue[] };

function resolveFirestoreOrFail(): Firestore | null {
  const db = getFirestoreClient();
  return db ?? null;
}

/**
 * Lista todas las partes activas del catálogo (customer opcional).
 * Usa un límite duro para que un mal índice no baje el navegador.
 */
export async function listActiveToolcribParts(options?: {
  customer?: string;
  max?: number;
}): Promise<ToolcribResult<ToolcribPart[]>> {
  const db = resolveFirestoreOrFail();
  if (!db) {
    return { ok: false, reason: 'not-configured' };
  }

  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) {
    return { ok: false, reason: 'not-authenticated' };
  }

  const constraints: QueryConstraint[] = [];
  if (options?.customer && options.customer.trim().length > 0) {
    constraints.push(where('customer', '==', options.customer.trim()));
  }
  constraints.push(limit(Math.min(options?.max ?? DEFAULT_PARTS_LIMIT, DEFAULT_PARTS_LIMIT)));

  try {
    const q = query(collection(db, TOOLCRIB_PARTS_COLLECTION), ...constraints);
    const snapshot = await getDocs(q);
    const parts: ToolcribPart[] = [];
    snapshot.forEach((docSnap) => {
      const normalized = normalizeToolcribPart(docSnap.id, docSnap.data());
      if (normalized) {
        parts.push(normalized);
      }
    });
    return { ok: true, value: parts };
  } catch (error) {
    console.warn('[smv-vision][toolcrib] listActiveToolcribParts falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Devuelve la revisión activa para un `partId` dado, si existe. Si hay más
 * de una marcada como activa (estado inconsistente), se prefiere la más
 * reciente (`createdAtUTC` desc) y se registra warning para auditoría.
 */
export async function getActiveDrawingForPart(
  partId: string,
): Promise<ToolcribResult<ToolcribDrawing>> {
  if (typeof partId !== 'string' || partId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  const db = resolveFirestoreOrFail();
  if (!db) {
    return { ok: false, reason: 'not-configured' };
  }

  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) {
    return { ok: false, reason: 'not-authenticated' };
  }

  try {
    const q = query(
      collection(db, TOOLCRIB_DRAWINGS_COLLECTION),
      where('partId', '==', partId.trim()),
      where('isActive', '==', true),
      orderBy('createdAtUTC', 'desc'),
      limit(2),
    );
    const snapshot = await getDocs(q);
    const drawings: ToolcribDrawing[] = [];
    snapshot.forEach((docSnap) => {
      const normalized = normalizeToolcribDrawing(docSnap.id, docSnap.data());
      if (normalized) {
        drawings.push(normalized);
      }
    });
    if (drawings.length === 0) {
      return { ok: false, reason: 'not-found' };
    }
    if (drawings.length > 1) {
      console.warn(
        '[smv-vision][toolcrib] múltiples revisiones activas detectadas para partId',
        partId,
      );
    }
    return { ok: true, value: drawings[0] };
  } catch (error) {
    console.warn('[smv-vision][toolcrib] getActiveDrawingForPart falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Lista todas las revisiones conocidas de una parte (activa e históricas).
 * Se usa en el historial; las impresiones normales consumen solo la activa.
 */
export async function listDrawingsForPart(
  partId: string,
): Promise<ToolcribResult<ToolcribDrawing[]>> {
  if (typeof partId !== 'string' || partId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  const db = resolveFirestoreOrFail();
  if (!db) {
    return { ok: false, reason: 'not-configured' };
  }

  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) {
    return { ok: false, reason: 'not-authenticated' };
  }

  try {
    const q = query(
      collection(db, TOOLCRIB_DRAWINGS_COLLECTION),
      where('partId', '==', partId.trim()),
      orderBy('createdAtUTC', 'desc'),
      limit(DEFAULT_DRAWINGS_LIMIT),
    );
    const snapshot = await getDocs(q);
    const drawings: ToolcribDrawing[] = [];
    snapshot.forEach((docSnap) => {
      const normalized = normalizeToolcribDrawing(docSnap.id, docSnap.data());
      if (normalized) {
        drawings.push(normalized);
      }
    });
    return { ok: true, value: drawings };
  } catch (error) {
    console.warn('[smv-vision][toolcrib] listDrawingsForPart falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Lee un dibujo puntual por `drawingId` (útil para refrescar estado tras
 * un cambio externo o al imprimir).
 */
export async function getDrawingById(
  drawingId: string,
): Promise<ToolcribResult<ToolcribDrawing>> {
  if (typeof drawingId !== 'string' || drawingId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  const db = resolveFirestoreOrFail();
  if (!db) {
    return { ok: false, reason: 'not-configured' };
  }

  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) {
    return { ok: false, reason: 'not-authenticated' };
  }

  try {
    const snapshot = await getDoc(doc(db, TOOLCRIB_DRAWINGS_COLLECTION, drawingId.trim()));
    if (!snapshot.exists()) {
      return { ok: false, reason: 'not-found' };
    }
    const normalized = normalizeToolcribDrawing(snapshot.id, snapshot.data());
    if (!normalized) {
      return { ok: false, reason: 'read-failed' };
    }
    return { ok: true, value: normalized };
  } catch (error) {
    console.warn('[smv-vision][toolcrib] getDrawingById falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Lista las revisiones activas emparejadas con su parte, listo para usar
 * en la UI sin joins manuales. Si una parte no tiene revisión activa,
 * simplemente no aparece. Límite defensivo heredado del listado de partes.
 */
export async function listActiveDrawingViews(options?: {
  customer?: string;
  max?: number;
}): Promise<ToolcribResult<ToolcribActiveDrawingView[]>> {
  const partsResult = await listActiveToolcribParts(options);
  if (partsResult.ok === false) {
    return { ok: false, reason: partsResult.reason, issues: partsResult.issues };
  }

  const views: ToolcribActiveDrawingView[] = [];
  for (const part of partsResult.value) {
    const drawingResult = await getActiveDrawingForPart(part.id);
    if (!drawingResult.ok) {
      continue;
    }
    const drawing = drawingResult.value;
    views.push({
      partId: part.id,
      partNumber: part.partNumber,
      customer: part.customer,
      description: part.description,
      drawingId: drawing.id,
      revision: drawing.revision,
      sourceType: drawing.sourceType,
      sourcePath: drawing.sourcePath,
      pdfUrl: drawing.pdfUrl,
      effectiveFromUTC: drawing.effectiveFromUTC,
    });
  }
  return { ok: true, value: views };
}

/**
 * Escribe un log de impresión en Firestore. NO lanza: fire-and-forget.
 * Devuelve el id del log para permitir correlación en UI.
 */
export async function recordToolcribPrintLog(
  input: ToolcribPrintLogInput,
): Promise<ToolcribResult<{ id: string }>> {
  const db = resolveFirestoreOrFail();
  if (!db) {
    return { ok: false, reason: 'not-configured' };
  }

  const uid = getCurrentUserUid();
  if (!uid) {
    return { ok: false, reason: 'not-authenticated' };
  }

  const validation = validateToolcribPrintLogInput(input);
  if (validation.ok === false) {
    console.warn(
      '[smv-vision][toolcrib] printLog rechazado por validación de frontera',
      validation.issues,
    );
    return { ok: false, reason: 'invalid-input', issues: validation.issues };
  }

  const value = validation.value;
  const payload = {
    drawingId: value.drawingId,
    partId: value.partId,
    copies: value.copies,
    orderRef: value.orderRef,
    origin: value.origin,
    printedByUid: uid,
    printedAtUTC: serverTimestamp(),
  };

  try {
    const ref: DocumentReference = await addDoc(
      collection(db, TOOLCRIB_PRINT_LOGS_COLLECTION),
      payload,
    );
    return { ok: true, value: { id: ref.id } };
  } catch (error) {
    console.warn('[smv-vision][toolcrib] recordToolcribPrintLog falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * Helper seguro para consumir desde código síncrono (onClick) sin bloquear
 * la UI. Ninguna excepción escapa al caller.
 */
export function recordToolcribPrintLogFireAndForget(
  input: ToolcribPrintLogInput,
): void {
  recordToolcribPrintLog(input).catch((error) => {
    console.warn('[smv-vision][toolcrib] fire-and-forget atrapó error inesperado', error);
  });
}
