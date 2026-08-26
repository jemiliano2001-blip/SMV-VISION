/**
 * Plomería Firestore/Storage compartida por los scripts de catálogo Tool Crib
 * (`toolcribEdrawingsIso.ts`, `toolcribUploadStls.ts`, …). Antes cada script
 * reimplementaba su propio `buildPartDocId` / `buildFirebaseStorageUrl` /
 * upsert-con-merge; vive aquí una sola vez para que no diverjan.
 *
 * No incluye `initializeApp` / manejo de credenciales: cada CLI tiene su
 * propio contrato de errores públicos (dry-run, categorías de fallo) y
 * mezclarlo aquí acoplaría este módulo a esa lógica específica.
 */
import { createHash } from 'node:crypto';

export interface FirebaseCatalogContext {
  db: import('firebase-admin/firestore').Firestore;
  getStorage: typeof import('firebase-admin/storage').getStorage;
  FieldValue: typeof import('firebase-admin/firestore').FieldValue;
}

/** ID determinista para `toolcribParts`: mismo customer+partNumber → mismo doc. */
export function buildPartDocId(customer: string, partNumber: string): string {
  const digest = createHash('sha1')
    .update(`${customer.toUpperCase()}::${partNumber.toUpperCase()}`)
    .digest('hex')
    .slice(0, 16);
  return `part_${digest}`;
}

/** ID determinista para `toolcribDrawings`: mismo partId+revision → mismo doc. */
export function buildDrawingDocId(partId: string, revision: string): string {
  const digest = createHash('sha1')
    .update(`${partId}::${revision.toUpperCase()}`)
    .digest('hex')
    .slice(0, 20);
  return `drw_${digest}`;
}

export function buildFirebaseStorageUrl(bucket: string, path: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/** Sube bytes a Storage con un download token propio y devuelve la URL pública firmada por token. */
export async function uploadCatalogBytes(
  firebase: FirebaseCatalogContext,
  storagePath: string,
  bytes: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const { randomUUID } = await import('node:crypto');
  const bucket = firebase.getStorage().bucket();
  const token = randomUUID();
  await bucket.file(storagePath).save(Buffer.from(bytes), {
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return buildFirebaseStorageUrl(bucket.name, storagePath, token);
}

/** Crea o actualiza `toolcribParts/{partId}` preservando `createdAtUTC` en updates. */
export async function upsertCatalogPart(
  firebase: FirebaseCatalogContext,
  partId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const ref = firebase.db.collection('toolcribParts').doc(partId);
  const existing = await ref.get();
  await ref.set(
    existing.exists ? payload : { ...payload, createdAtUTC: firebase.FieldValue.serverTimestamp() },
    { merge: existing.exists },
  );
}

/**
 * Crea o actualiza `toolcribDrawings/{drawingId}` y desactiva cualquier otro
 * drawing activo del mismo `partId` — invariante: una sola revisión activa
 * por pieza.
 */
export async function upsertCatalogDrawing(
  firebase: FirebaseCatalogContext,
  drawingId: string,
  partId: string,
  payload: Record<string, unknown>,
  createdByUid: string,
): Promise<void> {
  const ref = firebase.db.collection('toolcribDrawings').doc(drawingId);
  const existing = await ref.get();
  await ref.set(
    existing.exists
      ? payload
      : { ...payload, createdAtUTC: firebase.FieldValue.serverTimestamp(), createdByUid },
    { merge: existing.exists },
  );

  const activeSiblings = await firebase.db
    .collection('toolcribDrawings')
    .where('partId', '==', partId)
    .where('isActive', '==', true)
    .get();
  const batch = firebase.db.batch();
  activeSiblings.forEach((docSnap) => {
    if (docSnap.id !== drawingId) batch.set(docSnap.ref, { isActive: false }, { merge: true });
  });
  await batch.commit();
}
