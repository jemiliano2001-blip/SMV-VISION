# Cloud Functions Dependency/Runtime Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `functions/` from firebase-functions v4.9.0 / firebase-admin v11.11.1 / Node 20 to firebase-functions ^7.2.5 / firebase-admin ^14.1.0 / Node 22, migrating the Admin SDK initialization off the legacy namespace API that v14 removes, and verify the result locally before deploying.

**Architecture:** No new components. Three coupled edits to existing files (`functions/package.json`, `functions/src/index.ts`, `functions/tsconfig.json`), each verified by a build/install check, followed by a runtime smoke test against a local Firestore emulator, an `npm audit` pass, and a confirmation-gated production deploy.

**Tech Stack:** firebase-functions v7, firebase-admin v14 (modular `firebase-admin/app` / `firebase-admin/firestore` API), TypeScript 5.8, Node 22, Firebase CLI emulators.

## Global Constraints

- Target versions (exact, from spec): `firebase-functions: "^7.2.5"`, `firebase-admin: "^14.1.0"`, `engines.node: "22"`.
- `odoo-xmlrpc` stays at `^1.0.8` — it has no Node engine restriction; do not touch it.
- No changes outside `functions/` — do not touch root `package.json`, `src/`, `firestore.rules`, `storage.rules`, or any other module.
- No changes to sync business logic (dedup keys, batching, `GENERIC_SERVICE_CODE`, work-order archiving rules, etc.) — this is a dependency/runtime migration only.
- Keep `syncSuprajitOrders` (the 30-minute schedule) — it is intentionally retained for parity with what's deployed (see CLAUDE.md); do not remove it.
- Never print, log, or access the raw `ODOO_API_KEY` secret value at any point during this work.
- The final deploy step touches a production Cloud Function that runs on a 30-minute schedule and backs a user-facing button (`triggerOdooSync`) — it requires the user's explicit go-ahead before running, in addition to whatever step-level confirmation the executing skill already provides.

---

### Task 1: Bump `functions/package.json` dependencies and regenerate the lockfile

**Files:**
- Modify: `functions/package.json`
- Modify (generated): `functions/package-lock.json`

**Interfaces:**
- Produces: `functions/node_modules` containing `firebase-admin@14.1.x` and `firebase-functions@7.2.x`, with `functions/package-lock.json` in sync (verified via `npm ci`). Task 2 depends on these packages being installed so `tsc` can type-check against the new modular API surface.

- [ ] **Step 1: Edit `functions/package.json`**

Change the `engines` and `dependencies` blocks (leave `scripts`, `devDependencies`, `main`, `private` untouched):

```json
  "engines": {
    "node": "22"
  },
  "main": "lib/index.js",
  "dependencies": {
    "firebase-admin": "^14.1.0",
    "firebase-functions": "^7.2.5",
    "odoo-xmlrpc": "^1.0.8"
  },
```

- [ ] **Step 2: Install and regenerate the lockfile**

Run: `npm install --prefix functions`
Expected: exits 0, `functions/package-lock.json` is rewritten, no `ERESOLVE` errors.

- [ ] **Step 3: Verify installed versions**

Run: `npm ls --prefix functions firebase-admin firebase-functions`
Expected output shows the new majors, e.g.:
```
smv-vision-functions@ D:\proyectos_code\SMV\SMV-VISION\functions
+-- firebase-admin@14.1.x
`-- firebase-functions@7.2.x
  `-- firebase-admin@14.1.x deduped
```

- [ ] **Step 4: Clean-install check (mirrors what Cloud Build runs on deploy)**

Run:
```bash
rm -rf functions/node_modules
npm ci --prefix functions
```
Expected: exits 0 with no `EUSAGE` / `Missing:` / `Invalid:` errors. (This exact failure mode bit the previous Functions deploy — the lockfile had drifted from `package.json`. Do not skip this check.)

- [ ] **Step 5: Commit**

```bash
git add functions/package.json functions/package-lock.json
git commit -m "chore(functions): bump firebase-functions to v7, firebase-admin to v14, Node to 22"
```

---

### Task 2: Migrate Admin SDK initialization to the modular API

**Files:**
- Modify: `functions/src/index.ts:31-41` (imports and init block)
- Modify: `functions/src/index.ts:783` (inside `syncSuprajitOrders`)
- Modify: `functions/src/index.ts:831` (inside `triggerOdooSync`)

