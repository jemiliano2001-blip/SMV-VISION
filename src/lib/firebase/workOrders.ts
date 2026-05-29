/**
 * Capa de datos de la Control de Órdenes. Mismo contrato que `toolcrib.ts`:
 * las funciones NUNCA lanzan (devuelven result type), el uid se resuelve en el
 * writer desde Auth (no spoofeable) y los timestamps usan `serverTimestamp()`.
 */

import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit as fbLimit,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

import type { WorkOrder, Tornero } from '../../types';
import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
import {
  normalizeWorkOrder,
  normalizeTornero,
  sanitizeTorneroName,
} from './workOrderValidators';
import {
  buildDedupeKey,
  mergeUpsert,
  type UpsertMutableFields,
} from '../workOrders/dedupe';

export const WORK_ORDERS_COLLECTION = 'workOrders';
export const TORNEROS_COLLECTION = 'torneros';

const DEFAULT_MAX = 2000;

export type WorkOrderFailureReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'invalid-input'
  | 'read-failed'
  | 'write-failed';

export type WorkOrderResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: WorkOrderFailureReason };

function db(): Firestore | null {
  return getFirestoreClient();
}
function isAuthed(): boolean {
  return getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();
}

/** Una orden recién extraída lista para upsert (campos crudos + match). */
export interface IncomingWorkOrder {
  pieza: string;
  numeroParte: string;
  cantidad: string;
  prioridad: 'URGENTE' | 'Normal';
  soNumber: string;
  poNumber: string;
  otDate: string;
  customer: string;
  matchedDrawingId: string | null;
  matchedPartId: string | null;
  matchScore: number | null;
  sourcePdfName: string;
}

function toMutable(o: IncomingWorkOrder): UpsertMutableFields {
  return {
    cantidad: o.cantidad,
    prioridad: o.prioridad,
    matchedDrawingId: o.matchedDrawingId,
    matchedPartId: o.matchedPartId,
    matchScore: o.matchScore,
    otDate: o.otDate,
    poNumber: o.poNumber,
    soNumber: o.soNumber,
  };
}

/**
 * Lee todas las órdenes (con límite duro) y las normaliza. Sin orderBy para
 * no requerir índices compuestos; el orden/filtrado fino se hace en memoria.
 */
