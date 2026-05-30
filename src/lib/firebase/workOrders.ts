/**
 * Capa de datos de la Control de Órdenes. Mismo contrato que `toolcrib.ts`:
 * las funciones NUNCA lanzan (devuelven result type), el uid se resuelve en el
 * writer desde Auth (no spoofeable) y los timestamps usan `serverTimestamp()`.
 */

import {
  addDoc,
  collection,
  doc,
  documentId,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  writeBatch,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
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
/** Límite duro de Firestore: 500 operaciones por WriteBatch. */
const MAX_BATCH_OPS = 500;

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
 * Construye el mapa dedupeKey -> { id } recorriendo TODA la colección por
 * páginas (ordenadas por documentId con `startAfter`). A diferencia de
 * `listWorkOrders`, no tiene tope de 2000: si la colección crece (las
 * archivadas nunca se borran) el dedup seguiría siendo correcto y no se
 * crearían duplicados de órdenes ya existentes.
 */
async function loadExistingDedupeKeys(
  database: Firestore,
): Promise<Map<string, { id: string }>> {
  const PAGE = 500;
  const MAX_PAGES = 200; // tope defensivo: 100k docs
  const existingByKey = new Map<string, { id: string }>();
  let cursor: QueryDocumentSnapshot | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const constraints: QueryConstraint[] = [orderBy(documentId()), fbLimit(PAGE)];
    if (cursor) constraints.push(startAfter(cursor));
    const snap = await getDocs(query(collection(database, WORK_ORDERS_COLLECTION), ...constraints));
    if (snap.empty) break;
    snap.forEach((d) => {
      const n = normalizeWorkOrder(d.id, d.data());
      if (!n) return;
      const key = buildDedupeKey({
        soNumber: n.soNumber, poNumber: n.poNumber,
        numeroParte: n.numeroParte, pieza: n.pieza,
      });
      if (!existingByKey.has(key)) existingByKey.set(key, { id: n.id });
    });
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.size < PAGE) break;
  }

  return existingByKey;
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

  // 1) snapshot existente -> Map por dedupeKey (paginado, sin tope de 2000)
  let existingByKey: Map<string, { id: string }>;
  try {
    existingByKey = await loadExistingDedupeKeys(database);
  } catch (error) {
    console.warn('[smv-vision][work-orders] lectura de dedup falló', error);
    return { ok: false, reason: 'read-failed' };
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

  // 3) escritura en batch. Firestore corta los batches en 500 ops, así que
  // acumulamos las operaciones y las fragmentamos en lotes de ≤500. Sin esto,
  // un PDF con muchas piezas haría fallar el commit completo y perderíamos
  // todo el upsert.
  type WriteOp =
    | { kind: 'create'; o: IncomingWorkOrder }
    | { kind: 'update'; id: string; fields: UpsertMutableFields };

  const ops: WriteOp[] = [
    ...diff.toCreate.map((key): WriteOp => ({ kind: 'create', o: byKey.get(key)! })),
    ...diff.toUpdate.map((u): WriteOp => ({ kind: 'update', id: u.id, fields: u.fields })),
  ];

  try {
    for (let start = 0; start < ops.length; start += MAX_BATCH_OPS) {
      const chunk = ops.slice(start, start + MAX_BATCH_OPS);
      const batch = writeBatch(database);
      for (const op of chunk) {
        if (op.kind === 'create') {
          const o = op.o;
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
        } else {
          const ref = doc(database, WORK_ORDERS_COLLECTION, op.id);
          batch.update(ref, {
            cantidad: op.fields.cantidad, prioridad: op.fields.prioridad,
            matchedPartId: op.fields.matchedPartId, matchedDrawingId: op.fields.matchedDrawingId,
            matchScore: op.fields.matchScore, otDate: op.fields.otDate,
            poNumber: op.fields.poNumber, soNumber: op.fields.soNumber,
            updatedAtUTC: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    }
    return { ok: true, value: { created: diff.toCreate.length, updated: diff.toUpdate.length } };
  } catch (error) {
    console.warn('[smv-vision][work-orders] upsertWorkOrders falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * Marca una orden como entregada. El uid lo fija el writer desde Auth.
 * Devuelve el nombre ya saneado que quedó persistido para que la UI haga
 * su update optimista con el MISMO valor (evita que el nombre mostrado
 * difiera del guardado hasta el siguiente refresh).
 */
export async function markDelivered(
  orderId: string,
  torneroName: string,
): Promise<WorkOrderResult<{ deliveredToTornero: string }>> {
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
    return { ok: true, value: { deliveredToTornero: name } };
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