**Interfaces:**
- Consumes: `firebase-admin@14.1.x` installed by Task 1 (the legacy `admin.firestore()` namespace call this task removes no longer exists in v14 — this task is not optional).
- Produces: `db: Firestore` obtained via `getFirestore()` in both handlers, same type (`Firestore` from `firebase-admin/firestore`, already imported) and same usage as before — no change to any call site that uses `db` afterward (`upsertSaleOrders`, `upsertWorkOrders`, `writeSyncMeta` all keep their existing `Firestore` parameter type).

- [ ] **Step 1: Replace the import block**

In `functions/src/index.ts`, replace:

```ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import Odoo = require("odoo-xmlrpc");

if (admin.apps.length === 0) {
  admin.initializeApp();
}
```

with:

```ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import Odoo = require("odoo-xmlrpc");

if (getApps().length === 0) {
  initializeApp();
}
```

- [ ] **Step 2: Replace the first `admin.firestore()` call site**

In `functions/src/index.ts`, inside `syncSuprajitOrders` (currently line 783):

```ts
  async () => {
    const db = admin.firestore();
```

becomes:

```ts
  async () => {
    const db = getFirestore();
```

- [ ] **Step 3: Replace the second `admin.firestore()` call site**

In `functions/src/index.ts`, inside `triggerOdooSync` (currently line 831):

```ts
    const db = admin.firestore();
```

becomes:

```ts
    const db = getFirestore();
```

- [ ] **Step 4: Confirm no legacy namespace references remain**

Run: `grep -n "admin\." functions/src/index.ts`
Expected: no output (the file no longer references the `admin` namespace at all — the only prior usages were the import, the init check, and the two `admin.firestore()` calls just replaced).

- [ ] **Step 5: Build**

Run: `npm --prefix functions run build`
Expected: exits 0, no TypeScript errors. `functions/lib/index.js` is regenerated.

- [ ] **Step 6: Commit**

```bash
git add functions/src/index.ts
git commit -m "refactor(functions): migrate Admin SDK init to modular firebase-admin/app and firebase-admin/firestore API"
```

---

### Task 3: Align `functions/tsconfig.json` target with Node 22

**Files:**
- Modify: `functions/tsconfig.json`

**Interfaces:**
- Consumes: nothing from prior tasks beyond the already-passing build from Task 2.
- Produces: `functions/lib/index.js` compiled with `es2022` target/lib instead of `es2017`/`es2020` — no change to any exported name or type; this is purely a compiler-output change and later tasks depend only on `npm --prefix functions run build` continuing to succeed.

- [ ] **Step 1: Edit `functions/tsconfig.json`**

Change:

```json
    "target": "es2017",
    "lib": ["es2020"],
```

to:

```json
    "target": "es2022",
    "lib": ["es2022"],
```

- [ ] **Step 2: Rebuild**

Run: `npm --prefix functions run build`
Expected: exits 0, no TypeScript errors (the codebase has no `es2017`-specific downleveling this would break — `import Odoo = require(...)` is a TS module syntax construct, not a target-level feature).

- [ ] **Step 3: Commit**

```bash
git add functions/tsconfig.json
git commit -m "chore(functions): bump tsconfig target to es2022 for Node 22"
```

---

### Task 4: Verify the modular Admin SDK rewrite against a local Firestore emulator

**Files:**
- Create (temporary, not committed): `functions/verify-admin-sdk.cjs` — deleted at the end of this task.

**Interfaces:**
- Consumes: `functions/lib/index.js` built by Task 2/3 (specifically its module-scope `if (getApps().length === 0) { initializeApp(); }` line, and the `getFirestore()` call now used inside both handlers).
- Produces: a pass/fail confirmation that `initializeApp()`/`getFirestore()` work at runtime under firebase-admin v14, without needing real Odoo credentials or touching production Firestore. No other task depends on this task's output — it's a verification gate before Task 5/6.

This does **not** invoke Odoo or the real `runSync` pipeline — per the spec, that's out of scope for this check. It only exercises the exact two API calls this migration changed: `initializeApp()`/`getApps()` (executed automatically when the compiled module is `require`d, since that line runs at module scope) and `getFirestore()` (called explicitly below, the same call both handlers now make).

- [ ] **Step 1: Write the verification script**

Create `functions/verify-admin-sdk.cjs`:

