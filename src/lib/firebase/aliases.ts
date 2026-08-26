/**
 * src/lib/firebase/aliases.ts
 *
 * Memoria persistente de alias pieza ↔ plano en Firestore (colección `partAliases`).
 * Permite que cuando un operador vincule manualmente una orden de Odoo con
 * una descripción compleja a un plano de Tool Crib, el sistema lo recuerde
 * automáticamente para futuros análisis y auto-matches.
 *
 * Contrato de resultado: nunca lanza excepciones (Result type pattern).
 */

import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';

import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
export { normalizeAliasKey } from '../aliasKey';
import { normalizeAliasKey } from '../aliasKey';
import { log } from '../log';

export const PART_ALIASES_COLLECTION = 'partAliases';

export interface PartAliasDoc {
  id: string;
  pattern: string;
  partNumber: string;
  drawingId: string;
  createdAtUTC: string | null;
  createdByUid: string | null;
}

export type AliasFailureReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'invalid-input'
  | 'read-failed'
  | 'write-failed';

export type AliasResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AliasFailureReason };

function resolveDb(): Firestore | null {
  return getFirestoreClient();
}

function isAuthed(): boolean {
  return getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();
}

/** Genera un ID determinista seguro para el documento Firestore. */
function buildAliasDocId(pattern: string): string {
  const norm = normalizeAliasKey(pattern);
  return norm.replace(/[^A-Z0-9]/g, '_').slice(0, 100);
}

/**
 * Lista todos los alias aprendidos registrados en Firestore.
 */
export async function listPartAliases(): Promise<AliasResult<PartAliasDoc[]>> {
  const db = resolveDb();
  if (!db) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  try {
    const q = query(collection(db, PART_ALIASES_COLLECTION), limit(1000));
    const snap = await getDocs(q);
    const aliases: PartAliasDoc[] = [];

    snap.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      if (typeof data.pattern === 'string' && typeof data.partNumber === 'string') {
        let createdAtUTC: string | null = null;
        const ts = data.createdAtUTC;
        if (ts && typeof (ts as { toDate?: () => Date }).toDate === 'function') {
          createdAtUTC = (ts as { toDate: () => Date }).toDate().toISOString();
        }

        aliases.push({
          id: d.id,
          pattern: data.pattern,
          partNumber: data.partNumber,
          drawingId: typeof data.drawingId === 'string' ? data.drawingId : '',
          createdAtUTC,
          createdByUid: typeof data.createdByUid === 'string' ? data.createdByUid : null,
        });
      }
    });

    return { ok: true, value: aliases };
  } catch (error) {
    log.warn('[smv-vision][aliases] listPartAliases falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Guarda o actualiza un alias aprendido en Firestore.
 */
export async function savePartAlias(payload: {
  pattern: string;
  partNumber: string;
  drawingId: string;
}): Promise<AliasResult<{ id: string }>> {
  const db = resolveDb();
  if (!db) return { ok: false, reason: 'not-configured' };

  const uid = getCurrentUserUid();
  if (!uid && !isToolcribDebugUnauthAllowed()) {
    return { ok: false, reason: 'not-authenticated' };
  }

  const pattern = normalizeAliasKey(payload.pattern);
  const partNumber = payload.partNumber.trim().toUpperCase();

  if (!pattern || !partNumber) {
    return { ok: false, reason: 'invalid-input' };
  }

  const docId = buildAliasDocId(pattern);

  try {
    const ref = doc(db, PART_ALIASES_COLLECTION, docId);
    await setDoc(
      ref,
      {
        pattern,
        partNumber,
        drawingId: payload.drawingId.trim(),
        createdByUid: uid ?? 'debug',
        createdAtUTC: serverTimestamp(),
        updatedAtUTC: serverTimestamp(),
      },
      { merge: true },
    );

    return { ok: true, value: { id: docId } };
  } catch (error) {
    log.warn('[smv-vision][aliases] savePartAlias falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * Elimina un alias aprendido de Firestore.
 */
export async function deletePartAlias(id: string): Promise<AliasResult<void>> {
  const db = resolveDb();
  if (!db) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  try {
    await deleteDoc(doc(db, PART_ALIASES_COLLECTION, id));
    return { ok: true, value: undefined };
  } catch (error) {
    log.warn('[smv-vision][aliases] deletePartAlias falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}
