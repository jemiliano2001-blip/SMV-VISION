import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { getFirestoreClient } from './client';

const SYNC_META_COLLECTION = 'syncMeta';
const SYNC_META_DOC = 'odoo';

/** Compañía (partner Odoo) con órdenes pendientes, escrita por el sync. */
export interface OdooSyncPartner {
  key: string;
  name: string;
  toInvoiceCount: number;
}

export interface OdooSyncMeta {
  lastSyncAt: Date;
  lastSuccessfulSyncAt?: Date;
  ordersProcessed: number;
  status: 'ok' | 'error';
  errorMessage?: string;
  /** Catálogo liviano de compañías con pendientes (botones en Órdenes). */
  partners: OdooSyncPartner[];
}

function normalizePartners(raw: unknown): OdooSyncPartner[] {
  if (!Array.isArray(raw)) return [];
  const out: OdooSyncPartner[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    const key = typeof row.key === 'string' ? row.key.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const toInvoiceCount =
      typeof row.toInvoiceCount === 'number' && Number.isFinite(row.toInvoiceCount)
        ? Math.max(0, Math.floor(row.toInvoiceCount))
        : 0;
    if (!key) continue;
    out.push({
      key,
      name: name || key,
      toInvoiceCount,
    });
  }
  return out;
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
      if (!ts) {
        cb(null);
        return;
      }
      const successTs = data.lastSuccessfulSyncAt as Timestamp | null | undefined;
      cb({
        lastSyncAt: ts.toDate(),
        lastSuccessfulSyncAt: successTs?.toDate?.() ?? (data.status === 'ok' ? ts.toDate() : undefined),
        ordersProcessed: typeof data.ordersProcessed === 'number' ? data.ordersProcessed : 0,
        status: data.status === 'error' ? 'error' : 'ok',
        errorMessage: data.errorMessage as string | undefined,
        partners: normalizePartners(data.partners),
      });
    },
    () => cb(null), // error handler — treat as "no data"
  );
}
