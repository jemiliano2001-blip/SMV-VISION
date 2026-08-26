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
npm run toolcrib:dedupe          # Detect duplicate drawings (dry-run)
npm run toolcrib:dedupe:execute  # Remove duplicate drawings (writes to Firestore)
npm run toolcrib:edrawings-iso   # ISO + CAD from CAD sources (eDrawings/SolidWorks) — see AGENTS.md
npm run toolcrib:upload-stls     # Upload standalone exported STLs, match by identifier (not substring)
npm run toolcrib:audit           # Read-only per-piece report: CAD/ISO/STL coverage in the catalog
npm test -- matching             # Run a single test file by name pattern
```

*El sync corre en la nube (Cloud Function). No hay sync local.*

**Bootstrap script** (populates `toolcribParts` / `toolcribDrawings`):
```bash
# Dry-run from a JSON inventory
npx tsx scripts/toolcribBootstrap.ts --inventory=./inventory.json --dryRun

# Scan a directory of PDFs
npx tsx scripts/toolcribBootstrap.ts --scan=./TOOL\ CRIB --customer=SUPRAJIT

# Production write (requires GOOGLE_APPLICATION_CREDENTIALS or --credentials=)
npx tsx scripts/toolcribBootstrap.ts --inventory=./inventory.json --credentials=./serviceAccount.json
```

**Odoo sync** — La Cloud Function V2 es la **única** ruta de sincronización. Fuente: `functions/src/index.ts`. Exporta `syncSuprajitOrders` (schedule cada 30 min) y `triggerOdooSync` (callable, requiere `request.auth`; la usa el botón REFRESCAR de `OdooOrdersPanel`). Ambas llaman a `runSync()`. Escribe `odooSaleOrders`, `workOrders` y `syncMeta/odoo`.

## Environment variables

Copy `.env.example` to `.env.local`. `VITE_FIREBASE_*` is required for anything to work end-to-end — Gemini calls go through the authenticated `analyzeGemini` Cloud Function (see below), so without Firebase configured the app loads but "Analizar" fails with "Firebase no está configurado". Their absence otherwise only disables the audit trail and Tool Crib library.

| Variable | Required | Purpose |
|---|---|---|
| `VITE_FIREBASE_*` (6 vars) | Yes (for Gemini analysis) | Auth + Firestore audit trail + Tool Crib catalog + the `analyzeGemini` callable |
| `VITE_TOOLCRIB_DEBUG_ALLOW_UNAUTH` | No | Skip auth gate in DEV only |
| `DISABLE_HMR` | No | Set to `true` to disable Vite HMR (used in AI Studio) |
| `ODOO_URL` / `ODOO_DB` / `ODOO_USER` | Cloud Function only | Odoo 15 JSON-RPC sync. Read from `functions/.env` via `process.env` in `functions/src/index.ts` — never exposed to the browser |
| `ODOO_API_KEY` | Cloud Function only | Odoo password. A Secret Manager secret (`defineSecret`), not an env var — read with `ODOO_API_KEY.value()` |
| `GEMINI_API_KEY` | Cloud Function only | Gemini key. A Secret Manager secret (`defineSecret` in `functions/src/gemini.ts`), set via `firebase functions:secrets:set GEMINI_API_KEY` — never exposed to the browser |

## Architecture

### Multi-view application shell

`App.tsx` owns all state and routes between views via `AppShell` + `NavRail` (left-side navigation rail):

- **Inicio** (`InicioView.tsx`) — Landing view. Reads three live counters on mount
  (`listOrdersToInvoice().length`, `listEntregasSinOC().length`, `useSyncMeta()`) and
  offers quick actions to the other views. Remounts on every visit (`App.tsx` gates it
  behind `activeView === 'inicio'`), so the counters refresh without a refresh button.
- **Generar Reporte** (`reporte` view in `App.tsx`) — Report generation interface: Odoo order extraction, blueprint library attachment, PDF workspace management, and auditing pipeline powered by `useVisionAnalysis`.
- **Órdenes** (`OdooOrdersPanel.tsx`) — Read-only list of Odoo sale orders, synced by the Cloud Function (`functions/src/index.ts`). Has a view-mode toggle (`all` / `by_requisitor`) plus a requisitor selector that groups orders by both Requisitor and Ingeniero — not just a flat list.
- **Biblioteca** (`BibliotecaView.tsx`) — Tool Crib catalog browser; wraps `ToolcribLibraryPanel`.
- **Compras** (`ComprasPanel.tsx`) — Purchase catalog (metals, assemblies, tools, other). CRUD interface backed by Firestore `purchases` collection.

The Reporte view stays mounted but hidden (`display: none`) so UI state and PDF cache are preserved across navigation.

### Analysis pipeline (`src/hooks/useVisionAnalysis.ts`)

`App.tsx` wires views and passes callbacks; all analysis state and the `extractInfo()` flow live in the `useVisionAnalysis` hook. The pipeline:

1. **Order extraction** — Las órdenes vienen de Firestore (`odooSaleOrders`) vía `listOrdersToInvoice()`. No hay PDF de órdenes ni llamada a Gemini en este paso. Cada línea de orden con `qty_pending_from_pickings > 0` se mapea a un `ExtractedOrder`. La constante `ORDER_PROMPT_VERSION` sobrevive **solo** como etiqueta en el log de auditoría `analysisRuns`.
2. **Auto-matching** — `listActiveDrawingViews()` fetches the Tool Crib catalog from Firestore and scores each order against each library entry using `scorePieceMatch` / `extractLibrarySignals`. **ISO-first**: if any ISO drawing scores ≥ `MIN_BLUEPRINT_MATCH_SCORE`, it wins over any CAD drawing regardless of score. Matching blueprints are auto-fetched via `fetchPdfAsDataUrl` and added to the workspace without user interaction. Hot-stamp orders (`isHotStampPiece`) are matched by keyword search (the fuzzy matcher can't connect "HOT STAMP LETRA M" with "PUNZONES DE MARCA").
3. **PDF rasterization** — Blueprint PDFs are sent to a dedicated Web Worker (`src/workers/pdfImageWorker.ts`) that renders page 1 with pdf.js (OffscreenCanvas, `disableWorker: true`) and normalizes the output to JPEG.
4. **Blueprint analysis** — The JPEG is sent to `gemini-3.5-flash` Vision **via the `analyzeGemini` Cloud Function** (`src/lib/geminiProxy.ts` → `functions/src/gemini.ts`), not directly from the browser — the Gemini API key lives only in Secret Manager. It returns `BlueprintSpec[]` with piece label and an isometric bounding box (`[ymin, xmin, ymax, xmax]` on a 0–1000 grid). Results are cached in IndexedDB keyed by `BLUEPRINT_PROMPT_VERSION`. **Two-pass refinement**: if the initial bounding box area exceeds `REFINEMENT_SKIP_AREA_THRESHOLD = 400_000` (~632×632 px), a second Gemini call (same proxy) crops the region and re-asks for a tighter box, then maps coordinates back to the original 0–1000 space.
5. **Progressive merge** — Blueprint results are applied to the order list as each blueprint completes (not at the end). `cropIsometricView()` crops the matched region from the rasterized JPEG. Falls back to `FALLBACK_CENTER_BOX = [30, 30, 720, 970]` if the box is invalid.
6. **PDF export** — `jsPDF` + `jspdf-autotable` via `src/lib/pdfGenerator.ts` generates the final report with one row per order and the cropped isometric image embedded. Both `jsPDF`/`jspdf-autotable` and `pdf-lib` (`src/lib/planoOt.ts`) are dynamically `import()`ed at call time, not bundled into the initial page load.

Up to 8 blueprints are analyzed concurrently (`MAX_BLUEPRINT_CONCURRENCY = 8`, via `runWithConcurrencyLimit` in `src/lib/documentAnalysis/concurrency.ts`). Results are cached in IndexedDB by document SHA-256 + prompt version (`src/lib/documentAnalysis/cache.ts`, TTL: 7 days). All Gemini calls go through `callGeminiProxy` (`src/lib/geminiProxy.ts`) wrapped in `callWithRetry` (max 3 attempts, exponential backoff: 1s/2s — retries only transient errors: 429/5xx or Functions codes like `unavailable`/`internal`, not `unauthenticated`/`invalid-argument`).

### Gemini proxy (`src/lib/geminiProxy.ts` + `functions/src/gemini.ts`)

The browser never holds a Gemini API key. `callGeminiProxy({ model, contents, config })` calls the authenticated callable `analyzeGemini` (requires `request.auth`, same pattern as `triggerOdooSync`), which holds the real key via Secret Manager and forwards the request to `ai.models.generateContent`. The function returns `{ candidates }`; the client derives `.text` itself (`extractResponseText`) by replicating the `@google/genai` SDK's own getter logic (concatenate `part.text` from the first candidate, skipping `thought` parts). `@google/genai` is not a client dependency at all anymore — schema `type` fields (`Type.OBJECT` etc.) are just plain strings (`'OBJECT'`) since the enum is a string enum. Deploy with `firebase deploy --only functions:analyzeGemini`; set the secret once with `firebase functions:secrets:set GEMINI_API_KEY`.

**Prompt versioning**: When the Gemini prompts in `extractInfo()` change, bump `ORDER_PROMPT_VERSION` or `BLUEPRINT_PROMPT_VERSION` at the top of `src/hooks/useVisionAnalysis.ts` to invalidate stale IndexedDB cache entries for all users. App version is exposed as `__APP_VERSION__` (defined in `vite.config.ts` from `package.json`).

### Purchases module

A simple purchase catalog for tracking materials and components needed for production.

Key modules:
- `src/lib/firebase/purchases.ts` — Data layer using the result-type contract (never throws). Exports `listPurchases`, `createPurchase`, `updatePurchase`, `deletePurchase`.
- `src/lib/firebase/purchaseValidators.ts` — Runtime shape normalization for Firestore `purchases` documents.
- `src/components/ComprasPanel.tsx` — Full CRUD UI with search and sort. Item types: `metal`, `ensamble`, `herramienta`, `otro`.

Firestore collection `purchases`: `{ id, nombre, tipo, sku, proveedor, link, notas, createdAtUTC, updatedAtUTC }`

### Firebase layer (`src/lib/firebase/`)

All Firebase functions use a **result type** — they never throw:
```ts
type ToolcribResult<T> = { ok: true; value: T } | { ok: false; reason: ToolcribFailureReason }
```

Key modules:
- `client.ts` — Lazy singleton for `FirebaseApp` + `Firestore`. Returns `null` if config is missing; callers treat this as "feature disabled". Exports `__resetFirebaseClientForTests()` to clear cached singletons in tests.
- `toolcrib.ts` — Read-only catalog queries (`listActiveDrawingViews`, `getActiveDrawingForPart`, `getDrawingById`) and `recordToolcribPrintLog` (write). Auth UID is resolved inside the writer — callers cannot spoof it.
- `purchases.ts` — CRUD for `purchases` collection. Exports `listPurchases`, `createPurchase`, `updatePurchase`, `deletePurchase`.
- `odooOrders.ts` — Read-only queries for `odooSaleOrders` (`listOrdersToInvoice`, `listEntregasSinOC`). Same result-type contract; writing is done only by Cloud Function.
- `syncOdoo.ts` — Wrapper cliente de `httpsCallable('triggerOdooSync')`.
- `authValidators.ts` — Normalización de forma para el usuario de Auth.
- `analysisRuns.ts` — Fire-and-forget audit log for each analysis run.
- `auth.ts` — Email/password sign-in only (Google flow removed on purpose: private app without domain allowlist); `useFirebaseUser()` hook (backed by `useSyncExternalStore`).
- `env.ts` — Reads and caches Firebase config from `import.meta.env`. `isToolcribDebugUnauthAllowed()` is gated to `DEV` only.
- `toolcribValidators.ts` / `purchaseValidators.ts` / `validators.ts` — Runtime shape normalization for all Firestore documents.
- `src/lib/invoiceEmail.ts` — Plantillas de correo de solicitud de factura.
- `src/lib/planoOt.ts` — Usado por `ToolcribPrintModal`.
- `src/hooks/useSyncMeta.ts` — Suscripción al doc `syncMeta/odoo` (chip de estado).

### Firestore collections

| Collection | Purpose |
|---|---|
| `toolcribParts` | Part catalog (`partNumber`, `customer`, `status: active`) |
| `toolcribDrawings` | Drawing revisions per part (`partId`, `revision`, `isActive`, `sourceType`, `sourcePath`, `pdfUrl`) |
| `toolcribPrintLogs` | Audit log for PDF prints (`drawingId`, `printedByUid` from server auth) |
| `analysisRuns` | Audit log for each vision analysis run |
| `odooSaleOrders` | Odoo sale orders synced by Cloud Function — read-only from the app |
| `syncMeta` | Single doc `odoo` with last-sync status (`lastSyncAt`, `ordersProcessed`, `status`, `errorMessage?`), written by Cloud Function on every run (success and failure); read by the status chip in `OdooOrdersPanel` |
| `purchases` | Purchase catalog items (`nombre`, `tipo`, `sku`, `proveedor`, `link`, `notas`), managed by `ComprasPanel` |

Security rules (`firestore.rules`): least-privilege per collection with default deny. `odooSaleOrders` / `syncMeta` / `workOrders` are read-only from the client (written only by the Admin SDK, which bypasses rules). `toolcribPrintLogs` and `analysisRuns` are create-only and immutable, with the auth uid enforced in rules (`printedByUid` / `userUid` / `createdByUid` must equal `request.auth.uid`). `purchases` is full CRUD for any signed-in user. Data *shape* validation lives in TypeScript validators; rules enforce identity and write surface.

**Dual-database (`smv-brain`) — crítico:** Vision usa Firestore `(default)`; SMV-Hub usa la DB nombrada `compras-americanas`. Son reglas independientes. Nunca desplegar las reglas del Hub sobre `(default)` (borran acceso a `odooSaleOrders` / toolcrib / purchases → "Error al leer la base de datos"). Deploy Vision: `firebase deploy --only firestore:rules` desde este repo (apunta a `(default)` en `firebase.json`).

**Two-query join**: `listActiveDrawingViews` issues exactly two Firestore reads — one for parts, one for all active drawings (`isActive == true`) — then joins them in memory by `partId`. No N+1.

### Web Worker (`src/workers/pdfImageWorker.ts`)

Receives `rasterize-normalize` messages. Uses `pdfjsLib` with `disableWorker: true` (nested workers are unsupported in Safari). WASM files are served from `/pdfjs-wasm/` (Vite copies them from `node_modules/pdfjs-dist/wasm/` at build time via `syncPdfjsWasm()` in `vite.config.ts` — the path must stay unhashed). Message IDs correlate async requests back to promises via `pendingRequests` Map in `pdfWorkerClient.ts`.

### Component tree

- `main.tsx` wraps `<App>` in `<ErrorBoundary>` → `<AuthGate>`.
- `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) — Global boundary: replaces the blank screen on render crashes with a recoverable error screen (reload button). Event-handler/promise errors do NOT route here; those use the result-type contract.
- `AuthGate` (`src/components/AuthGate.tsx`) — Shows login screen if Firebase is configured and user is not authenticated. Passes through if Firebase is unconfigured or bypassed (DEV-only button). Fail-closed: if Firebase IS configured but Auth fails to initialize, it blocks with an error screen instead of passing through.
- `App.tsx` — Owns view state and the `useVisionAnalysis` hook. Routes between views via `AppShell` + `NavRail`.
- `AppShell` + `NavRail` (`src/components/shell/`) — Fixed left rail (desktop) / mobile hamburger menu (mobile) + full-viewport content area. NavRail exposes navigation buttons for all views.
- `ToolcribLibraryPanel` (`src/components/ToolcribLibraryPanel.tsx`) — Reads `listActiveDrawingViews` on mount, renders a searchable list with Print and Attach actions. Deduplication via `attachedDrawingIds` prop.
- `ComprasPanel` (`src/components/ComprasPanel.tsx`) — Purchase catalog CRUD with search/sort.
- `OdooOrdersPanel` (`src/components/OdooOrdersPanel.tsx`) — Read-only list of pending Odoo orders with sync status.
- `EntregasSinOCPanel` (`src/components/EntregasSinOCPanel.tsx`) — Vista "Entregas sin OC": órdenes de SUPRAJIT con remisión entregada pero sin número de OC del cliente. Depende de `listEntregasSinOC()` y del campo `state` del documento de Odoo.
- `InvoiceRequestPanel` (`src/components/InvoiceRequestPanel.tsx`) — Se renderiza dentro de `OdooOrdersPanel`, no es una vista del NavRail.
- `InicioView` + `BibliotecaView` (`src/components/`) — Dashboard and Tool Crib library views.

