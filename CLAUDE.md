# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Vite dev server on port 3000 (host 0.0.0.0)
npm run build        # Production build
npm run lint         # Type-check with tsc --noEmit (no Jest/Vitest — no test runner)
npm run toolcrib:bootstrap  # Populate Firestore catalog (see script docs below)
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

## Architecture

### Analysis pipeline (`App.tsx`)

`App.tsx` is the central orchestrator — it's intentionally monolithic. The analysis flow runs in `extractInfo()`:

1. **Order extraction** — `gemini-3.5-flash` reads the order report PDF and returns structured JSON (piece name, qty, order #, date, priority). Results are cached in IndexedDB keyed by `ORDER_PROMPT_VERSION`.
2. **Auto-matching** — `listActiveDrawingViews()` fetches the Tool Crib catalog from Firestore and scores each order against each library entry using `scorePieceMatch` / `extractLibrarySignals`. Matching blueprints are auto-fetched via `fetchPdfAsDataUrl` and added to the workspace without user interaction.
3. **PDF rasterization** — Blueprint PDFs are sent to a dedicated Web Worker (`src/workers/pdfImageWorker.ts`) that renders page 1 with pdf.js (OffscreenCanvas, `disableWorker: true`) and normalizes the output to JPEG.
4. **Blueprint analysis** — The JPEG is sent to `gemini-3.5-flash` Vision; it returns `BlueprintSpec[]` with piece label and an isometric bounding box (`[ymin, xmin, ymax, xmax]` on a 0–1000 grid). Results are cached in IndexedDB keyed by `BLUEPRINT_PROMPT_VERSION`.
5. **Merge + crop** — Orders are matched to blueprint specs. The bounding box is used to `cropIsometricView()` from the rasterized JPEG. Falls back to `FALLBACK_CENTER_BOX = [30, 30, 720, 970]` if the box is invalid.
6. **PDF export** — `jsPDF` + `jspdf-autotable` generates the final report with one row per order and the cropped isometric image embedded.

Up to 8 blueprints are analyzed concurrently (`MAX_BLUEPRINT_CONCURRENCY = 8`, via `runWithConcurrencyLimit` in `src/lib/documentAnalysis/concurrency.ts`). Results are cached in IndexedDB by document SHA-256 + prompt version (`src/lib/documentAnalysis/cache.ts`, TTL: 7 days).

**Prompt versioning**: When the Gemini prompts in `extractInfo()` change, bump `ORDER_PROMPT_VERSION` or `BLUEPRINT_PROMPT_VERSION` at the top of `App.tsx` to invalidate stale IndexedDB cache entries for all users.

### Firebase layer (`src/lib/firebase/`)

All Firebase functions use a **result type** — they never throw:
```ts
type ToolcribResult<T> = { ok: true; value: T } | { ok: false; reason: ToolcribFailureReason }
```

Key modules:
- `client.ts` — Lazy singleton for `FirebaseApp` + `Firestore`. Returns `null` if config is missing; callers treat this as "feature disabled". Exports `__resetFirebaseClientForTests()` to clear cached singletons in tests.
- `toolcrib.ts` — Read-only catalog queries (`listActiveDrawingViews`, `getActiveDrawingForPart`) and `recordToolcribPrintLog` (write). Auth UID is resolved inside the writer — callers cannot spoof it.
- `analysisRuns.ts` — Fire-and-forget audit log for each analysis run.
- `auth.ts` — Google and email/password sign-in; `useFirebaseUser()` hook (backed by `useSyncExternalStore`). Google sign-in uses redirect flow on localhost in DEV, popup flow in production.
- `env.ts` — Reads and caches Firebase config from `import.meta.env`. `isToolcribDebugUnauthAllowed()` is gated to `DEV` only.
- `toolcribValidators.ts` / `validators.ts` — Runtime shape normalization for all Firestore documents.

### Firestore collections

| Collection | Purpose |
|---|---|
| `toolcribParts` | Part catalog (`partNumber`, `customer`, `status: active`) |
| `toolcribDrawings` | Drawing revisions per part (`partId`, `revision`, `isActive`, `sourceType`, `sourcePath`, `pdfUrl`) |
| `toolcribPrintLogs` | Audit log for PDF prints (`drawingId`, `printedByUid` from server auth) |
| `analysisRuns` | Audit log for each `extractInfo()` run |

Security rules (`firestore.rules`): any authenticated user can read/write. Data validation lives in TypeScript, not in rules.

**Two-query join**: `listActiveDrawingViews` issues exactly two Firestore reads — one for parts, one for all active drawings (`isActive == true`) — then joins them in memory by `partId`. No N+1.

### Web Worker (`src/workers/pdfImageWorker.ts`)

Receives `rasterize-normalize` messages. Uses `pdfjsLib` with `disableWorker: true` (nested workers are unsupported in Safari). WASM files are served from `/pdfjs-wasm/` (Vite copies them from `node_modules/pdfjs-dist/wasm/` at build time via `syncPdfjsWasm()` in `vite.config.ts` — the path must stay unhashed). Message IDs correlate async requests back to promises via `pendingRequests` Map in `pdfWorkerClient.ts`.

### Component tree

- `main.tsx` wraps `<App>` in `<AuthGate>`.
- `AuthGate` (`src/components/AuthGate.tsx`) — Shows login screen if Firebase is configured and user is not authenticated. Passes through if Firebase is unconfigured or `isBypassed`. The "bypass" button in the login UI enables unauthenticated access (audit logs will not be recorded).
- `ToolcribLibraryPanel` (`src/components/ToolcribLibraryPanel.tsx`) — Reads `listActiveDrawingViews` on mount, renders a searchable list with Print and Attach actions. Deduplication via `attachedDrawingIds` prop (Set of `drawingId`).

### Piece-matching algorithm

The fuzzy matcher in `App.tsx` operates in two stages:

1. **Strong identifier match** — `extractPartIdentifiers` finds alphanumeric part numbers (segmented runs with separators, or compact runs ≥5 chars with a digit). If both sides have identifiers and they match (exact or substring ≥6 chars), the score is **95**. If both sides have identifiers but they *don't* match, the score is **0** (hard veto — prevents "90-1012-05" from matching "90-1012-06" on shared prefix).
2. **Descriptor overlap** — `descriptiveTokens` tokenizes meaningful words (≥3 chars, has a letter, no 3+ digit run, not a stop word from `COMMON_STOP_WORDS`). Overlap is scored by Jaccard ratio: **85** if a strong token is shared and ratio ≥ 0.6; **82** if ≥2 tokens shared and ratio ≥ 0.5. `MIN_BLUEPRINT_MATCH_SCORE = 80`.

`selectBestBlueprintMatch` scores against both the file path/name (`extractBlueprintSignals`) and the AI-detected `pieza_detectada`. A file-level match is enough to adopt a spec even if the AI label is weak.

Bounding boxes from AI: `[ymin, xmin, ymax, xmax]` on a 0–1000 grid. A box is invalid if: area < 5% of the grid (side ≤ 50), area > ~56% (width × height > 750 × 750), or it's a sliver (short side < 25% of long side). Invalid boxes fall back to `FALLBACK_CENTER_BOX = [30, 30, 720, 970]`.

### Styling

Tailwind v4 is used via the `@tailwindcss/vite` plugin — there is no `tailwind.config.js`. Custom color tokens (`bg`, `ink`, `accent`) are defined as CSS variables in `src/index.css`. The UI uses a brutalist design language with hard 2px borders and offset box-shadows.

### Build chunking

The Vite build splits vendor code into named chunks to avoid one giant bundle: `pdfjs-vendor`, `genai-vendor`, `motion-vendor`, `react-vendor`. This is configured in `vite.config.ts` under `build.rollupOptions.output.manualChunks`.

### Shared utilities

`fetchPdfAsDataUrl` (30-second AbortController timeout, FileReader → dataURL) lives in `src/lib/fetchPdf.ts` and is consumed by `App.tsx` (auto-matching) and `ToolcribLibraryPanel.tsx` (manual attach).
