/**
 * Notas permanentes por pieza en Firestore (colección `toolcribPartNotes`).
 * Contrato de resultado: nunca lanza excepciones.
 */

import { collection, deleteDoc, doc, getDocs, limit, query, serverTimestamp, setDoc } from 'firebase/firestore';

import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
import { log } from '../log';
import { noteDocId, normalizePartNotes, type PartNote } from '../partNotes';
import { setPartKey } from '../toolcribSets';

export const TOOLCRIB_PART_NOTES_COLLECTION = 'toolcribPartNotes';

export type NotesFailureReason = 'not-configured' | 'not-authenticated' | 'invalid-input' | 'read-failed' | 'write-failed';
export type NotesResult<T> = { ok: true; value: T } | { ok: false; reason: NotesFailureReason };

function isAuthed(): boolean {
  return getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();
}

/** Todas las notas, indexadas por número de parte canónico. */
export async function listPartNotes(): Promise<NotesResult<Map<string, PartNote[]>>> {
  const db = getFirestoreClient();
  if (!db) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };
  try {
    const snap = await getDocs(query(collection(db, TOOLCRIB_PART_NOTES_COLLECTION), limit(2000)));
    const byPart = new Map<string, PartNote[]>();
    snap.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      const partNumber = typeof data.partNumber === 'string' ? setPartKey(data.partNumber) : '';
      const notes = normalizePartNotes(data.notas);
      if (partNumber && notes.length > 0) byPart.set(partNumber, notes);
    });
    return { ok: true, value: byPart };
  } catch (error) {
    log.warn('[smv-vision][partNotes] listPartNotes falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/** Guarda las notas de una pieza; con lista vacía borra el documento. */
export async function savePartNotes(partNumber: string, notes: PartNote[]): Promise<NotesResult<true>> {
  const db = getFirestoreClient();
  if (!db) return { ok: false, reason: 'not-configured' };
  const uid = getCurrentUserUid();
  if (!uid && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };

  const key = setPartKey(partNumber);
  if (!key) return { ok: false, reason: 'invalid-input' };
  const clean = normalizePartNotes(notes);

  try {
    const ref = doc(db, TOOLCRIB_PART_NOTES_COLLECTION, noteDocId(key));
    if (clean.length === 0) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { partNumber: key, notas: clean, updatedByUid: uid ?? 'debug', updatedAtUTC: serverTimestamp() }, { merge: true });
    }
    return { ok: true, value: true };
  } catch (error) {
    log.warn('[smv-vision][partNotes] savePartNotes falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}
