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
  where,
  writeBatch,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import type { WorkOrder, WorkOrderStatus, Tornero } from '../../types';
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
import { parseDateToISO, addDaysToISODate } from '../age';

/** Días de ciclo estándar para Suprajit (plazo por defecto si no hay fecha en el PDF). */
const DEFAULT_CYCLE_DAYS = 14;

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
 * Lee las órdenes ACTIVAS (archived == false) con límite duro y las normaliza.
 * El equality filter no requiere índice compuesto; el orden/filtrado fino se
 * hace en memoria.
 *
 * NOTA: En la mayoría de los flujos la app consume las órdenes vía
 * `WorkOrdersContext` (onSnapshot). Esta función se mantiene para scripts,
 * tests y usos puntuales donde no hay contexto React disponible.
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
      where('archived', '==', false),
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
      // Excluir archivadas del mapa: si una OT fue archivada y vuelve a subirse
      // la misma PO, debe crearse un doc nuevo (activo) en lugar de actualizar
      // el archivado.
      if (!n || n.archived) return;
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
          // Calcular dueDate automáticamente: fecha más antigua de otDate + 14 días.
          // Se usa la más antigua (misma estrategia que computeDueDate en reportFormat)
          // para que el plazo refleje el compromiso más urgente. Si ninguna línea es
          // parseable, se deja null hasta que el supervisor lo ajuste a mano.
          const otDateLines = o.otDate.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
          let parsedOtDate: string | null = null;
          for (const line of otDateLines) {
            const iso = parseDateToISO(line);
            if (iso && (parsedOtDate === null || iso < parsedOtDate)) parsedOtDate = iso;
          }
          const dueDate = parsedOtDate
            ? addDaysToISODate(parsedOtDate, DEFAULT_CYCLE_DAYS)
            : null;
          batch.set(ref, {
            poNumber: o.poNumber, soNumber: o.soNumber, otDate: o.otDate,
            customer: o.customer, pieza: o.pieza, numeroParte: o.numeroParte,
            cantidad: o.cantidad, prioridad: o.prioridad,
            status: 'pendiente',
            matchedPartId: o.matchedPartId, matchedDrawingId: o.matchedDrawingId,
            matchScore: o.matchScore,
            deliveredToTornero: null, deliveredAtUTC: null, deliveredByUid: null,
            dueDate,
            assignedToTornero: null, assignedAtUTC: null,
            finishedAtUTC: null, notes: '',
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
  if (!uid && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
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
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
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
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
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

/**
 * Transiciona el estado de una orden con los timestamps correspondientes.
 *
 * - pendiente   → (ningún timestamp extra)
 * - en_proceso  → assignedAtUTC = now, assignedToTornero = torneroName
 * - terminada   → finishedAtUTC = now
 * - entregada   → deliveredAtUTC = now, deliveredToTornero = torneroName
 *
 * El uid se resuelve siempre desde Auth (no spoofeable).
 */
export async function updateOrderStatus(
  orderId: string,
  status: WorkOrderStatus,
  torneroName?: string,
): Promise<WorkOrderResult<{ torneroName: string | null }>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  const uid = getCurrentUserUid();
  if (!uid && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }

  // Para transiciones que requieren tornero, sanitizamos el nombre
  const name = torneroName ? sanitizeTorneroName(torneroName) : null;
  if ((status === 'en_proceso' || status === 'entregada') && !name) {
    return { ok: false, reason: 'invalid-input' };
  }

  const extra: Record<string, unknown> = {};
  if (status === 'en_proceso') {
    extra.assignedToTornero = name;
    extra.assignedAtUTC = serverTimestamp();
  } else if (status === 'terminada') {
    extra.finishedAtUTC = serverTimestamp();
  } else if (status === 'entregada') {
    extra.deliveredToTornero = name;
    extra.deliveredAtUTC = serverTimestamp();
    extra.deliveredByUid = uid ?? null;
  } else if (status === 'pendiente') {
    // Revertir: limpia timestamps de progreso
    extra.assignedToTornero = null;
    extra.assignedAtUTC = null;
    extra.finishedAtUTC = null;
    extra.deliveredToTornero = null;
    extra.deliveredAtUTC = null;
    extra.deliveredByUid = null;
  }

  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      status,
      ...extra,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: { torneroName: name } };
  } catch (error) {
    console.warn('[smv-vision][work-orders] updateOrderStatus falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/** Actualiza la fecha límite de entrega (override manual). */
export async function updateDueDate(
  orderId: string,
  dueDate: string | null,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  // Validar formato ISO date básico (YYYY-MM-DD)
  if (dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return { ok: false, reason: 'invalid-input' };
  }
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      dueDate: dueDate ?? null,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] updateDueDate falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/** Pre-asigna un tornero a una orden sin cambiar su estado. */
export async function updateAssignedTornero(
  orderId: string,
  torneroName: string | null,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  const cleanName = torneroName ? sanitizeTorneroName(torneroName) : null;
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      assignedToTornero: cleanName,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] updateAssignedTornero falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/** Actualiza el índice de ordenamiento (Drag&Drop). */
export async function updateSortIndex(
  orderId: string,
  sortIndex: number,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      sortIndex,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] updateSortIndex falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/** Guarda notas libres del supervisor para una orden. */
export async function updateNotes(
  orderId: string,
  notes: string,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  const clean = (typeof notes === 'string' ? notes : '').slice(0, 1024);
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      notes: clean,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] updateNotes falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * Actualiza SOLO la cantidad de una orden. Usado por la edición manual del
 * reporte antes de imprimir (p. ej. ajustar a una entrega parcial). No toca el
 * estado de entrega ni ningún otro campo. Mismo contrato result-type.
 */
export async function updateCantidad(
  orderId: string,
  cantidad: string,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  const clean = (typeof cantidad === 'string' ? cantidad : '').trim().slice(0, 256);
  if (!clean) return { ok: false, reason: 'invalid-input' };
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      cantidad: clean,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] updateCantidad falló', error);
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
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
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
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
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
