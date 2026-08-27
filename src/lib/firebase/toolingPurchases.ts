import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';

import type { ToolingPurchaseItem } from '../tooling/types';
import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
import { normalizeToolingPurchaseItem } from './toolingValidators';
import { log } from '../log';

export const TOOLING_PURCHASES_COLLECTION = 'toolingPurchases';
const DEFAULT_MAX = 500;

export type ToolingFailureReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'invalid-input'
  | 'read-failed'
  | 'write-failed';

export type ToolingResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ToolingFailureReason };

function db(): Firestore | null {
  return getFirestoreClient();
}

function isAuthed(): boolean {
  return getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();
}

export async function listToolingPurchases(options?: {
  max?: number;
}): Promise<ToolingResult<ToolingPurchaseItem[]>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  try {
    const q = query(
      collection(database, TOOLING_PURCHASES_COLLECTION),
      orderBy('createdAtUTC', 'desc'),
      fbLimit(Math.min(options?.max ?? DEFAULT_MAX, DEFAULT_MAX)),
    );
    const snap = await getDocs(q);
    const out: ToolingPurchaseItem[] = [];
    snap.forEach((d) => {
      const n = normalizeToolingPurchaseItem(d.id, d.data());
      if (n) out.push(n);
    });
    return { ok: true, value: out };
  } catch (error) {
    log.warn('[smv-vision][tooling] listToolingPurchases falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

export async function createToolingPurchase(
  item: Omit<ToolingPurchaseItem, 'id' | 'createdAtUTC' | 'updatedAtUTC'>
): Promise<ToolingResult<{ id: string }>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };

  if (
    (!item.codigoISO || item.codigoISO.trim().length === 0) &&
    (!item.descripcion || item.descripcion.trim().length === 0)
  ) {
    return { ok: false, reason: 'invalid-input' };
  }

  try {
    const ref = await addDoc(collection(database, TOOLING_PURCHASES_COLLECTION), {
      codigoISO: (item.codigoISO || '').trim(),
      descripcion: (item.descripcion || '').trim(),
      categoria: item.categoria,
      marca: (item.marca || 'Genérico').trim(),
      grado: (item.grado || '').trim(),
      rompevirutas: (item.rompevirutas || '').trim(),
      materialISO: item.materialISO || 'Universal',
      proveedor: (item.proveedor || '').trim(),
      precioUnitario: Number(item.precioUnitario) || 0,
      precioCaja: item.precioCaja !== undefined ? Number(item.precioCaja) : 0,
      moneda: item.moneda || 'MXN',
      linkCompra: (item.linkCompra || '').trim(),
      maquinaAsignada: (item.maquinaAsignada || '').trim(),
      calificacion: item.calificacion !== undefined ? Number(item.calificacion) : 5,
      rendimientoNotas: (item.rendimientoNotas || '').trim(),
      stockActual: item.stockActual !== undefined ? Number(item.stockActual) : 0,
      stockMinimo: item.stockMinimo !== undefined ? Number(item.stockMinimo) : 0,
      createdAtUTC: serverTimestamp(),
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: { id: ref.id } };
  } catch (error) {
    log.warn('[smv-vision][tooling] createToolingPurchase falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function updateToolingPurchase(
  id: string,
  updates: Partial<Omit<ToolingPurchaseItem, 'id' | 'createdAtUTC' | 'updatedAtUTC'>>
): Promise<ToolingResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };

  if (typeof id !== 'string' || id.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }

  try {
    const cleanUpdates: Record<string, unknown> = {
      updatedAtUTC: serverTimestamp(),
    };
    if (updates.codigoISO !== undefined) cleanUpdates.codigoISO = updates.codigoISO.trim();
    if (updates.descripcion !== undefined) cleanUpdates.descripcion = updates.descripcion.trim();
    if (updates.categoria !== undefined) cleanUpdates.categoria = updates.categoria;
    if (updates.marca !== undefined) cleanUpdates.marca = updates.marca.trim();
    if (updates.grado !== undefined) cleanUpdates.grado = updates.grado.trim();
    if (updates.rompevirutas !== undefined) cleanUpdates.rompevirutas = updates.rompevirutas.trim();
    if (updates.materialISO !== undefined) cleanUpdates.materialISO = updates.materialISO;
    if (updates.proveedor !== undefined) cleanUpdates.proveedor = updates.proveedor.trim();
    if (updates.precioUnitario !== undefined) cleanUpdates.precioUnitario = Number(updates.precioUnitario);
    if (updates.precioCaja !== undefined) cleanUpdates.precioCaja = Number(updates.precioCaja);
    if (updates.moneda !== undefined) cleanUpdates.moneda = updates.moneda;
    if (updates.linkCompra !== undefined) cleanUpdates.linkCompra = updates.linkCompra.trim();
    if (updates.maquinaAsignada !== undefined) cleanUpdates.maquinaAsignada = updates.maquinaAsignada.trim();
    if (updates.calificacion !== undefined) cleanUpdates.calificacion = Number(updates.calificacion);
    if (updates.rendimientoNotas !== undefined) cleanUpdates.rendimientoNotas = updates.rendimientoNotas.trim();
    if (updates.stockActual !== undefined) cleanUpdates.stockActual = Number(updates.stockActual);
    if (updates.stockMinimo !== undefined) cleanUpdates.stockMinimo = Number(updates.stockMinimo);

    await updateDoc(doc(database, TOOLING_PURCHASES_COLLECTION, id.trim()), cleanUpdates);
    return { ok: true, value: undefined };
  } catch (error) {
    log.warn('[smv-vision][tooling] updateToolingPurchase falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function deleteToolingPurchase(id: string): Promise<ToolingResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };

  if (typeof id !== 'string' || id.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }

  try {
    await deleteDoc(doc(database, TOOLING_PURCHASES_COLLECTION, id.trim()));
    return { ok: true, value: undefined };
  } catch (error) {
    log.warn('[smv-vision][tooling] deleteToolingPurchase falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}
