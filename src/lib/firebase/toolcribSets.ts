/**
 * Juegos (pares/hojas/complementos) en Firestore (colección `toolcribSets`).
 * Contrato de resultado: nunca lanza excepciones.
 */

import { collection, doc, getDocs, limit, query, serverTimestamp, writeBatch } from 'firebase/firestore';

import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
import { log } from '../log';
import {
  getActiveSets,
  normalizeSet,
  reconcileSets,
  setActiveSets,
  type ToolcribSet,
  type ToolcribSetMember,
  type ToolcribSetType,
} from '../toolcribSets';

export const TOOLCRIB_SETS_COLLECTION = 'toolcribSets';
const CACHE_TTL_MS = 60_000;

export type SetFailureReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'invalid-input'
  | 'read-failed'
  | 'write-failed';

export type SetResult<T> = { ok: true; value: T } | { ok: false; reason: SetFailureReason };

function isAuthed(): boolean {
  return getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();
}

export async function listSets(): Promise<SetResult<ToolcribSet[]>> {
  const db = getFirestoreClient();
  if (!db) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };
  try {
    const snap = await getDocs(query(collection(db, TOOLCRIB_SETS_COLLECTION), limit(500)));
    const sets: ToolcribSet[] = [];
    snap.forEach((d) => {
      const set = normalizeSet({ ...(d.data() as Record<string, unknown>), id: d.id });
      if (set) sets.push(set);
    });
    return { ok: true, value: sets };
  } catch (error) {
    log.warn('[smv-vision][toolcribSets] listSets falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

let lastLoadAt = 0;
let inflight: Promise<readonly ToolcribSet[]> | null = null;

/** Carga los juegos al almacén en memoria (caché de 60 s). Nunca lanza. */
export function ensureActiveSets(force = false): Promise<readonly ToolcribSet[]> {
  if (!force && Date.now() - lastLoadAt < CACHE_TTL_MS) return Promise.resolve(getActiveSets());
  if (inflight) return inflight;
  inflight = listSets()
    .then((res) => {
      if (res.ok === true) {
        setActiveSets(res.value);
        lastLoadAt = Date.now();
      }
      return getActiveSets();
    })
    .catch(() => getActiveSets())
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function saveSet(input: {
  id?: string;
  nombre: string;
  tipo: ToolcribSetType;
  miembros: ToolcribSetMember[];
}): Promise<SetResult<{ id: string }>> {
  const db = getFirestoreClient();
  if (!db) return { ok: false, reason: 'not-configured' };
  const uid = getCurrentUserUid();
  if (!uid && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };

  const id = input.id?.trim() || doc(collection(db, TOOLCRIB_SETS_COLLECTION)).id;
  const candidate = normalizeSet({ ...input, id });
  if (!candidate) return { ok: false, reason: 'invalid-input' };

  const existing = await listSets();
  if (existing.ok === false) return { ok: false, reason: existing.reason };
  const { toDelete, toUpdate } = reconcileSets(existing.value, candidate);

  try {
    const batch = writeBatch(db);
    batch.set(
      doc(db, TOOLCRIB_SETS_COLLECTION, id),
      {
        nombre: candidate.nombre,
        tipo: candidate.tipo,
        miembros: candidate.miembros,
        updatedByUid: uid ?? 'debug',
        updatedAtUTC: serverTimestamp(),
      },
      { merge: true },
    );
    for (const other of toUpdate) {
      batch.set(
        doc(db, TOOLCRIB_SETS_COLLECTION, other.id),
        { miembros: other.miembros, updatedAtUTC: serverTimestamp() },
        { merge: true },
      );
    }
    for (const otherId of toDelete) batch.delete(doc(db, TOOLCRIB_SETS_COLLECTION, otherId));
    await batch.commit();
    await ensureActiveSets(true);
    return { ok: true, value: { id } };
  } catch (error) {
    log.warn('[smv-vision][toolcribSets] saveSet falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function deleteSet(id: string): Promise<SetResult<true>> {
  const db = getFirestoreClient();
  if (!db) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };
  if (!id.trim()) return { ok: false, reason: 'invalid-input' };
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, TOOLCRIB_SETS_COLLECTION, id));
    await batch.commit();
    await ensureActiveSets(true);
    return { ok: true, value: true };
  } catch (error) {
    log.warn('[smv-vision][toolcribSets] deleteSet falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}