### Piece-matching algorithm (`src/lib/matching.ts`)

The fuzzy matcher operates in two stages:

1. **Strong identifier match** — `extractPartIdentifiers` finds alphanumeric part numbers (segmented runs with separators, or compact runs ≥5 chars with a digit). If both sides have identifiers and they match (exact or substring ≥6 chars), the score is **95**. If both sides have identifiers but they *don't* match, the score is **0** (hard veto — prevents "90-1012-05" from matching "90-1012-06" on shared prefix).
2. **Descriptor overlap** — `descriptiveTokens` tokenizes meaningful words (≥3 chars, has a letter, no 3+ digit run, not a stop word from `COMMON_STOP_WORDS`). Overlap is scored by Jaccard ratio: **85** if a strong token is shared and ratio ≥ 0.6; **82** if ≥2 tokens shared and ratio ≥ 0.5. `MIN_BLUEPRINT_MATCH_SCORE = 80`.

`selectBestBlueprintMatch` scores against both the file path/name (`extractBlueprintSignals`) and the AI-detected `pieza_detectada`. A file-level match is enough to adopt a spec even if the AI label is weak.

Bounding boxes from AI: `[ymin, xmin, ymax, xmax]` on a 0–1000 grid. A box is invalid if: area < 5% of the grid (side ≤ 50), area > ~56% (width × height > 750 × 750), or it's a sliver (short side < 25% of long side). Invalid boxes fall back to `FALLBACK_CENTER_BOX = [30, 30, 720, 970]`.

