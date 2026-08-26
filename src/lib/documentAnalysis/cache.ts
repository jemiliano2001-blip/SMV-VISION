import { createStore, del, get, set } from 'idb-keyval';
import { log } from '../log';

const CACHE_NAMESPACE = 'smvVisionDocAnalysisV1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const IDB_DATABASE_NAME = 'smv-vision-doc-cache';
const IDB_STORE_NAME = 'entries';

interface CacheEnvelope<TValue> {
  createdAt: number;
  value: TValue;
}

let cachedStore: ReturnType<typeof createStore> | null = null;
let legacyCleanupDone = false;

function getCacheStore(): ReturnType<typeof createStore> {
  if (!cachedStore) {
    cachedStore = createStore(IDB_DATABASE_NAME, IDB_STORE_NAME);
  }
  return cachedStore;
}

// One-shot migration: free any space still held by the previous localStorage
// implementation. Safe to call repeatedly (idempotent) and cheap because it
// only scans keys under our namespace.
function cleanupLegacyLocalStorage(): void {
  if (legacyCleanupDone) {
    return;
  }
  legacyCleanupDone = true;

  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${CACHE_NAMESPACE}:`)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore individual removal errors; we're best-effort here.
      }
    });
  } catch (error) {
    log.warn('[cache] legacy localStorage cleanup skipped', error);
  }
}

function buildCacheKey(kind: string, hash: string, promptVersion: string): string {
  return `${CACHE_NAMESPACE}:${kind}:${promptVersion}:${hash}`;
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Genera un fingerprint de un dataUrl para clave de caché.
 *
 * Usa muestreo (prefix + length + suffix) en lugar de hashear el dataUrl
 * completo. Para un PDF de 4 MB esto reduce el payload de ~5.3 MB a ~10 KB,
 * lo que mejora la latencia de la Fase A del pipeline en ~200 ms por plano.
 *
 * Riesgo de colisión: prácticamente cero para planos industriales (archivos
 * únicos con diferentes nombres, tamaños y contenido inicial).
 *
 * Nota: cambiar esta función NO invalida las entradas existentes de IndexedDB —
 * simplemente producen misses (claves distintas) y expiran tras el TTL de 7 días.
 * Para forzar re-análisis inmediato, bumpa ORDER_PROMPT_VERSION o BLUEPRINT_PROMPT_VERSION.
 */
export async function createDocumentHash(dataUrl: string): Promise<string> {
  // Muestreo: primeros 4 KB + longitud total + últimos 512 B
  const sample = dataUrl.slice(0, 4096) + String(dataUrl.length) + dataUrl.slice(-512);
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(sample));
  return arrayBufferToHex(digest);
}

export async function readCachedValue<TValue>(
  kind: string,
  hash: string,
  promptVersion: string,
): Promise<TValue | null> {
  cleanupLegacyLocalStorage();
  const key = buildCacheKey(kind, hash, promptVersion);
  const store = getCacheStore();

  let envelope: CacheEnvelope<TValue> | undefined;
  try {
    envelope = await get<CacheEnvelope<TValue>>(key, store);
  } catch (error) {
    log.warn('[cache] read failed, treating as miss', { key, error });
    return null;
  }

  if (!envelope) {
    return null;
  }

  if (typeof envelope.createdAt !== 'number' || Date.now() - envelope.createdAt > CACHE_TTL_MS) {
    try {
      await del(key, store);
    } catch (error) {
      log.warn('[cache] failed to evict expired entry', { key, error });
    }
    return null;
  }

  return envelope.value;
}

export async function writeCachedValue<TValue>(
  kind: string,
  hash: string,
  promptVersion: string,
  value: TValue,
): Promise<void> {
  cleanupLegacyLocalStorage();
  const key = buildCacheKey(kind, hash, promptVersion);
  const envelope: CacheEnvelope<TValue> = {
    createdAt: Date.now(),
    value,
  };

  try {
    await set(key, envelope, getCacheStore());
  } catch (error) {
    // Cache is purely optimizational: quota exhaustion, private mode, or any
    // other IDB failure must NEVER abort the document analysis pipeline.
    log.warn('[cache] write failed, continuing without cache entry', { key, error });
  }
}

export interface SavedAuditSession<TOrder = unknown, TSummary = unknown> {
  results: TOrder[];
  summary: TSummary | null;
  savedAt: number;
}

const LATEST_AUDIT_SESSION_KEY = `${CACHE_NAMESPACE}:latestAuditSession`;

export async function saveLatestAuditSession<TOrder, TSummary>(session: {
  results: TOrder[];
  summary: TSummary | null;
}): Promise<void> {
  try {
    const data: SavedAuditSession<TOrder, TSummary> = {
      ...session,
      savedAt: Date.now(),
    };
    await set(LATEST_AUDIT_SESSION_KEY, data, getCacheStore());
  } catch (error) {
    log.warn('[cache] saveLatestAuditSession failed', error);
  }
}

export async function loadLatestAuditSession<TOrder, TSummary>(): Promise<SavedAuditSession<TOrder, TSummary> | null> {
  try {
    const data = await get<SavedAuditSession<TOrder, TSummary>>(LATEST_AUDIT_SESSION_KEY, getCacheStore());
    if (!data || !Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }
    // Max age 24 hours
    if (Date.now() - data.savedAt > 1000 * 60 * 60 * 24) {
      await del(LATEST_AUDIT_SESSION_KEY, getCacheStore());
      return null;
    }
    return data;
  } catch (error) {
    log.warn('[cache] loadLatestAuditSession failed', error);
    return null;
  }
}

export async function clearLatestAuditSession(): Promise<void> {
  try {
    await del(LATEST_AUDIT_SESSION_KEY, getCacheStore());
  } catch (error) {
    log.warn('[cache] clearLatestAuditSession failed', error);
  }
}
