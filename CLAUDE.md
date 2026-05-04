# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Vite dev server on port 3000
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

## Architecture

### Analysis pipeline (App.tsx)

`App.tsx` is the central orchestrator — it's intentionally monolithic. The analysis flow runs in `extractInfo()`:

1. **Order extraction** — Gemini `gemini-1.5-pro` reads the order report PDF and returns structured JSON (piece name, qty, order #, date, priority).
2. **Auto-matching** — `listActiveDrawingViews()` fetches the Tool Crib catalog from Firestore and scores each order against each library entry using the fuzzy matching functions in `App.tsx` (`scorePieceMatch`, `extractPartIdentifiers`, `descriptiveTokens`, etc.).
3. **PDF rasterization** — Blueprint PDFs are sent to a dedicated Web Worker (`src/workers/pdfImageWorker.ts`) that renders page 1 with pdf.js (OffscreenCanvas, `disableWorker: true`) and normalizes the output to JPEG.
4. **Blueprint analysis** — The JPEG is sent to Gemini Vision; it returns `BlueprintSpec[]` with piece label and an isometric bounding box (`[ymin, xmin, ymax, xmax]` on a 0–1000 grid).
5. **Merge + crop** — Orders are matched to blueprint specs. The bounding box is used to `cropIsometricView()` from the rasterized JPEG. Falls back to a center crop if the box is invalid.
6. **PDF export** — `jsPDF` + `jspdf-autotable` generates the final report with one row per order and the cropped isometric image embedded.

Up to 3 blueprints are analyzed concurrently (`runWithConcurrencyLimit` in `src/lib/documentAnalysis/concurrency.ts`). Results are cached in IndexedDB by document SHA-256 + prompt version (`src/lib/documentAnalysis/cache.ts`).

### Firebase layer (`src/lib/firebase/`)

All Firebase functions use a **result type** — they never throw:
```ts
type ToolcribResult<T> = { ok: true; value: T } | { ok: false; reason: ToolcribFailureReason }
```

Key modules:
- `client.ts` — Lazy singleton for `FirebaseApp` + `Firestore`. Returns `null` if config is missing; callers treat this as "feature disabled".
- `toolcrib.ts` — Read-only catalog queries (`listActiveDrawingViews`, `getActiveDrawingForPart`) and `recordToolcribPrintLog` (write). Auth UID is resolved inside the writer — callers cannot spoof it.
- `analysisRuns.ts` — Fire-and-forget audit log for each analysis run.
- `auth.ts` — Google and email/password sign-in; `useFirebaseUser()` hook.
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

### Web Worker (`src/workers/pdfImageWorker.ts`)

Receives `rasterize-normalize` messages. Uses `pdfjsLib` with `disableWorker: true` (nested workers are unsupported in Safari). WASM files are served from `/pdfjs-wasm/` (Vite copies them from `node_modules/pdfjs-dist/wasm/` at build time — the path must stay unhashed). Message IDs correlate async requests back to promises via `pendingRequests` Map in the client.

### Component tree

- `main.tsx` wraps `<App>` in `<AuthGate>`.
- `AuthGate` (`src/components/AuthGate.tsx`) — Shows login screen if Firebase is configured and user is not authenticated. Passes through if Firebase is unconfigured or `isBypassed`.
- `ToolcribLibraryPanel` (`src/components/ToolcribLibraryPanel.tsx`) — Reads `listActiveDrawingViews` on mount, renders a searchable list with Print and Attach actions. Deduplication via `attachedDrawingIds` prop (Set of `drawingId`).

### Piece-matching algorithm

The fuzzy matcher in `App.tsx` operates in two stages:
1. **Strong identifier match** — extracts structured part numbers (alphanumeric runs with separators, ≥5 chars with a digit) and requires an exact or substring match when both sides have identifiers.
2. **Descriptor overlap** — tokenizes descriptive words (≥3 chars, has a letter, no long digit run, not a stop word) and scores by Jaccard ratio. Score thresholds: 100 exact, 98/94/92/88 with IDs, 85/82/80 descriptor-only. `MIN_BLUEPRINT_MATCH_SCORE = 80`.

Bounding boxes from AI: `[ymin, xmin, ymax, xmax]` on a 0–1000 grid. Invalid boxes (< 5% area or > 64% area) fall back to `FALLBACK_CENTER_BOX = [200, 200, 800, 800]`.