### Styling

Tailwind v4 is used via the `@tailwindcss/vite` plugin — there is no `tailwind.config.js`. Custom color tokens (`bg`, `ink`, `accent`, `danger`, `warn`, `ok`, `surface-2`, `line`) are defined as CSS variables in `src/index.css`. The UI uses a brutalist design language with hard 2px borders and offset box-shadows.

### Build chunking

The Vite build splits vendor code into named chunks to avoid one giant bundle: `react-vendor`, `genai-vendor`, `motion-vendor`, `firebase-vendor`, `pdf-gen-vendor` (jspdf + autotable), `pdf-lib-vendor`, `pdfjs-vendor` (pdfjs-dist main; note pdfjs-dist lives inside the worker bundle in practice); anything else in `node_modules` falls back into `react-vendor` (avoids a circular standalone `vendor` chunk). This is configured in `vite.config.ts` under `build.rollupOptions.output.manualChunks`.

### Shared utilities

- `fetchPdfAsDataUrl` (`src/lib/fetchPdf.ts`) — 30-second AbortController timeout, FileReader → dataURL. Used by `useVisionAnalysis` (auto-matching) and `ToolcribLibraryPanel.tsx` (manual attach).
- `src/lib/age.ts` — Date parsing, ISO date arithmetic (`parseDateToISO`, `addDaysToISODate`).
- `src/lib/reportFormat.ts` — Pure formatting functions for display (piece names, date labels).
- `src/lib/hotStamp.ts` — Consolidates hot-stamp orders sharing the same die across multiple POs.
- `src/lib/orderMerge.ts` — Merges grouped orders across multiple PDF uploads; handles multi-sheet PO reports.
- `src/lib/pdfGenerator.ts` — `generateReportPdf` and `generateSingleOrderPdf`. Logic extracted from `App.tsx`; callers pass explicit options instead of closing over component state.
- `src/lib/log.ts` — Dev-gated logger. `log.debug`/`log.info` only emit when `import.meta.env.DEV` is true; `log.warn`/`log.error` always emit. Use `log.*` instead of `console.*` for match/pipeline traces.
- `src/lib/imageProcessing.ts` — `isValidBoundingBox`, `cropIsometricView`, `cropToBoxRaw`. Bounding-box validation is pure (testable in Node); the crop functions require a browser Canvas (not testable in Node without jsdom).
- `src/lib/gemini.ts` — Low-level Gemini utilities: `callWithRetry` (exponential backoff, retries only transient errors), `preparePdfPart` / `prepareImagePart` (build `inlineData` part objects). All Gemini calls go through these.
- `src/lib/geminiProxy.ts` — `callGeminiProxy()`, the client for the `analyzeGemini` Cloud Function. See "Gemini proxy" above.
- `src/lib/blueprintParsers.ts` — `parseBoundingBox` and `parseBlueprintResponse` parse/validate raw Gemini Vision JSON into typed `BlueprintSpec[]`. Also exports `isRecord` / `asString` type-narrowing helpers.
- `src/components/charts/BarChart.tsx` / `LineChart.tsx` — Pure SVG chart components (no external charting library). **Currently unused** — not imported by any view, including `InicioView`. Check before assuming they're wired to anything.

