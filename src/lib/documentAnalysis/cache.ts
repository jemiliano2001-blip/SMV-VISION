import { createStore, del, get, set } from 'idb-keyval';

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
    console.warn('[cache] legacy localStorage cleanup skipped', error);
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

export async function createDocumentHash(dataUrl: string): Promise<string> {
  const encoder = new TextEncoder();
  const payload = encoder.encode(dataUrl);
  const digest = await crypto.subtle.digest('SHA-256', payload);
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
    console.warn('[cache] read failed, treating as miss', { key, error });
    return null;
  }

  if (!envelope) {
    return null;
  }

  if (typeof envelope.createdAt !== 'number' || Date.now() - envelope.createdAt > CACHE_TTL_MS) {
    try {
      await del(key, store);
    } catch (error) {
      console.warn('[cache] failed to evict expired entry', { key, error });
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
    console.warn('[cache] write failed, continuing without cache entry', { key, error });
  }
}
