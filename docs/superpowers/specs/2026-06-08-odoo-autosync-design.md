# Odoo Auto-Sync — Design Spec

**Date:** 2026-06-08  
**Status:** Approved  

## Problem

`syncOdoo.ts` runs manually via `npm run sync:odoo`. Operators have no way to trigger a sync from the app, and the Firestore `odooSaleOrders` collection can be stale between manual runs. Odoo orders are added 2–3 times per week.

## Goal

Allow the app to sync Odoo sale orders automatically when a user opens it, and expose a manual refresh button for on-demand syncs. Show a visible indicator during sync and a clear error if it fails.

## Architecture

```
[App opens / Refresh button]
       ↓
  useSyncOdoo hook
       ↓
  Firebase Callable Function: syncOdooOrders
       ↓  (Admin SDK + Odoo credentials — server only)
  Shared lib: odooSync.ts (extracted from syncOdoo.ts)
       ↓
  Idempotent upsert → Firestore odooSaleOrders
       ↓  (WorkOrdersContext real-time listener picks up changes)
  UI updates automatically
```

## Cloud Function: `syncOdooOrders`

- **Type:** Firebase Callable Function (requires authenticated caller)
- **Location:** `functions/src/syncOdooOrders.ts`
- **Shared logic:** `functions/lib/odooSync.ts` — extracted from `scripts/syncOdoo.ts` so both the manual script and the function share the same implementation
- **Credentials:** `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_PASSWORD` stored as Firebase Functions secrets (never in the browser bundle)
- **Timeout:** 30 seconds — throws a structured error if Odoo doesn't respond
- **Returns:** `{ added: number, updated: number, timestamp: string }`
- **Auth:** Firebase verifies the caller's ID token automatically; unauthenticated calls are rejected

## Frontend: `useSyncOdoo` hook

**State machine:** `idle → syncing → success | error`

**Auto-sync on mount:**
- Triggers once per session (tracked via `localStorage` key `smv_last_odoo_sync`)
- Runs in parallel with app load — does not block rendering

**Manual trigger:**
- Exposes `triggerSync()` method
- Disables during an in-progress sync

## UX Behavior

| State | UI |
|---|---|
| Syncing | Non-blocking banner top: `"Sincronizando con Odoo…"` + spinner |
| Success | Banner: `"Odoo sincronizado — N órdenes nuevas"` — auto-dismisses after 3s |
| Error | Persistent red banner: `"Error al sincronizar con Odoo. [Reintentar]"` |

**Refresh button placement:** Icon button in `OdooOrdersPanel` header (or `NavRail`). Spins while syncing, disabled while a sync is in progress.

## Data Flow

The existing `odooSaleOrders` Firestore collection and `WorkOrdersContext` subscription require no changes — new/updated documents appear automatically via the existing real-time listener.

## Files Affected

| File | Change |
|---|---|
| `functions/src/syncOdooOrders.ts` | New — callable Cloud Function |
| `functions/lib/odooSync.ts` | New — shared sync logic (extracted from `scripts/syncOdoo.ts`) |
| `functions/package.json` | New — Functions project dependencies |
| `firebase.json` | Add `functions` config block |
| `src/hooks/useSyncOdoo.ts` | New — sync state + callable invocation |
| `src/components/SyncBanner.tsx` | New — status banner component |
| `src/components/OdooOrdersPanel.tsx` | Add refresh button + wire `useSyncOdoo` |
| `src/App.tsx` | Mount `useSyncOdoo` for auto-sync on load (App owns top-level side effects) |
| `scripts/syncOdoo.ts` | Refactor to import from `functions/lib/odooSync.ts` |

## Infrastructure Notes

- Requires Firebase **Blaze plan** (pay-as-you-go) for external network calls from Cloud Functions. At 2–3 syncs/week the cost is effectively $0.
- Firebase CLI: `firebase init functions` to bootstrap the `functions/` directory.
- Secrets set via: `firebase functions:secrets:set ODOO_URL` etc.

## Out of Scope

- Scheduled/cron-based sync (not needed at this frequency)
- Real-time webhooks from Odoo
- Syncing other Odoo models beyond sale orders