### Tests

Unit tests live in `src/lib/__tests__/`. Test coverage is light; core logic tested includes `matching.ts`, `imageProcessing.ts`, `age.ts`. Run with `npm test` (single pass) or `npm run test:watch`. Priority: if modifying matching or image processing, run tests to catch regressions.

### Scripts

`scripts/` contains catalog management scripts:
- `scripts/toolcrib*.ts` — Tool Crib catalog management (upload PDFs, dedupe drawings, bootstrap, upload STLs, audit).
- `scripts/toolcribEdrawingsIso.ts` — CAD source (eDrawings/SolidWorks) → catalog. Produces both the ISO (isometric, from the 3D model) and the CAD (dimensioned plan, from a `.pdf` companion or a `.slddrw` export in flat mode) for each piece. See `AGENTS.md` → "Pipeline eDrawings" for the full contract.
- `scripts/toolcrib/lib/` — plumbing shared across the toolcrib scripts above: `firestoreCatalog.ts` (docIds, Storage upload, part/drawing upsert-with-merge) and `stlMatch.ts` (STL↔drawing identifier matching, used by `toolcribUploadStls.ts`).
- `scripts/edrawings/` — the native eDrawings exporter: `Export-EDrawings.ps1` (PowerShell, drives the `EDrawingOfficeAutomator.Document` COM automation with a real event bridge) and `exporterAdapter.ts` (Node adapter: command building, JPEG-reuse/resume, provenance sidecars).

