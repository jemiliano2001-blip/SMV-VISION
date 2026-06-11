# Odoo Sync Status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the last Odoo sync time, order count, and error state in `OdooOrdersPanel` by reading a `syncMeta/odoo` Firestore document written by the Cloud Function.

**Architecture:** The Cloud Function writes a single `syncMeta/odoo` document on every run (success and error). A lightweight Firebase module subscribes to that document via `onSnapshot`. A React hook wraps the subscription. The `OdooOrdersPanel` header renders a status chip from the hook's output.

**Tech Stack:** Firebase Firestore (`onSnapshot`), React hooks, TypeScript, Vitest (pure helpers only), Firebase Functions v2 (Node 24).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/age.ts` | Modify | Add `formatRelativeTime(date: Date): string` |
| `src/lib/__tests__/age.test.ts` | Create | Unit tests for `formatRelativeTime` |
| `src/lib/firebase/syncMeta.ts` | Create | `OdooSyncMeta` type + `subscribeToOdooSyncMeta` |
| `src/hooks/useSyncMeta.ts` | Create | React hook wrapping the subscription |
| `src/components/OdooOrdersPanel.tsx` | Modify | Add status chip in header |
| `functions/src/index.ts` | Modify | Write `syncMeta/odoo` in success + catch paths |

---

## Task 1: `formatRelativeTime` helper + tests

**Files:**
- Modify: `src/lib/age.ts`
- Create: `src/lib/__tests__/age.test.ts`

- [ ] **Step 1: Create the test file with failing tests**

Create `src/lib/__tests__/age.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../age';

