# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Vite dev server on port 3000 (host 0.0.0.0)
npm run build        # Production build
npm run lint         # Type-check with tsc --noEmit
npm test             # Run Vitest (single pass)
npm run test:watch   # Vitest in watch mode
npm run toolcrib:bootstrap  # Populate Firestore catalog (see script docs below)
npm run sync:odoo    # Sync Odoo sale orders → Firestore (odooSaleOrders + workOrders + syncMeta)
npm run sync:odoo:dry  # Dry-run of the Odoo sync (no writes)
npm run sync:odoo:install-task  # Register Windows scheduled task "SMV Odoo Sync" (hourly 7:00–19:00 weekdays)
npm run toolcrib:dedupe          # Detect duplicate drawings (dry-run)
npm run toolcrib:dedupe:execute  # Remove duplicate drawings (writes to Firestore)
npm test -- matching             # Run a single test file by name pattern
```

**Bootstrap script** (populates `toolcribParts` / `toolcribDrawings`):
```bash
# Dry-run from a JSON inventory
npx tsx scripts/toolcribBootstrap.ts --inventory=./inventory.json --dryRun

# Scan a directory of PDFs
npx tsx scripts/toolcribBootstrap.ts --scan=./TOOL\ CRIB --customer=SUPRAJIT

# Production write (requires GOOGLE_APPLICATION_CREDENTIALS or --credentials=)
npx tsx scripts/toolcribBootstrap.ts --inventory=./inventory.json --credentials=./serviceAccount.json
```

**Odoo sync** (`scripts/syncOdoo.ts`): the single source of truth for Odoo data. Each run upserts `odooSaleOrders`, creates/updates/archives `workOrders` from the order lines (new OTs are born with `dueDate = otDate + 14 días` and a Tool Crib drawing matched via `selectLibraryDrawingMatch` — no Gemini involved), and overwrites `syncMeta/odoo` with the run status. Scheduled execution: `scripts/runOdooSync.ps1` (wrapper, logs to `logs/syncOdoo.log`) registered by `npm run sync:odoo:install-task` as the Windows task "SMV Odoo Sync". There is **no** Cloud Function for this — `syncSuprajitOrders` was retired on 2026-06-11 (see `docs/superpowers/specs/2026-06-11-odoo-sync-scheduled-design.md`).

## Environment variables

Copy `.env.example` to `.env.local`. Only `VITE_GEMINI_API_KEY` is required; all Firebase vars are optional (their absence disables audit trail and Tool Crib library without breaking the main flow).

| Variable | Required | Purpose |
|---|---|---|
| `VITE_GEMINI_API_KEY` | Yes | Gemini API calls |
| `VITE_FIREBASE_*` (6 vars) | No | Firestore audit trail + Tool Crib catalog |
| `VITE_RECAPTCHA_SITE_KEY` | No | Firebase App Check (reCAPTCHA v3) |
| `VITE_APPCHECK_DEBUG` / `VITE_APPCHECK_DEBUG_TOKEN` | No | Local App Check bypass |
| `VITE_TOOLCRIB_DEBUG_ALLOW_UNAUTH` | No | Skip auth gate in DEV only |
| `DISABLE_HMR` | No | Set to `true` to disable Vite HMR (used in AI Studio) |
| `ODOO_URL` / `ODOO_DB` / `ODOO_USER` / `ODOO_API_KEY` | Scripts only | Odoo 15 JSON-RPC sync — never exposed to the browser |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Scripts only | Firebase Admin SDK for `syncOdoo.ts` |

## Architecture

### Multi-view application shell

`App.tsx` owns all state and routes between views via `AppShell` + `NavRail` (left-side navigation rail):

- **Inicio** (`InicioView.tsx`) — KPI dashboard: overdue/critical/warning counts, on-time %, immediate-attention shortcuts, and analytics charts (stage distribution, tornero workload, 30-day on-time trend via `BarChart`/`LineChart`). Reads from `useDashboardSummary` and navigates to Control with a pre-set alert filter on click.
- **Control** (`WorkOrdersPanel.tsx`) — Production control board (kanban or list). Full CRUD on work orders with 4-stage lifecycle and tornero management.
- **Órdenes** (`OdooOrdersPanel.tsx`) — Read-only list of Odoo sale orders pending invoicing, synced from `odooSaleOrders` via `src/lib/firebase/odooOrders.ts`.
- **Biblioteca** (`BibliotecaView.tsx`) — Tool Crib library (wraps `ToolcribLibraryPanel`).

The Reporte (analysis) view stays mounted but hidden so cached state is preserved. `useDashboardSummary` drives badge counts on the NavRail and is the single source of truth for aggregated work-order severity shared across NavRail, InicioView, and WorkOrdersPanel.

### Analysis pipeline (`src/hooks/useVisionAnalysis.ts`)

`App.tsx` wires views and passes callbacks; all analysis state and the `extractInfo()` flow live in the `useVisionAnalysis` hook. The hook delegates UI state to two sub-hooks: `useEditMode` (edit/exclude/restore orders, cantidad writes to Firestore) and `useResultsDisplay` (filter, search, preview state — returns `filteredResults`). The pipeline:

1. **Order extraction** — `gemini-3.5-flash` reads the order report PDF and returns structured JSON (piece name, qty, order #, date, priority). Results are cached in IndexedDB keyed by `ORDER_PROMPT_VERSION`.
2. **Auto-matching** — `listActiveDrawingViews()` fetches the Tool Crib catalog from Firestore and scores each order against each library entry using `scorePieceMatch` / `extractLibrarySignals`. **ISO-first**: if any ISO drawing scores ≥ `MIN_BLUEPRINT_MATCH_SCORE`, it wins over any CAD drawing regardless of score. Matching blueprints are auto-fetched via `fetchPdfAsDataUrl` and added to the workspace without user interaction. Hot-stamp orders (`isHotStampPiece`) are matched by keyword search (the fuzzy matcher can't connect "HOT STAMP LETRA M" with "PUNZONES DE MARCA").
3. **PDF rasterization** — Blueprint PDFs are sent to a dedicated Web Worker (`src/workers/pdfImageWorker.ts`) that renders page 1 with pdf.js (OffscreenCanvas, `disableWorker: true`) and normalizes the output to JPEG.
4. **Blueprint analysis** — The JPEG is sent to `gemini-3.5-flash` Vision; it returns `BlueprintSpec[]` with piece label and an isometric bounding box (`[ymin, xmin, ymax, xmax]` on a 0–1000 grid). Results are cached in IndexedDB keyed by `BLUEPRINT_PROMPT_VERSION`. **Two-pass refinement**: if the initial bounding box area exceeds `REFINEMENT_SKIP_AREA_THRESHOLD = 200_000`, a second Gemini call crops the region and re-asks for a tighter box, then maps coordinates back to the original 0–1000 space.
5. **Progressive merge** — Blueprint results are applied to the order list as each blueprint completes (not at the end). `cropIsometricView()` crops the matched region from the rasterized JPEG. Falls back to `FALLBACK_CENTER_BOX = [30, 30, 720, 970]` if the box is invalid.
6. **PDF export** — `jsPDF` + `jspdf-autotable` via `src/lib/pdfGenerator.ts` generates the final report with one row per order and the cropped isometric image embedded.
7. **Upsert to Firestore** — After analysis, orders are written to `workOrders` via `upsertWorkOrders`. The upsert is idempotent (keyed by `SO::parte`) and does **not** overwrite delivery/status state already set.

Up to 8 blueprints are analyzed concurrently (`MAX_BLUEPRINT_CONCURRENCY = 8`, via `runWithConcurrencyLimit` in `src/lib/documentAnalysis/concurrency.ts`). Results are cached in IndexedDB by document SHA-256 + prompt version (`src/lib/documentAnalysis/cache.ts`, TTL: 7 days). All Gemini API calls use `callWithRetry` (max 3 attempts, exponential backoff: 1s/2s).

**Prompt versioning**: When the Gemini prompts in `extractInfo()` change, bump `ORDER_PROMPT_VERSION` or `BLUEPRINT_PROMPT_VERSION` at the top of `src/hooks/useVisionAnalysis.ts` to invalidate stale IndexedDB cache entries for all users. App version is exposed as `__APP_VERSION__` (defined in `vite.config.ts` from `package.json`).

### Work Orders / Control de Producción

A production-tracking system layered on top of the analysis pipeline.

**4-stage lifecycle**: `pendiente → en_proceso → terminada → entregada`

Key modules:
- `src/lib/firebase/workOrders.ts` — Data layer. Same result-type contract as `toolcrib.ts` (never throws). `upsertWorkOrders` uses `WriteBatch` (max 500 ops/batch) and merges incoming orders without overwriting delivery state. Default cycle time: 14 days (`DEFAULT_CYCLE_DAYS`).
- `src/lib/workOrders/dedupe.ts` — Pure dedup logic. Dedup key: `SO::parte` (or `PO::…` fallback). `mergeUpsert` decides which mutable fields to refresh vs. which to preserve.
- `src/lib/workOrders/metrics.ts` — Severity and metrics calculations (`getDueDateSeverity`, `calcMetrics`). Shared between `WorkOrdersPanel`, `InicioView`, and `useDashboardSummary` — do not duplicate this logic elsewhere.
- `src/lib/planoOt.ts` — Stamps the **original** (full-dimension) blueprint PDF with an SO/cantidad/fecha badge in the top-left corner using `pdf-lib`. Does not crop — the tornero needs the full dimensions.

**Torneros** (lathe operators): managed via the `torneros` Firestore collection. `WorkOrdersPanel` exposes a side drawer for CRUD. Assignment tracked per order via `assignedToTornero` / `deliveredToTornero`.

### Firebase layer (`src/lib/firebase/`)

All Firebase functions use a **result type** — they never throw:
```ts
type ToolcribResult<T> = { ok: true; value: T } | { ok: false; reason: ToolcribFailureReason }
// WorkOrders uses the same pattern with WorkOrderResult<T>
```

Key modules:
- `client.ts` — Lazy singleton for `FirebaseApp` + `Firestore`. Returns `null` if config is missing; callers treat this as "feature disabled". Exports `__resetFirebaseClientForTests()` to clear cached singletons in tests.
- `toolcrib.ts` — Read-only catalog queries (`listActiveDrawingViews`, `getActiveDrawingForPart`, `getDrawingById`) and `recordToolcribPrintLog` (write). Auth UID is resolved inside the writer — callers cannot spoof it.
- `workOrders.ts` — Full CRUD for `workOrders` and `torneros` collections.
- `odooOrders.ts` — Read-only queries for `odooSaleOrders` (`listOrdersToInvoice`). Same result-type contract; writing is done only by `scripts/syncOdoo.ts`.
- `metricsSnapshots.ts` — Reads/writes `dailyMetricSnapshots` collection. `buildSnapshotData` is pure; `writeSnapshot` / `getTodaySnapshot` hit Firestore. Called by `useDailySnapshot` (fire-and-forget, errors never surfaced to UI).
- `analysisRuns.ts` — Fire-and-forget audit log for each analysis run.
- `auth.ts` — Google and email/password sign-in; `useFirebaseUser()` hook (backed by `useSyncExternalStore`). Google sign-in uses redirect flow on localhost in DEV, popup flow in production.
- `env.ts` — Reads and caches Firebase config from `import.meta.env`. `isToolcribDebugUnauthAllowed()` is gated to `DEV` only.
- `toolcribValidators.ts` / `workOrderValidators.ts` / `validators.ts` — Runtime shape normalization for all Firestore documents.

### Firestore collections

| Collection | Purpose |
|---|---|
| `toolcribParts` | Part catalog (`partNumber`, `customer`, `status: active`) |
| `toolcribDrawings` | Drawing revisions per part (`partId`, `revision`, `isActive`, `sourceType`, `sourcePath`, `pdfUrl`) |
| `toolcribPrintLogs` | Audit log for PDF prints (`drawingId`, `printedByUid` from server auth) |
| `analysisRuns` | Audit log for each `extractInfo()` run |
| `workOrders` | Production work orders — deduped by `SO::parte` key |
| `torneros` | Lathe operators (`name`, `active`) |
| `odooSaleOrders` | Odoo sale orders synced by `scripts/syncOdoo.ts` — read-only from the app |
| `syncMeta` | Single doc `odoo` with last-sync status (`lastSyncAt`, `ordersProcessed`, `status`, `errorMessage?`), written by `scripts/syncOdoo.ts` on every run (success and failure); read by the status chip in `OdooOrdersPanel` via `useSyncMeta` |
| `dailyMetricSnapshots` | One document per day keyed by ISO date; written by `useDailySnapshot` on first app load |

Security rules (`firestore.rules`): any authenticated user can read/write. Data validation lives in TypeScript validators, not in rules.

**Two-query join**: `listActiveDrawingViews` issues exactly two Firestore reads — one for parts, one for all active drawings (`isActive == true`) — then joins them in memory by `partId`. No N+1.

### Web Worker (`src/workers/pdfImageWorker.ts`)

Receives `rasterize-normalize` messages. Uses `pdfjsLib` with `disableWorker: true` (nested workers are unsupported in Safari). WASM files are served from `/pdfjs-wasm/` (Vite copies them from `node_modules/pdfjs-dist/wasm/` at build time via `syncPdfjsWasm()` in `vite.config.ts` — the path must stay unhashed). Message IDs correlate async requests back to promises via `pendingRequests` Map in `pdfWorkerClient.ts`.

### Component tree

- `main.tsx` wraps `<App>` in `<AuthGate>` and `<WorkOrdersProvider>`.
- `WorkOrdersProvider` (`src/contexts/WorkOrdersContext.tsx`) — Holds a single `onSnapshot` subscription to `workOrders` (archived == false), shared by `useDashboardSummary` and `WorkOrdersPanel`. Eliminates the double read that previously occurred when both components called `listWorkOrders()` independently. Exposes work orders and torneros via `useWorkOrdersContext()`. Also calls `useDailySnapshot` to write one metric snapshot per day. Must be placed inside `<AuthGate>` so the listener always starts with an active session.
- `AuthGate` (`src/components/AuthGate.tsx`) — Shows login screen if Firebase is configured and user is not authenticated. Passes through if Firebase is unconfigured or `isBypassed`. The "bypass" button enables unauthenticated access (audit logs will not be recorded).
- `AppShell` + `NavRail` (`src/components/shell/`) — Fixed left rail + full-viewport content area. `NavRail` receives `DashboardCounts` from `useDashboardSummary` for badge display.
- `WorkOrdersPanel` (`src/components/WorkOrdersPanel.tsx`) — Kanban/list board with alert-bar filters, search, and a side drawer for tornero management + production metrics.
- `ToolcribLibraryPanel` (`src/components/ToolcribLibraryPanel.tsx`) — Reads `listActiveDrawingViews` on mount, renders a searchable list with Print and Attach actions. Deduplication via `attachedDrawingIds` prop (Set of `drawingId`).

### Piece-matching algorithm (`src/lib/matching.ts`)

The fuzzy matcher operates in two stages:

1. **Strong identifier match** — `extractPartIdentifiers` finds alphanumeric part numbers (segmented runs with separators, or compact runs ≥5 chars with a digit). If both sides have identifiers and they match (exact or substring ≥6 chars), the score is **95**. If both sides have identifiers but they *don't* match, the score is **0** (hard veto — prevents "90-1012-05" from matching "90-1012-06" on shared prefix).
2. **Descriptor overlap** — `descriptiveTokens` tokenizes meaningful words (≥3 chars, has a letter, no 3+ digit run, not a stop word from `COMMON_STOP_WORDS`). Overlap is scored by Jaccard ratio: **85** if a strong token is shared and ratio ≥ 0.6; **82** if ≥2 tokens shared and ratio ≥ 0.5. `MIN_BLUEPRINT_MATCH_SCORE = 80`.

`selectBestBlueprintMatch` scores against both the file path/name (`extractBlueprintSignals`) and the AI-detected `pieza_detectada`. A file-level match is enough to adopt a spec even if the AI label is weak.

Bounding boxes from AI: `[ymin, xmin, ymax, xmax]` on a 0–1000 grid. A box is invalid if: area < 5% of the grid (side ≤ 50), area > ~56% (width × height > 750 × 750), or it's a sliver (short side < 25% of long side). Invalid boxes fall back to `FALLBACK_CENTER_BOX = [30, 30, 720, 970]`.

### Styling

Tailwind v4 is used via the `@tailwindcss/vite` plugin — there is no `tailwind.config.js`. Custom color tokens (`bg`, `ink`, `accent`, `danger`, `warn`, `ok`, `surface-2`, `line`) are defined as CSS variables in `src/index.css`. The UI uses a brutalist design language with hard 2px borders and offset box-shadows.

### Build chunking

The Vite build splits vendor code into named chunks to avoid one giant bundle: `pdfjs-vendor`, `genai-vendor`, `motion-vendor`, `react-vendor`. This is configured in `vite.config.ts` under `build.rollupOptions.output.manualChunks`.

### Shared utilities

- `fetchPdfAsDataUrl` (`src/lib/fetchPdf.ts`) — 30-second AbortController timeout, FileReader → dataURL. Used by `useVisionAnalysis` (auto-matching) and `ToolcribLibraryPanel.tsx` (manual attach).
- `src/lib/age.ts` — Date parsing, ISO date arithmetic (`parseDateToISO`, `addDaysToISODate`). Used by `workOrders.ts` to compute default due dates.
- `src/lib/reportFormat.ts` — Pure formatting functions for display (piece names, due-date labels, severity).
- `src/lib/hotStamp.ts` — Consolidates hot-stamp orders sharing the same die across multiple POs.
- `src/lib/orderMerge.ts` — Merges grouped orders across multiple PDF uploads; handles multi-sheet PO reports.
- `src/lib/pdfGenerator.ts` — `generateReportPdf` and `generateSingleOrderPdf`. Logic extracted from `App.tsx`; callers pass explicit options instead of closing over component state.
- `src/lib/log.ts` — Dev-gated logger. `log.debug`/`log.info` only emit when `import.meta.env.DEV` is true; `log.warn`/`log.error` always emit. Use `log.*` instead of `console.*` for match/pipeline traces.
- `src/lib/imageProcessing.ts` — `isValidBoundingBox`, `cropIsometricView`, `cropToBoxRaw`. Bounding-box validation is pure (testable in Node); the crop functions require a browser Canvas (not testable in Node without jsdom).
- `src/components/charts/BarChart.tsx` / `LineChart.tsx` — Pure SVG chart components used by `InicioView`. No external charting library; they accept typed data props and apply the project's CSS token colors.

### Path alias

`@` resolves to the project root (defined in `vite.config.ts`). Prefer `@/src/...` imports over relative `../../` chains when crossing directory boundaries.

### Unused dependencies

`@react-three/fiber`, `@react-three/drei`, and `@types/three` are installed but not imported anywhere in `src/`. Safe to remove unless a 3D feature is planned.

## Wiki Knowledge Base

Path: `C:\Users\emili\claude-obsidian`

When you need context not already in this project:
1. Read `wiki/hot.md` first (recent context, ~500 words)
2. If not enough, read `wiki/index.md`
3. For SMV-specific context, read `wiki/entities/SMV-Vision.md` and `wiki/concepts/SMV-Analysis-Pipeline.md`
4. For context on related SMV projects, read `wiki/entities/projects-overview.md`

Do NOT read the wiki for general coding questions or things already in this CLAUDE.md.
