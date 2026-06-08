import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { getFirestoreClient } from './client';

const SYNC_META_COLLECTION = 'syncMeta';
const SYNC_META_DOC = 'odoo';

export interface OdooSyncMeta {
  lastSyncAt: Date;
  ordersProcessed: number;
  status: 'ok' | 'error';
  errorMessage?: string;
}

/**
 * Subscribes to the syncMeta/odoo document via onSnapshot.
 * Calls cb(null) if Firebase is not configured or the document doesn't exist yet.
 * Returns an unsubscribe function.
 */
export function subscribeToOdooSyncMeta(
  cb: (meta: OdooSyncMeta | null) => void,
): () => void {
  const database = getFirestoreClient();
  if (!database) {
    cb(null);
    return () => {};
  }

  const ref = doc(database, SYNC_META_COLLECTION, SYNC_META_DOC);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      const data = snap.data();
      // serverTimestamp() resolves to null locally before the write completes
      const ts = data.lastSyncAt as Timestamp | null;
      if (!ts) { cb(null); return; }
      cb({
        lastSyncAt: ts.toDate(),
        ordersProcessed: data.ordersProcessed as number,
        status: data.status as 'ok' | 'error',
        errorMessage: data.errorMessage as string | undefined,
      });
    },
    () => cb(null), // error handler — treat as "no data"
  );
}
