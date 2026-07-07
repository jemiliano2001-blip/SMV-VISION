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

import type { PurchaseItem } from '../../types';
import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
import { normalizePurchaseItem } from './purchaseValidators';

export const PURCHASES_COLLECTION = 'purchases';
const DEFAULT_MAX = 500;

export type PurchaseFailureReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'invalid-input'
  | 'read-failed'
  | 'write-failed';

export type PurchaseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: PurchaseFailureReason };

function db(): Firestore | null {
  return getFirestoreClient();
}
function isAuthed(): boolean {
  return getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();
}

export async function listPurchases(options?: {
  max?: number;
}): Promise<PurchaseResult<PurchaseItem[]>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  try {
    // Sort by createdAtUTC desc
    const q = query(
      collection(database, PURCHASES_COLLECTION),
      orderBy('createdAtUTC', 'desc'),
      fbLimit(Math.min(options?.max ?? DEFAULT_MAX, DEFAULT_MAX)),
    );
    const snap = await getDocs(q);
    const out: PurchaseItem[] = [];
    snap.forEach((d) => {
      const n = normalizePurchaseItem(d.id, d.data());
      if (n) out.push(n);
    });
    return { ok: true, value: out };
  } catch (error) {
    console.warn('[smv-vision][purchases] listPurchases falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

export async function createPurchase(item: Omit<PurchaseItem, 'id' | 'createdAtUTC' | 'updatedAtUTC'>): Promise<PurchaseResult<{ id: string }>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };
  
  if (typeof item.nombre !== 'string' || item.nombre.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }

  try {
    const ref = await addDoc(collection(database, PURCHASES_COLLECTION), {
      nombre: item.nombre.trim(),
      tipo: item.tipo,
      sku: (item.sku || '').trim(),
      proveedor: (item.proveedor || '').trim(),
      link: (item.link || '').trim(),
      notas: (item.notas || '').trim(),
      createdAtUTC: serverTimestamp(),
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: { id: ref.id } };
  } catch (error) {
    console.warn('[smv-vision][purchases] createPurchase falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function updatePurchase(id: string, updates: Partial<Omit<PurchaseItem, 'id' | 'createdAtUTC' | 'updatedAtUTC'>>): Promise<PurchaseResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };

  if (typeof id !== 'string' || id.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }

  try {
    const cleanUpdates: Record<string, unknown> = {
      updatedAtUTC: serverTimestamp()
    };
    if (updates.nombre !== undefined) cleanUpdates.nombre = updates.nombre.trim();
    if (updates.tipo !== undefined) cleanUpdates.tipo = updates.tipo;
    if (updates.sku !== undefined) cleanUpdates.sku = updates.sku.trim();
    if (updates.proveedor !== undefined) cleanUpdates.proveedor = updates.proveedor.trim();
    if (updates.link !== undefined) cleanUpdates.link = updates.link.trim();
    if (updates.notas !== undefined) cleanUpdates.notas = updates.notas.trim();

    await updateDoc(doc(database, PURCHASES_COLLECTION, id.trim()), cleanUpdates);
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][purchases] updatePurchase falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function deletePurchase(id: string): Promise<PurchaseResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid() && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };

  if (typeof id !== 'string' || id.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }

  try {
    await deleteDoc(doc(database, PURCHASES_COLLECTION, id.trim()));
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][purchases] deletePurchase falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}