describe('formatRelativeTime', () => {
  it('returns "hace un momento" for less than 1 minute ago', () => {
    const date = new Date(Date.now() - 30_000); // 30 seconds ago
    expect(formatRelativeTime(date)).toBe('hace un momento');
  });

  it('returns "hace un momento" for a date slightly in the future (clock skew)', () => {
    const date = new Date(Date.now() + 5_000); // 5 seconds in the future
    expect(formatRelativeTime(date)).toBe('hace un momento');
  });

  it('returns "hace N min" for 1–59 minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60_000); // 5 minutes ago
    expect(formatRelativeTime(date)).toBe('hace 5 min');
  });

  it('returns "hace 1 min" for exactly 1 minute ago', () => {
    const date = new Date(Date.now() - 60_000);
    expect(formatRelativeTime(date)).toBe('hace 1 min');
  });

  it('returns "hace Nh" for 1–23 hours ago', () => {
    const date = new Date(Date.now() - 3 * 3_600_000); // 3 hours ago
    expect(formatRelativeTime(date)).toBe('hace 3h');
  });

  it('returns "hace Nd" for 1+ days ago', () => {
    const date = new Date(Date.now() - 2 * 86_400_000); // 2 days ago
    expect(formatRelativeTime(date)).toBe('hace 2d');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- age
```

Expected: FAIL — `formatRelativeTime is not a function` (or similar import error).

- [ ] **Step 3: Add `formatRelativeTime` to `src/lib/age.ts`**

Append after the existing `formatAgeDays` function (end of file):

```ts
/**
 * Returns a short Spanish relative time string for a past date.
 * e.g. "hace 5 min", "hace 3h", "hace 2d"
 * Handles slight clock skew (future dates treated as "hace un momento").
 */
export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMin < 1) return 'hace un momento';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `hace ${diffD}d`;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- age
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/age.ts src/lib/__tests__/age.test.ts
git commit -m "feat: add formatRelativeTime helper to age.ts"
```

---

## Task 2: Firebase module `syncMeta.ts`

**Files:**
- Create: `src/lib/firebase/syncMeta.ts`

No unit tests for this module — it wraps a Firestore subscription (side-effectful, same pattern as other Firebase modules in this codebase).

- [ ] **Step 1: Create `src/lib/firebase/syncMeta.ts`**

```ts
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
      cb({
        lastSyncAt: (data.lastSyncAt as Timestamp).toDate(),
        ordersProcessed: data.ordersProcessed as number,
        status: data.status as 'ok' | 'error',
        errorMessage: data.errorMessage as string | undefined,
      });
    },
    () => cb(null), // error handler — treat as "no data"
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/firebase/syncMeta.ts
git commit -m "feat: add subscribeToOdooSyncMeta Firebase module"
```

---

## Task 3: `useSyncMeta` React hook

**Files:**
- Create: `src/hooks/useSyncMeta.ts`

- [ ] **Step 1: Create `src/hooks/useSyncMeta.ts`**

```ts
import { useEffect, useState } from 'react';
import {
  subscribeToOdooSyncMeta,
  type OdooSyncMeta,
} from '../lib/firebase/syncMeta';

/**
 * Subscribes to the syncMeta/odoo document and returns the latest value.
 * meta === null means Firebase is not configured, the function has never run,
 * or the first snapshot hasn't arrived yet — all three cases render nothing.
 */
export function useSyncMeta(): { meta: OdooSyncMeta | null } {
  const [meta, setMeta] = useState<OdooSyncMeta | null>(null);

  useEffect(() => subscribeToOdooSyncMeta(setMeta), []);

  return { meta };
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSyncMeta.ts
git commit -m "feat: add useSyncMeta hook"
```

---

## Task 4: Status chip in `OdooOrdersPanel`

**Files:**
- Modify: `src/components/OdooOrdersPanel.tsx`

- [ ] **Step 1: Add imports at the top of `OdooOrdersPanel.tsx`**

Find the existing import block at the top of the file. Add these two imports:

```ts
import { useSyncMeta } from '../hooks/useSyncMeta';
import { formatRelativeTime } from '../lib/age';
```

- [ ] **Step 2: Call the hook inside `OdooOrdersPanel`**

Inside the `OdooOrdersPanel` function body, after the existing `useState`/`useCallback` declarations, add:

```ts
const { meta } = useSyncMeta();
```

- [ ] **Step 3: Add the status chip in the header**

Find the `<div className="flex items-center gap-2">` block in the header (the one that contains the PDF and Refrescar buttons). Insert the chip as the first child, before the PDF button:

```tsx
{meta && (
  <div
    className={`font-mono text-[10px] uppercase tracking-widest px-3 py-2 border-2 ${
      meta.status === 'error'
        ? 'border-danger/50 text-danger'
        : 'border-line text-ink-dim'
    }`}
    title={meta.status === 'error' ? meta.errorMessage : undefined}
  >
    {meta.status === 'error'
      ? `ERROR SYNC · ${formatRelativeTime(meta.lastSyncAt)}`
      : `SYNC · ${formatRelativeTime(meta.lastSyncAt)} · ${meta.ordersProcessed} ÓRDENES`}
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/OdooOrdersPanel.tsx
git commit -m "feat: add Odoo sync status chip to OdooOrdersPanel header"
```

---

## Task 5: Cloud Function — write `syncMeta/odoo`

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Move `dbFirestore` before the `try` block**

The current code declares `const dbFirestore = admin.firestore();` inside the `try` block (around line 75), making it inaccessible in `catch`. Move it to before the `try`:

Replace this section (the start of the async handler):

```ts
async (event) => {
  try {
    const url = process.env.ODOO_URL;
```

With:

```ts
async (event) => {
  const dbFirestore = admin.firestore();
  try {
    const url = process.env.ODOO_URL;
```

Then remove the original `const dbFirestore = admin.firestore();` line that was inside `try` (around line 75).

- [ ] **Step 2: Write `syncMeta/odoo` on success**

Find the success log line:

```ts
logger.info(`🚀 Éxito: ${orders.length} órdenes en Firestore.`);
```

Insert **before** that line:

```ts
await dbFirestore.collection('syncMeta').doc('odoo').set({
  lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
  ordersProcessed: orders.length,
  status: 'ok',
});
```

- [ ] **Step 3: Write `syncMeta/odoo` on error**

Find the catch block:

```ts
} catch (error) {
  logger.error("❌ Error crítico sincronizando con Odoo:", error);
}
```

Add the metadata write after the logger call:

```ts
} catch (error) {
  logger.error("❌ Error crítico sincronizando con Odoo:", error);
  await dbFirestore.collection('syncMeta').doc('odoo').set({
    lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    ordersProcessed: 0,
    status: 'error',
    errorMessage: String(error),
  }).catch(() => {}); // never let the metadata write crash the error handler
}
```

- [ ] **Step 4: Build the function to check for TypeScript errors**

```bash
cd functions && npm run build
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: write syncMeta/odoo to Firestore on each sync run"
```

---

## Task 6: Deploy and verify

- [ ] **Step 1: Deploy the updated Cloud Function**

```bash
cd functions && npm run deploy
```

Expected: `✔ functions[syncSuprajitOrders]: Successful update` (or similar).

- [ ] **Step 2: Verify the document was created**

Open Firebase Console → Firestore → `syncMeta` collection → `odoo` document.  
You should see `lastSyncAt`, `ordersProcessed`, `status: "ok"` (once the next scheduled run fires) — or trigger a manual test run from the Firebase Console (Functions → syncSuprajitOrders → Test function).

- [ ] **Step 3: Verify the chip appears in the UI**

Run `npm run dev`, open the **Órdenes** panel.  
Once the `syncMeta/odoo` document exists in Firestore:
- If `status === 'ok'`: header shows `SYNC · hace X min · N ÓRDENES` in dim text
- If `status === 'error'`: header shows `ERROR SYNC · hace Xh` in red, hovering shows the error message

- [ ] **Step 4: Commit final state**

```bash
git add -p  # review any leftover changes
git commit -m "chore: deploy Odoo sync status — Cloud Function + frontend integration complete"
```
