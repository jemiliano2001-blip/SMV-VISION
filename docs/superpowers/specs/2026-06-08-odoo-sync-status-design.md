# Odoo Sync Status — Frontend Design Spec

**Date:** 2026-06-08  
**Status:** Approved  

## Context

`syncSuprajitOrders` is a Firebase scheduled Cloud Function (every 30 min) that syncs Odoo sale orders into Firestore. It's already deployed and running. This spec covers the frontend integration to surface the sync status to the user — read-only, no manual trigger.

## Goal

Show the user when the last sync ran, how many orders were processed, and whether it succeeded or failed. The indicator lives in `OdooOrdersPanel` — no global banner, no `App.tsx` wiring.

## Data: `syncMeta/odoo` document

The Cloud Function writes a single fixed document at the end of each run (both success and error paths):

```ts
// Success
{
  lastSyncAt: FieldValue.serverTimestamp(),
  ordersProcessed: number,
  status: 'ok'
}

// Error
{
  lastSyncAt: FieldValue.serverTimestamp(),
  ordersProcessed: 0,
  status: 'error',
  errorMessage: string
}
```

One document, overwritten on every run. No history accumulated.

## Files Affected

| File | Change |
|---|---|
| `functions/src/index.ts` | Write `syncMeta/odoo` in both success and catch paths (~5 lines) |
| `src/lib/firebase/syncMeta.ts` | New — `subscribeToOdooSyncMeta(cb)` + `OdooSyncMeta` type |
| `src/hooks/useSyncMeta.ts` | New — React hook wrapping the subscription |
| `src/components/OdooOrdersPanel.tsx` | Add status chip in header |
| `src/lib/age.ts` | Add `formatRelativeTime(date: Date): string` helper |

## Cloud Function change (`functions/src/index.ts`)

Add a `syncMeta` write at the end of the `try` block and in the `catch` block:

```ts
// In try, after batch.commit():
await dbFirestore.collection('syncMeta').doc('odoo').set({
  lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
  ordersProcessed: orders.length,
  status: 'ok',
});

// In catch:
await dbFirestore.collection('syncMeta').doc('odoo').set({
  lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
  ordersProcessed: 0,
  status: 'error',
  errorMessage: String(error),
}).catch(() => {}); // never let metadata write crash the error handler
```

## Firebase module (`src/lib/firebase/syncMeta.ts`)

```ts
export interface OdooSyncMeta {
  lastSyncAt: Date;
  ordersProcessed: number;
  status: 'ok' | 'error';
  errorMessage?: string;
}

/**
 * Subscribes to the syncMeta/odoo document.
 * Returns an unsubscribe function.
 * Calls cb(null) if Firebase is not configured or document doesn't exist.
 */
export function subscribeToOdooSyncMeta(
  cb: (meta: OdooSyncMeta | null) => void
): () => void
```

Follows the existing pattern: returns a no-op unsubscribe if `getFirestoreClient()` returns null (Firebase not configured).

## Hook (`src/hooks/useSyncMeta.ts`)

```ts
export function useSyncMeta(): { meta: OdooSyncMeta | null } {
  const [meta, setMeta] = useState<OdooSyncMeta | null>(null);
  useEffect(() => subscribeToOdooSyncMeta(setMeta), []);
  return { meta };
}
```

Simple — no loading state needed. `null` means "not configured", "function never ran yet", or "still waiting for first snapshot"; all three cases render nothing. The brief flash of nothing on first load is acceptable — the panel already has its own loading spinner.

## UI chip in `OdooOrdersPanel`

Placed in the header row, between the title block and the action buttons.

| `meta` state | Renders |
|---|---|
| `null` | Nothing |
| `status: 'ok'` | `SYNC · hace 23 min · 12 órdenes` — `text-ink-dim`, `font-mono text-[10px]` |
| `status: 'error'` | `ERROR SYNC · hace 2h` — `text-danger`, `title={errorMessage}` for tooltip |

## `formatRelativeTime` helper (`src/lib/age.ts`)

Pure function, no dependencies:

```ts
/**
 * Returns a short Spanish relative time string.
 * e.g. "hace 5 min", "hace 2h", "hace 3d"
 */
export function formatRelativeTime(date: Date): string
```

Thresholds: < 1 min → "hace un momento" / < 60 min → "hace N min" / < 24h → "hace Nh" / else → "hace Nd".

## Out of Scope

- Manual sync trigger from the frontend
- Sync history / log of past runs
- Push notifications on sync failure
- Syncing collections other than `workOrders`