```js
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

const { getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

require("./lib/index.js"); // runs the module-scope initializeApp() check

async function main() {
  console.log("Apps after module load:", getApps().length);
  const db = getFirestore();
  const ref = db.collection("_migrationVerify").doc("smoke");
  await ref.set({ ok: true, checkedAtISO: new Date().toISOString() });
  const snap = await ref.get();
  console.log("Read back:", JSON.stringify(snap.data()));
  await ref.delete();
  console.log("VERIFY_OK");
}

main().catch((err) => {
  console.error("VERIFY_FAILED", err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Start the Firestore emulator, run the script, tear down — in one shell session**

Run (from the repo root):

```bash
cd functions
firebase emulators:start --only firestore --project smv-brain > verify-emulator.log 2>&1 &
EMU_PID=$!
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://127.0.0.1:8080; then
    echo "Emulator ready after ${i}s"
    break
  fi
  sleep 1
done
node verify-admin-sdk.cjs
kill $EMU_PID
```

Expected output includes, in order:
```
Emulator ready after Ns
Apps after module load: 1
Read back: {"ok":true,"checkedAtISO":"..."}
VERIFY_OK
```
If it instead prints `VERIFY_FAILED` with a stack trace, stop — do not proceed to Task 5/6. The most likely cause is a leftover `admin.` reference (re-check Task 2 Step 4) or the emulator not being ready yet (increase the poll loop).

- [ ] **Step 3: Delete the temporary script and emulator log (never commit them)**

```bash
rm -f functions/verify-admin-sdk.cjs functions/verify-emulator.log
git status
```
Expected: `git status` shows no trace of `verify-admin-sdk.cjs` or `verify-emulator.log` (working tree clean relative to Task 3's commit).

---

### Task 5: `npm audit` pass on `functions/`

**Files:**
- Modify (if fixes applied): `functions/package-lock.json`

**Interfaces:**
- Consumes: the clean `npm ci` state from Task 1.
- Produces: an updated vulnerability count to report to the user, and (if `npm audit fix` changes anything) a re-verified `package-lock.json` that Task 6 deploys.

- [ ] **Step 1: Run the audit**

Run: `npm audit --prefix functions`
Record the vulnerability summary line (baseline before this plan: 10 vulnerabilities — 4 moderate, 5 high, 1 critical — under firebase-admin v11).

- [ ] **Step 2: Apply semver-compatible fixes only**

Run: `npm audit fix --prefix functions`
Do **not** pass `--force` (that can bump majors outside what Task 1 pinned). Expected: exits 0.

- [ ] **Step 3: Re-verify the lockfile still matches `npm ci`**

Run:
```bash
rm -rf functions/node_modules
npm ci --prefix functions
npm --prefix functions run build
```
Expected: both exit 0 (same check as Task 1 Step 4 — `audit fix` can rewrite the lockfile, so this must be re-confirmed).

- [ ] **Step 4: Report and commit**

Report the before/after vulnerability counts to the user. If `functions/package-lock.json` changed:
```bash
git add functions/package-lock.json
git commit -m "chore(functions): npm audit fix (semver-compatible)"
```
If nothing changed, skip the commit.

---

### Task 6: Deploy to production (requires explicit user confirmation)

**Files:** none (deploy-only task).

**Interfaces:**
- Consumes: the verified, committed state from Tasks 1–5 (passing build, passing `npm ci`, passing emulator smoke test, audited dependencies).

**Do not run Step 2 without the user explicitly confirming in this conversation** — this deploys to the live `smv-brain` project and replaces the currently-running `syncSuprajitOrders` (30-min schedule) and `triggerOdooSync` (callable backing the Refrescar button).

- [ ] **Step 1: Present the deploy summary and ask for confirmation**

Tell the user: which versions are being deployed (firebase-functions ^7.2.5, firebase-admin ^14.1.0, Node 22), that the emulator smoke test passed, and the final `npm audit` count. Ask them to confirm before deploying.

- [ ] **Step 2: Deploy**

Run: `firebase deploy --only functions --project smv-brain`
Expected: deploy succeeds, CLI reports both `syncSuprajitOrders` and `triggerOdooSync` updated, no runtime-mismatch or permission errors.

- [ ] **Step 3: Spot-check logs**

Run: `firebase functions:log --only syncSuprajitOrders,triggerOdooSync --project smv-brain -n 20`
Expected: no crash-loop errors immediately after deploy (a fresh deploy doesn't invoke the functions immediately, but this confirms the deploy registered cleanly and there are no cold-start errors from a prior invocation still surfacing).
