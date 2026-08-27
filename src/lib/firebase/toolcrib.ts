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
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import type { ToolcribActiveDrawingView } from '../../types';
import { getCurrentUserUid } from './auth';
import { getFirestoreClient, getStorageClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
import { log } from '../log';
import {
  normalizeToolcribDrawing,
  normalizeToolcribPart,
  normalizeToolcribPrintLog,
  validateToolcribPrintLogInput,
  type ToolcribDrawing,
  type ToolcribPart,
  type ToolcribPrintLogInput,
  type ToolcribPrintLogRecord,
  type ValidationIssue,
} from './toolcribValidators';

export const TOOLCRIB_PARTS_COLLECTION = 'toolcribParts';
export const TOOLCRIB_DRAWINGS_COLLECTION = 'toolcribDrawings';
export const TOOLCRIB_PRINT_LOGS_COLLECTION = 'toolcribPrintLogs';

/** Tope defensivo para evitar reads masivos en v1. */
const DEFAULT_PARTS_LIMIT = 500;
const DEFAULT_DRAWINGS_LIMIT = 1000;

export type { ToolcribPrintLogRecord };

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

  const constraints: QueryConstraint[] = [where('status', '==', 'active')];
  if (options?.customer && options.customer.trim().length > 0) {
    constraints.push(where('customer', '==', options.customer.trim()));
  }
  const effectiveLimit = Math.min(options?.max ?? DEFAULT_PARTS_LIMIT, DEFAULT_PARTS_LIMIT);
  constraints.push(limit(effectiveLimit));

  try {
    const q = query(collection(db, TOOLCRIB_PARTS_COLLECTION), ...constraints);
    const snapshot = await getDocs(q);
    // Si el snapshot llena el límite exacto, es probable que el catálogo
    // tenga más partes activas de las que se están devolviendo — el matcher
    // parecería "no encontrar" planos que en realidad ya no llegan aquí.
    if (snapshot.size >= effectiveLimit) {
      log.warn(
        `[smv-vision][toolcrib] listActiveToolcribParts alcanzó el límite (${effectiveLimit}) — el catálogo puede estar truncado. Sube DEFAULT_PARTS_LIMIT en toolcrib.ts.`,
      );
    }
    const parts: ToolcribPart[] = [];
    snapshot.forEach((docSnap) => {
      const normalized = normalizeToolcribPart(docSnap.id, docSnap.data());
      if (normalized) {
        parts.push(normalized);
      }
    });
    return { ok: true, value: parts };
  } catch (error) {
    log.warn('[smv-vision][toolcrib] listActiveToolcribParts falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Lista las revisiones activas emparejadas con su parte, listo para usar
 * en la UI sin joins manuales. Usa 2 queries en lugar de N+1: una para partes
 * y una para todos los planos activos; el join se hace en memoria.
 */
export async function listActiveDrawingViews(options?: {
  customer?: string;
  max?: number;
}): Promise<ToolcribResult<ToolcribActiveDrawingView[]>> {
  const partsResult = await listActiveToolcribParts(options);
  if (partsResult.ok === false) {
    return { ok: false, reason: partsResult.reason, issues: partsResult.issues };
  }

  const parts = partsResult.value;
  if (parts.length === 0) {
    return { ok: true, value: [] };
  }

  const db = resolveFirestoreOrFail();
  if (!db) {
    return { ok: false, reason: 'not-configured' };
  }

  try {
    const q = query(
      collection(db, TOOLCRIB_DRAWINGS_COLLECTION),
      where('isActive', '==', true),
      limit(DEFAULT_DRAWINGS_LIMIT),
    );
    const snapshot = await getDocs(q);
    if (snapshot.size >= DEFAULT_DRAWINGS_LIMIT) {
      log.warn(
        `[smv-vision][toolcrib] listActiveDrawingViews alcanzó el límite (${DEFAULT_DRAWINGS_LIMIT}) — el catálogo puede estar truncado. Sube DEFAULT_DRAWINGS_LIMIT en toolcrib.ts.`,
      );
    }

    // Build partId → most-recent active drawing map (in-memory de-dup)
    const drawingByPartId = new Map<string, ToolcribDrawing>();
    snapshot.forEach((docSnap) => {
      const normalized = normalizeToolcribDrawing(docSnap.id, docSnap.data());
      if (!normalized) return;
      const existing = drawingByPartId.get(normalized.partId);
      // Estado inconsistente: más de una revisión activa para la misma parte.
      // Avisamos en cuanto detectamos la segunda y nos quedamos con la más reciente.
      if (existing) {
        log.warn(
          '[smv-vision][toolcrib] múltiples revisiones activas detectadas para partId',
          normalized.partId,
        );
      }
      // Keep the most recently created drawing when multiple actives exist (inconsistent state)
      if (!existing || (normalized.createdAtUTC ?? '') > (existing.createdAtUTC ?? '')) {
        drawingByPartId.set(normalized.partId, normalized);
      }
    });

    const views: ToolcribActiveDrawingView[] = [];
    for (const part of parts) {
      const drawing = drawingByPartId.get(part.id);
      if (!drawing) continue;
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
        stlUrl: drawing.stlUrl,
        effectiveFromUTC: drawing.effectiveFromUTC,
      });
    }
    return { ok: true, value: views };
  } catch (error) {
    log.warn('[smv-vision][toolcrib] listActiveDrawingViews falló', error);
    return { ok: false, reason: 'read-failed' };
  }
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
    log.warn(
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
    log.warn('[smv-vision][toolcrib] recordToolcribPrintLog falló', error);
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
    log.warn('[smv-vision][toolcrib] fire-and-forget atrapó error inesperado', error);
  });
}