export async function listWorkOrders(options?: {
  max?: number;
}): Promise<WorkOrderResult<WorkOrder[]>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  try {
    const q = query(
      collection(database, WORK_ORDERS_COLLECTION),
      fbLimit(Math.min(options?.max ?? DEFAULT_MAX, DEFAULT_MAX)),
    );
    const snap = await getDocs(q);
    const out: WorkOrder[] = [];
    snap.forEach((d) => {
      const n = normalizeWorkOrder(d.id, d.data());
      if (n) out.push(n);
    });
    return { ok: true, value: out };
  } catch (error) {
    console.warn('[smv-vision][work-orders] listWorkOrders falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Crea/actualiza órdenes a partir de un lote extraído. Lee lo existente una
 * vez, calcula el diff con `mergeUpsert` (puro) y escribe en batch. Preserva
 * el estado de entrega: las actualizaciones nunca tocan `status`/`delivered*`.
 */
export async function upsertWorkOrders(
  incoming: IncomingWorkOrder[],
): Promise<WorkOrderResult<{ created: number; updated: number }>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  const uid = getCurrentUserUid();
  if (!uid && !isToolcribDebugUnauthAllowed()) {
    return { ok: false, reason: 'not-authenticated' };
  }
  if (incoming.length === 0) return { ok: true, value: { created: 0, updated: 0 } };

  // 1) snapshot existente -> Map por dedupeKey
  const existingResult = await listWorkOrders();
  if (existingResult.ok === false) return existingResult;
  const existingByKey = new Map<string, { id: string }>();
  for (const wo of existingResult.value) {
    const key = buildDedupeKey({
      soNumber: wo.soNumber, poNumber: wo.poNumber,
      numeroParte: wo.numeroParte, pieza: wo.pieza,
    });
    if (!existingByKey.has(key)) existingByKey.set(key, { id: wo.id });
  }

  // 2) diff puro
  const incomingWithKeys = incoming.map((o) => ({
    key: buildDedupeKey({
      soNumber: o.soNumber, poNumber: o.poNumber,
      numeroParte: o.numeroParte, pieza: o.pieza,
    }),
    fields: toMutable(o),
    raw: o,
  }));
  const byKey = new Map(incomingWithKeys.map((i) => [i.key, i.raw]));
  const diff = mergeUpsert(existingByKey, incomingWithKeys);

  // 3) escritura en batch (Firestore: máx 500 ops por batch)
  try {
    const batch = writeBatch(database);
    for (const key of diff.toCreate) {
      const o = byKey.get(key)!;
      const ref = doc(collection(database, WORK_ORDERS_COLLECTION));
      batch.set(ref, {
        poNumber: o.poNumber, soNumber: o.soNumber, otDate: o.otDate,
        customer: o.customer, pieza: o.pieza, numeroParte: o.numeroParte,
        cantidad: o.cantidad, prioridad: o.prioridad,
        status: 'pendiente',
        matchedPartId: o.matchedPartId, matchedDrawingId: o.matchedDrawingId,
        matchScore: o.matchScore,
        deliveredToTornero: null, deliveredAtUTC: null, deliveredByUid: null,
        sourcePdfName: o.sourcePdfName, archived: false,
        createdAtUTC: serverTimestamp(), updatedAtUTC: serverTimestamp(),
      });
    }
    for (const u of diff.toUpdate) {
      const ref = doc(database, WORK_ORDERS_COLLECTION, u.id);
      batch.update(ref, {
        cantidad: u.fields.cantidad, prioridad: u.fields.prioridad,
        matchedPartId: u.fields.matchedPartId, matchedDrawingId: u.fields.matchedDrawingId,
        matchScore: u.fields.matchScore, otDate: u.fields.otDate,
        poNumber: u.fields.poNumber, soNumber: u.fields.soNumber,
        updatedAtUTC: serverTimestamp(),
      });
    }
    await batch.commit();
    return { ok: true, value: { created: diff.toCreate.length, updated: diff.toUpdate.length } };
  } catch (error) {
    console.warn('[smv-vision][work-orders] upsertWorkOrders falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/** Marca una orden como entregada. El uid lo fija el writer desde Auth. */
export async function markDelivered(
  orderId: string,
  torneroName: string,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  const uid = getCurrentUserUid();
  if (!uid) return { ok: false, reason: 'not-authenticated' };
  const name = sanitizeTorneroName(torneroName);
  if (typeof orderId !== 'string' || orderId.trim().length === 0 || !name) {
    return { ok: false, reason: 'invalid-input' };
  }
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      status: 'entregada',
      deliveredToTornero: name,
      deliveredAtUTC: serverTimestamp(),
      deliveredByUid: uid,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] markDelivered falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/** Revierte a pendiente (por si se marcó por error). */
export async function markPending(orderId: string): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid()) return { ok: false, reason: 'not-authenticated' };
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      status: 'pendiente',
      deliveredToTornero: null, deliveredAtUTC: null, deliveredByUid: null,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] markPending falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function archiveWorkOrder(
  orderId: string,
  archived: boolean,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid()) return { ok: false, reason: 'not-authenticated' };
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      archived: archived === true,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] archiveWorkOrder falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function listTorneros(): Promise<WorkOrderResult<Tornero[]>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };
  try {
    const snap = await getDocs(
      query(collection(database, TORNEROS_COLLECTION), fbLimit(200)),
    );
    const out: Tornero[] = [];
    snap.forEach((d) => {
      const n = normalizeTornero(d.id, d.data());
      if (n) out.push(n);
    });
    return { ok: true, value: out };
  } catch (error) {
    console.warn('[smv-vision][work-orders] listTorneros falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

export async function addTornero(name: string): Promise<WorkOrderResult<{ id: string }>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid()) return { ok: false, reason: 'not-authenticated' };
  const clean = sanitizeTorneroName(name);
  if (!clean) return { ok: false, reason: 'invalid-input' };
  try {
    const ref = await addDoc(collection(database, TORNEROS_COLLECTION), {
      name: clean, active: true, createdAtUTC: serverTimestamp(),
    });
    return { ok: true, value: { id: ref.id } };
  } catch (error) {
    console.warn('[smv-vision][work-orders] addTornero falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function setTorneroActive(
  id: string,
  active: boolean,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid()) return { ok: false, reason: 'not-authenticated' };
  if (typeof id !== 'string' || id.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  try {
    await updateDoc(doc(database, TORNEROS_COLLECTION, id.trim()), { active: active === true });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] setTorneroActive falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}