The `functions/` directory contains Cloud Functions V2. Source of truth is `functions/src/index.ts` (TypeScript, compiled to the gitignored `functions/lib/` via `npm --prefix functions run build`; `firebase deploy` runs it automatically via the `predeploy` hook in `firebase.json`). Exports: `triggerOdooSync` (callable, requires `request.auth`; powers the Refrescar button) and `syncSuprajitOrders` (schedule cada 30 min). Note: la función escribe `odooSaleOrders`, `workOrders` y `syncMeta/odoo`.

### Path alias

`@` resolves to the project root (defined in `vite.config.ts`). Prefer `@/src/...` imports over relative `../../` chains when crossing directory boundaries.

## Important Patterns

### Result types
All Firebase functions follow a **result-type contract** — they never throw. Always check `result.ok` before accessing `result.value`:
```ts
const res = await listPurchases();
if (res.ok) {
  setItems(res.value);
} else {
  setError(res.reason);
}
```

### Prompt versioning
When Gemini prompts in `extractInfo()` change, bump `ORDER_PROMPT_VERSION` or `BLUEPRINT_PROMPT_VERSION` in `src/hooks/useVisionAnalysis.ts` to invalidate stale IndexedDB cache entries. This ensures all users see fresh AI results on next use.

### PDF caching
Analyzed blueprints are cached in IndexedDB (7-day TTL) keyed by document SHA-256 + prompt version. Cache miss is not an error — the UI simply re-analyzes (with exponential backoff via `callWithRetry`).

### Bounding-box validation
AI-generated bounding boxes `[ymin, xmin, ymax, xmax]` on a 0–1000 grid are validated by `isValidBoundingBox()`. Invalid boxes (area < 5%, area > 56%, or sliver proportions) fall back to `FALLBACK_CENTER_BOX = [30, 30, 720, 970]`.

## Wiki Knowledge Base

Path: `C:\Users\emili\claude-obsidian`

When you need context not already in this project:
1. Read `wiki/hot.md` first (recent context, ~500 words)
2. If not enough, read `wiki/index.md`
3. For SMV-specific context, read `wiki/entities/SMV-Vision.md` and `wiki/concepts/SMV-Analysis-Pipeline.md`
4. For context on related SMV projects, read `wiki/entities/projects-overview.md`

Do NOT read the wiki for general coding questions or things already in this CLAUDE.md.