/**
 * Lista los registros de impresión más recientes de toda la biblioteca (hasta `max`).
 * Permite a la UI computar estadísticas de impresión rápidamente sin N+1 reads.
 */
export async function listRecentPrintLogs(options?: {
  max?: number;
}): Promise<ToolcribResult<ToolcribPrintLogRecord[]>> {
  const db = resolveFirestoreOrFail();
  if (!db) {
    return { ok: false, reason: 'not-configured' };
  }

  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) {
    return { ok: false, reason: 'not-authenticated' };
  }

  try {
    const q = query(
      collection(db, TOOLCRIB_PRINT_LOGS_COLLECTION),
      orderBy('printedAtUTC', 'desc'),
      limit(options?.max ?? 300),
    );
    const snapshot = await getDocs(q);
    const logs: ToolcribPrintLogRecord[] = [];
    snapshot.forEach((docSnap) => {
      const normalized = normalizeToolcribPrintLog(docSnap.id, docSnap.data());
      if (normalized) logs.push(normalized);
    });
    return { ok: true, value: logs };
  } catch (error) {
    log.warn('[smv-vision][toolcrib] listRecentPrintLogs falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Lista los registros de impresión para un dibujo específico.
 */
export async function listPrintLogsForDrawing(
  drawingId: string,
  options?: { max?: number },
): Promise<ToolcribResult<ToolcribPrintLogRecord[]>> {
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
    const q = query(
      collection(db, TOOLCRIB_PRINT_LOGS_COLLECTION),
      where('drawingId', '==', drawingId.trim()),
      limit(options?.max ?? 50),
    );
    const snapshot = await getDocs(q);
    const logs: ToolcribPrintLogRecord[] = [];
    snapshot.forEach((docSnap) => {
      const normalized = normalizeToolcribPrintLog(docSnap.id, docSnap.data());
      if (normalized) logs.push(normalized);
    });
    logs.sort((a, b) => (b.printedAtUTC ?? '').localeCompare(a.printedAtUTC ?? ''));
    return { ok: true, value: logs };
  } catch (error) {
    log.warn('[smv-vision][toolcrib] listPrintLogsForDrawing falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

export async function uploadDrawingPdf(
  file: File,
  customer: string,
  partNumber: string,
  revision: string
): Promise<ToolcribResult<string>> {
  const storage = getStorageClient();
  if (!storage) return { ok: false, reason: 'not-configured' };
  
  const uid = getCurrentUserUid();
  if (!uid) return { ok: false, reason: 'not-authenticated' };

  try {
    const destName = `toolcrib/uploads/${customer}_${partNumber}_rev${revision}_${Date.now()}.pdf`;
    const storageRef = ref(storage, destName);
    await uploadBytes(storageRef, file, { contentType: 'application/pdf' });
    const url = await getDownloadURL(storageRef);
    return { ok: true, value: url };
  } catch (error) {
    log.warn('[smv-vision][toolcrib] uploadDrawingPdf falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export interface CreateDrawingPayload {
  partNumber: string;
  customer: string;
  description: string;
  revision: string;
  pdfUrl: string | null;
  sourceType: 'network' | 'storage';
  sourcePath: string;
  isActive: boolean;
}

export async function createPartAndDrawing(
  payload: CreateDrawingPayload
): Promise<ToolcribResult<void>> {
  const db = resolveFirestoreOrFail();
  if (!db) return { ok: false, reason: 'not-configured' };

  const uid = getCurrentUserUid();
  if (!uid) return { ok: false, reason: 'not-authenticated' };

  try {
    const qParts = query(
      collection(db, TOOLCRIB_PARTS_COLLECTION),
      where('partNumber', '==', payload.partNumber),
      where('customer', '==', payload.customer)
    );
    const partsSnap = await getDocs(qParts);
    
    let partId: string;
    const batch = writeBatch(db);
    
    if (partsSnap.empty) {
      const newPartRef = doc(collection(db, TOOLCRIB_PARTS_COLLECTION));
      partId = newPartRef.id;
      batch.set(newPartRef, {
        partNumber: payload.partNumber,
        customer: payload.customer,
        description: payload.description,
        status: 'active',
        createdAtUTC: serverTimestamp(),
        updatedAtUTC: serverTimestamp(),
      });
    } else {
      partId = partsSnap.docs[0].id;
    }

    const newDrawingRef = doc(collection(db, TOOLCRIB_DRAWINGS_COLLECTION));
    batch.set(newDrawingRef, {
      partId,
      revision: payload.revision,
      isActive: payload.isActive,
      sourceType: payload.sourceType,
      sourcePath: payload.sourcePath,
      pdfUrl: payload.pdfUrl,
      stlUrl: null,
      checksumSha256: null,
      createdAtUTC: serverTimestamp(),
      createdByUid: uid,
    });

    if (payload.isActive) {
      const qOthers = query(
        collection(db, TOOLCRIB_DRAWINGS_COLLECTION),
        where('partId', '==', partId),
        where('isActive', '==', true)
      );
      const othersSnap = await getDocs(qOthers);
      othersSnap.forEach(docSnap => {
        batch.update(docSnap.ref, { isActive: false });
      });
    }

    await batch.commit();
    return { ok: true, value: undefined };
  } catch (error) {
    log.warn('[smv-vision][toolcrib] createPartAndDrawing falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function inactivatePart(partId: string): Promise<ToolcribResult<void>> {
  const db = resolveFirestoreOrFail();
  if (!db) return { ok: false, reason: 'not-configured' };

  const uid = getCurrentUserUid();
  if (!uid) return { ok: false, reason: 'not-authenticated' };

  try {
    const batch = writeBatch(db);
    
    const partRef = doc(db, TOOLCRIB_PARTS_COLLECTION, partId);
    batch.update(partRef, { status: 'inactive', updatedAtUTC: serverTimestamp() });

    const qDrawings = query(
      collection(db, TOOLCRIB_DRAWINGS_COLLECTION),
      where('partId', '==', partId),
      where('isActive', '==', true)
    );
    const drawingsSnap = await getDocs(qDrawings);
    drawingsSnap.forEach(docSnap => {
      batch.update(docSnap.ref, { isActive: false });
    });

    await batch.commit();
    return { ok: true, value: undefined };
  } catch (error) {
    log.warn('[smv-vision][toolcrib] inactivatePart falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

