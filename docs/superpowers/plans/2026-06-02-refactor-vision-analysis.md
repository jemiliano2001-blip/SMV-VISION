# Refactor: useVisionAnalysis hook, pdfGenerator, OrderCard, Optimistic UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce App.tsx from 2,601 lines to ~900 by extracting the analysis pipeline into `useVisionAnalysis`, extract PDF rendering into a pure `pdfGenerator.ts`, fix the `OrderCard` re-render anti-pattern in WorkOrdersPanel, and make status transitions feel instant via Optimistic UI.

**Architecture:** Four independent changes tackled in safe order: (1) pure PDF lib with no React deps, (2) analysis hook that owns all Gemini/pipeline state, (3) App.tsx wired to the hook, (4) WorkOrdersPanel OrderCard fix and optimistic status updates.

**Tech Stack:** React 19, TypeScript 5.8, jsPDF + jspdf-autotable (PDF rendering), Firebase Firestore (status persistence), Vite 6. No new dependencies.

---

## File Map

| File | Action | Result |
|---|---|---|
| `src/lib/pdfGenerator.ts` | CREATE | Pure PDF functions — no React state |
| `src/hooks/useVisionAnalysis.ts` | CREATE | All analysis state + logic (~900 lines) |
| `src/App.tsx` | MODIFY | Remove extracted code, wire hook (~900 lines) |
| `src/components/WorkOrdersPanel.tsx` | MODIFY | OrderCard module-scope + Optimistic UI |

---

## Task 1: Create `src/lib/pdfGenerator.ts`

**Files:**
- Create: `src/lib/pdfGenerator.ts`
- Modify: `src/App.tsx` (remove `downloadPdf` and `downloadSingleOrderPdf` in Task 3)

This is a pure extraction. The two PDF functions are moved verbatim from App.tsx with three parameter substitutions; no logic changes.

- [ ] **Step 1: Create the file with imports and interface**

Create `src/lib/pdfGenerator.ts` with:

```typescript
/**
 * Pure PDF rendering functions for the SMV Vision report.
 * No React state — callers pass everything as arguments.
 */
import jsPDF from 'jspdf';
import autoTable, { type CellHookData, type RowInput } from 'jspdf-autotable';
import type { Order, AnalysisRunSummary } from '../types';
import { consolidateHotStamps } from './hotStamp';
import {
  collapseDuplicateOrders,
  summarizeOrders,
  computeDueDate,
  dueLabel,
  fmtISOToDisplay,
  dueSeverity,
  dueDaysOrInfinity,
  withPartNumber,
  cleanPieceName,
} from './reportFormat';
import { formatAgeDays, getOrderAgeDays } from './age';

export interface ReportPdfOptions {
  /** Rasterized ISO reference image for the consolidated hot stamp row. */
  hotStampRefImage?: string | null;
  /** Run summary used to compute the audited-count header line. */
  analysisSummary?: AnalysisRunSummary | null;
}
```

- [ ] **Step 2: Add `generateSingleOrderPdf`**

Copy the body of `downloadSingleOrderPdf` (App.tsx lines 1461–1575) **verbatim** as the body of the new exported function. The only change is the function signature — it is no longer a closure:

```typescript
/**
 * Generates a single-order work ticket PDF and triggers browser download.
 */
export function generateSingleOrderPdf(order: Order): void {
  // ← paste the full body of `downloadSingleOrderPdf` from App.tsx here
  // No substitutions needed — the function already takes `order` as a parameter.
}
```

- [ ] **Step 3: Add `generateReportPdf`**

Copy the body of `downloadPdf` (App.tsx lines 1577–1848) as the new function. Apply these three substitutions before pasting:

| Old (App.tsx closure) | New (function parameter) |
|---|---|
| `if (!results) { return; }` | _(delete this guard — caller is responsible)_ |
| `results` (the state variable) | `orders` (the parameter) |
| `hotStampRefImageRef.current ?? undefined` | `options?.hotStampRefImage ?? undefined` |
| `analysisSummary?.totalAudited` | `options?.analysisSummary?.totalAudited` |
| `analysisSummary?.totalOrders` | `options?.analysisSummary?.totalOrders` |

```typescript
/**
 * Generates the full Suprajit work report PDF and triggers browser download.
 * Consolidates hot stamps, splits orders into audited/pending sections,
 * sorts by urgency, and embeds isometric images.
 */
export function generateReportPdf(orders: Order[], options?: ReportPdfOptions): void {
  // ← paste the body of `downloadPdf` from App.tsx (after the guard), applying
  //   the five substitutions listed above.
}
```

- [ ] **Step 4: Lint check**

```bash
npx tsc --noEmit
```

Expected: no errors. The file imports are all from existing modules; if TypeScript reports a missing export (e.g. `collapseDuplicateOrders`) check that `reportFormat.ts` exports it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdfGenerator.ts
git commit -m "feat: extract PDF rendering to lib/pdfGenerator.ts"
```

---

## Task 2: Create `src/hooks/useVisionAnalysis.ts` — skeleton + types

**Files:**
- Create: `src/hooks/useVisionAnalysis.ts`

- [ ] **Step 1: Create file with all imports**

Create `src/hooks/useVisionAnalysis.ts`:

```typescript
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  AnalysisMetrics,
  AnalysisRunSummary,
  BlueprintAnalysis,
  BlueprintSpec,
  BoundingBox,
  ExtractedOrder,
  Order,
  WorkOrder,
  WorkshopPdfUpload,
  ToolcribActiveDrawingView,
} from '../types';
import { createDocumentHash, readCachedValue, writeCachedValue } from '../lib/documentAnalysis/cache';
import { runWithConcurrencyLimit } from '../lib/documentAnalysis/concurrency';
import { rasterizeAndNormalizePdf } from '../lib/documentAnalysis/pdfWorkerClient';
import { recordAnalysisRunFireAndForget } from '../lib/firebase/analysisRuns';
import { log } from '../lib/log';
import { formatAgeDays, getOrderAgeDays } from '../lib/age';
import {
  MIN_BLUEPRINT_MATCH_SCORE,
  extractBlueprintSignals,
  extractLibrarySignals,
  extractOrderSignals,
  scorePieceMatch,
  selectBestBlueprintMatch,
} from '../lib/matching';
import { mergeGroupedOrders, parseOrdersResponse, validateOrderPdfName } from '../lib/orderMerge';
import { consolidateHotStamps, isHotStampCatalogEntry, isHotStampPiece } from '../lib/hotStamp';
import {
  cleanPieceName,
  withPartNumber,
  collapseDuplicateOrders,
} from '../lib/reportFormat';
import { listActiveDrawingViews } from '../lib/firebase/toolcrib';
import { upsertWorkOrders, updateCantidad, archiveWorkOrder } from '../lib/firebase/workOrders';
import { buildDedupeKey } from '../lib/workOrders/dedupe';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { generateReportPdf, generateSingleOrderPdf } from '../lib/pdfGenerator';
import type { ToolcribAttachment } from '../components/ToolcribLibraryPanel';
import type { IncomingWorkOrder } from '../lib/firebase/workOrders';
```

- [ ] **Step 2: Move module-level types and constants from App.tsx**

In the hook file, after the imports, add:

```typescript
// ── Prompt versions — bump to invalidate IndexedDB cache for all users ────────
const ORDER_PROMPT_VERSION = 'orders-v7-po-multi-hoja';
const BLUEPRINT_PROMPT_VERSION = 'blueprints-v15-multi-piece-variants';
const SMV_VISION_APP_VERSION = `smv-vision@${__APP_VERSION__}`;
const METRICS_BASELINE_KEY = 'smvVisionMetricsBaselineV2';
const MAX_BLUEPRINT_CONCURRENCY = 8;
const REFINEMENT_SKIP_AREA_THRESHOLD = 200_000;
const GEMINI_ORDER_MODEL = 'gemini-3.5-flash';
const GEMINI_BLUEPRINT_MODEL = 'gemini-3.5-flash';
const FALLBACK_CENTER_BOX: number[] = [30, 30, 720, 970];

// ── Internal types (not exported — implementation detail of the hook) ──────────
interface MetricsComparison {
  baseline: AnalysisMetrics;
  latest: AnalysisMetrics;
  totalImprovementPct: number;
}
interface BlueprintTaskResult {
  index: number;
  fileId: string;
  fileLabel: string;
  analysis: BlueprintAnalysis;
  metrics: { pdfRasterMs: number; aiBlueprintMs: number };
}
interface BlueprintStatusPatch {
  fileId: string;
  status: 'done' | 'error';
}

// ── Helper to map a report Order to its dedup key (mirrors workOrders.ts upsert) ─
function dedupeKeyOfReportOrder(order: Order): string {
  return buildDedupeKey({
    soNumber: order.orden,
    poNumber: order.poNumber ?? '',
    numeroParte: order.numero_parte ?? '',
    pieza: order.pieza,
  });
}
```

- [ ] **Step 3: Move pure helper functions from App.tsx**

Paste the following functions verbatim after the constants block — they all currently live at module scope in App.tsx (lines 86–238):

- `callWithRetry` (App.tsx lines 86–99)
- `isRecord` (124–126)
- `asString` (128–130)
- `parseBoundingBox` (132–143)
- `parseBlueprintResponse` (145–166)
- `readBaselineMetrics` (168–180)
- `calculateMetricsComparison` (182–202)
- `isPdfFile` (204–210)
- `readFileAsDataUrl` (212–225)

Paste them exactly as-is. No changes needed.

- [ ] **Step 4: Define the hook input and output interfaces**

```typescript
export interface UseVisionAnalysisOptions {
  /** Maps an Order from the report to its Firestore WorkOrder id (or null). */
  findWorkOrderId: (order: Order) => string | null;
  /** Called after any mutation that should trigger a dashboard refresh. */
  onDataChanged: () => void;
}

export interface VisionAnalysisHook {
  // File state
  orderPdf: string | null;
  orderPdfName: string | null;
  orderPdfWarning: string | null;
  workshopPdfs: WorkshopPdfUpload[];
  orderLoadingState: 'idle' | 'loading' | 'done' | 'error';
  workshopLoadingStates: Record<string, 'idle' | 'loading' | 'done' | 'error'>;
  toolcribPdfToDrawing: Record<string, string>;
  attachedToolcribDrawingIds: Set<string>;
  // Analysis state
  isExtracting: boolean;
  extractingStep: string;
  error: string | null;
  results: Order[] | null;
  analysisSummary: AnalysisRunSummary | null;
  metricsComparison: MetricsComparison | null;
  copying: boolean;
  // Edit mode
  editMode: boolean;
  originalResults: Order[] | null;
  excludedOrders: Array<{ order: Order; workOrderId: string | null }>;
  auditedCount: number;
  // Results display
  draggingZone: 'order' | 'workshop' | null;
  resultsFilter: string;
  filterUrgentOnly: boolean;
  filterMissingOnly: boolean;
  filteredResults: Order[] | null;
  previewOrder: Order | null;
  // Refs
  orderFileInputRef: React.RefObject<HTMLInputElement>;
  // File actions
  ingestOrderFile: (files: FileList | File[]) => Promise<void>;
  ingestWorkshopFiles: (files: FileList | File[]) => Promise<void>;
  handleOrderInputUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleAttachToolcribDrawing: (attachment: ToolcribAttachment) => void;
  removeFile: (type: 'order' | 'workshop', fileId?: string) => void;
  buildDropHandlers: (
    zone: 'order' | 'workshop',
    onFiles: (files: FileList) => void | Promise<void>,
  ) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  // Analysis actions
  extractInfo: () => Promise<void>;
  // Export actions
  downloadPdf: () => void;
  downloadCsv: () => void;
  downloadJson: () => void;
  downloadSingleOrderPdf: (order: Order) => void;
  copyResults: () => Promise<void>;
  // Edit handlers
  snapshotOriginalOnce: () => void;
  handleEditCantidad: (order: Order, newValue: string) => void;
  handleExcludeOrder: (order: Order) => void;
  handleRestoreOrder: (entry: { order: Order; workOrderId: string | null }) => void;
  handleRestoreAll: () => void;
  // Display setters
  setResultsFilter: (v: string) => void;
  setFilterUrgentOnly: (v: boolean) => void;
  setFilterMissingOnly: (v: boolean) => void;
  setDraggingZone: (zone: 'order' | 'workshop' | null) => void;
  setEditMode: (v: boolean) => void;
  setPreviewOrder: (order: Order | null) => void;
  setError: (msg: string | null) => void;
}
```

- [ ] **Step 5: Lint check**

```bash
npx tsc --noEmit
```

Expected: errors about the hook not being defined yet — that's fine at this step. Zero errors about _imports_ (if you see "Module not found" errors, fix the import paths before continuing).

---

## Task 3: Populate `useVisionAnalysis` — state, file handlers, display state

**Files:**
- Modify: `src/hooks/useVisionAnalysis.ts`

- [ ] **Step 1: Open the hook function and add all state declarations**

After the interfaces, add:

```typescript
export function useVisionAnalysis({
  findWorkOrderId,
  onDataChanged,
}: UseVisionAnalysisOptions): VisionAnalysisHook {
```

Then paste all `useState`/`useRef` from App.tsx lines 282–303 verbatim, followed by the four display-state declarations from lines 409–427 (minus `activeView` and `controlAlert` — those stay in App.tsx):

```typescript
  // ── Analysis file state ───────────────────────────────────────────────────
  const [orderPdf, setOrderPdf] = useState<string | null>(null);
  const [orderPdfName, setOrderPdfName] = useState<string | null>(null);
  const [orderPdfWarning, setOrderPdfWarning] = useState<string | null>(null);
  const [workshopPdfs, setWorkshopPdfs] = useState<WorkshopPdfUpload[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractingStep, setExtractingStep] = useState<string>('');
  const [workshopLoadingStates, setWorkshopLoadingStates] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [orderLoadingState, setOrderLoadingState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [metricsComparison, setMetricsComparison] = useState<MetricsComparison | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisRunSummary | null>(null);
  const [toolcribPdfToDrawing, setToolcribPdfToDrawing] = useState<Record<string, string>>({});
  // ── Refs ──────────────────────────────────────────────────────────────────
  const orderFileInputRef = useRef<HTMLInputElement>(null);
  const workshopStatePatchQueueRef = useRef<Record<string, 'done' | 'error'>>({});
  const workshopStatePatchTimerRef = useRef<number | null>(null);
  const copyingResetTimerRef = useRef<number | null>(null);
  const hotStampRefImageRef = useRef<string | null>(null);
  // ── Display / edit state ──────────────────────────────────────────────────
  const [draggingZone, setDraggingZone] = useState<'order' | 'workshop' | null>(null);
  const [resultsFilter, setResultsFilter] = useState('');
  const [filterUrgentOnly, setFilterUrgentOnly] = useState(false);
  const [filterMissingOnly, setFilterMissingOnly] = useState(false);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [originalResults, setOriginalResults] = useState<Order[] | null>(null);
  const [excludedOrders, setExcludedOrders] = useState<Array<{ order: Order; workOrderId: string | null }>>([]);
```

- [ ] **Step 2: Move cleanup useEffect and patch-queue handlers**

Paste App.tsx lines 308–342 verbatim (the cleanup `useEffect` for timer refs, `flushWorkshopStatePatches`, and `enqueueWorkshopStatusPatch`).

- [ ] **Step 3: Move file ingestion handlers**

Paste App.tsx lines 344–406 verbatim:
- `ingestOrderFile` (344–371)
- `handleOrderInputUpload` (373–382)
- `ingestWorkshopFiles` (387–406)

No changes needed — they only reference local state setters.

- [ ] **Step 4: Move buildDropHandlers and removeFile**

Paste the `buildDropHandlers` helper and `removeFile` from App.tsx (lines 475–520) verbatim.

- [ ] **Step 5: Move attachedToolcribDrawingIds and handleAttachToolcribDrawing**

Paste App.tsx lines 522–551 verbatim:

```typescript
  const attachedToolcribDrawingIds = useMemo(
    () => new Set(Object.values(toolcribPdfToDrawing)),
    [toolcribPdfToDrawing],
  );

  const handleAttachToolcribDrawing = useCallback((attachment: ToolcribAttachment) => {
    if (attachedToolcribDrawingIds.has(attachment.drawingId)) return;
    const pdfId = `toolcrib-${attachment.drawingId}-${crypto.randomUUID()}`;
    const relativePath = attachment.sourcePath.length > 0
      ? attachment.sourcePath
      : attachment.displayName;
    setWorkshopPdfs((prevPdfs) => [
      ...prevPdfs,
      { id: pdfId, name: attachment.displayName, relativePath, dataUrl: attachment.dataUrl },
    ]);
    setToolcribPdfToDrawing((prev) => ({ ...prev, [pdfId]: attachment.drawingId }));
    setError(null);
  }, [attachedToolcribDrawingIds]);
```

- [ ] **Step 6: Move copyResults, downloadCsv, downloadJson**

Paste App.tsx lines 1400–1459 verbatim. These only reference `results`, `setCopying`, `setError`, and `copyingResetTimerRef` — all local to the hook.

- [ ] **Step 7: Add downloadPdf and downloadSingleOrderPdf wrappers**

These now delegate to the pure lib:

```typescript
  const downloadPdf = useCallback(() => {
    if (!results) return;
    generateReportPdf(results, {
      hotStampRefImage: hotStampRefImageRef.current,
      analysisSummary,
    });
  }, [results, analysisSummary]);

  const downloadSingleOrderPdf = useCallback((order: Order) => {
    generateSingleOrderPdf(order);
  }, []);
```

- [ ] **Step 8: Lint check**

```bash
npx tsc --noEmit
```

Expected: errors about `extractInfo` not defined yet. That's fine. Zero import/type errors.

---

## Task 4: Populate `useVisionAnalysis` — `extractInfo` pipeline

**Files:**
- Modify: `src/hooks/useVisionAnalysis.ts`

- [ ] **Step 1: Move image helper functions**

Paste the following from App.tsx verbatim — they are currently defined inside the App component but need to be in the hook:
- `preparePdfPart` (lines 553–561)
- `prepareImagePart` (lines 563–571)
- `isValidBoundingBox` (lines 576–587)
- `cropIsometricView` (lines 597–639)
- `cropToBoxRaw` (lines 643–664)

These reference no external state — they can be defined directly in the hook body (before `extractInfo`) or as module-scope functions. Placing them as module-scope functions (before the `export function useVisionAnalysis` line) is cleaner:

```typescript
// ── Image helpers (module-scope — no state deps) ───────────────────────────

function preparePdfPart(dataUrl: string) {
  // paste body from App.tsx line 554–560
}
function prepareImagePart(dataUrl: string) {
  // paste body from App.tsx line 564–570
}
function isValidBoundingBox(box?: number[]): box is number[] {
  // paste body from App.tsx line 577–587
}
function cropIsometricView(base64: string, box: number[]): Promise<string> {
  // paste body from App.tsx line 598–639
}
function cropToBoxRaw(base64: string, box: number[]): Promise<string> {
  // paste body from App.tsx line 644–664
}
```

- [ ] **Step 2: Move `refineSpecBox` into the hook body**

`refineSpecBox` (App.tsx lines 670–729) uses `GoogleGenAI` and the local `isValidBoundingBox` / `cropToBoxRaw` helpers. It does **not** reference state setters directly. Paste it verbatim as a nested async function at the top of the hook body, just after the state declarations:

```typescript
  // defined inside the hook to capture `isValidBoundingBox` and `cropToBoxRaw`
  // without needing the Google AI key at module scope.
  const refineSpecBox = async (
    // paste full signature and body from App.tsx lines 670–729
  ) => { /* ... */ };
```

- [ ] **Step 3: Move `extractInfo`**

Paste the entire `extractInfo` function (App.tsx lines 730–1398) verbatim into the hook body after `refineSpecBox`. It references only:
- State setters defined in this hook (`setIsExtracting`, `setExtractingStep`, etc.)
- Refs defined in this hook (`hotStampRefImageRef`, `workshopStatePatchQueueRef`, etc.)
- Functions already in scope (`refineSpecBox`, `enqueueWorkshopStatusPatch`, `flushWorkshopStatePatches`)
- Module-scope helpers (`callWithRetry`, `isRecord`, `parseBlueprintResponse`, etc.)
- The lib imports at the top

No argument changes needed.

- [ ] **Step 4: Lint check**

```bash
npx tsc --noEmit
```

Expected: no errors. If TypeScript complains about `__APP_VERSION__`, that global is declared in `vite.config.ts` via `define` — add this to `src/vite-env.d.ts` if not already there:

```typescript
declare const __APP_VERSION__: string;
```

---

## Task 5: Populate `useVisionAnalysis` — edit handlers + derived state + return

**Files:**
- Modify: `src/hooks/useVisionAnalysis.ts`

- [ ] **Step 1: Move edit handlers**

Paste App.tsx lines 1856–1942 verbatim:
- `snapshotOriginalOnce` (1856–1858)
- `handleEditCantidad` (1860–1876)
- `handleExcludeOrder` (1878–1893)
- `handleRestoreOrder` (1895–1907)

For `handleRestoreAll` (lines 1909–1942): paste verbatim **except** replace the one reference to `workOrderByKey.get(key)?.id` with `findWorkOrderId(snapshotOrder)`:

```typescript
  const handleRestoreAll = useCallback(() => {
    const snapshot = originalResults;
    const current = results ?? [];
    const excluded = excludedOrders;
    if (snapshot) setResults(snapshot);
    setExcludedOrders([]);
    setOriginalResults(null);
    void (async () => {
      let touched = false;
      for (const e of excluded) {
        if (e.workOrderId) {
          await archiveWorkOrder(e.workOrderId, false);
          touched = true;
        }
      }
      if (snapshot) {
        const currentByKey = new Map(
          current.map((o) => [dedupeKeyOfReportOrder(o), o.cantidad] as const),
        );
        for (const o of snapshot) {
          const key = dedupeKeyOfReportOrder(o);
          if (currentByKey.has(key) && currentByKey.get(key) !== o.cantidad) {
            const woId = findWorkOrderId(o);   // ← replaces workOrderByKey.get(key)?.id
            if (woId) {
              await updateCantidad(woId, o.cantidad);
              touched = true;
            }
          }
        }
      }
      if (touched) onDataChanged();
    })();
  }, [originalResults, results, excludedOrders, findWorkOrderId, onDataChanged]);
```

- [ ] **Step 2: Add derived state**

```typescript
  const auditedCount = useMemo(
    () => (results ? results.filter((r) => r.haSidoAuditada).length : 0),
    [results],
  );

  const filteredResults = useMemo(() => {
    if (!results) return null;
    const term = resultsFilter.trim().toLowerCase();
    return results.filter((order) => {
      if (filterUrgentOnly && order.prioridad !== 'URGENTE') return false;
      if (filterMissingOnly && order.isometricView) return false;
      if (term.length === 0) return true;
      return [order.pieza, order.numero_parte ?? '', order.orden, order.sourcePdfName ?? '']
        .join(' ').toLowerCase().includes(term);
    });
  }, [results, resultsFilter, filterUrgentOnly, filterMissingOnly]);
```

- [ ] **Step 3: Add the return statement**

```typescript
  return {
    // File state
    orderPdf, orderPdfName, orderPdfWarning, workshopPdfs,
    orderLoadingState, workshopLoadingStates,
    toolcribPdfToDrawing, attachedToolcribDrawingIds,
    // Analysis state
    isExtracting, extractingStep, error, results,
    analysisSummary, metricsComparison, copying,
    // Edit mode
    editMode, originalResults, excludedOrders, auditedCount,
    // Display state
    draggingZone, resultsFilter, filterUrgentOnly, filterMissingOnly,
    filteredResults, previewOrder,
    // Refs
    orderFileInputRef,
    // Actions
    extractInfo, ingestOrderFile, ingestWorkshopFiles,
    handleOrderInputUpload, handleAttachToolcribDrawing,
    removeFile, buildDropHandlers,
    downloadPdf, downloadCsv, downloadJson,
    downloadSingleOrderPdf, copyResults,
    snapshotOriginalOnce, handleEditCantidad, handleExcludeOrder,
    handleRestoreOrder, handleRestoreAll,
    // Setters
    setResultsFilter, setFilterUrgentOnly, setFilterMissingOnly,
    setDraggingZone, setEditMode, setPreviewOrder, setError,
  };
} // end useVisionAnalysis
```

- [ ] **Step 4: Lint check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useVisionAnalysis.ts
git commit -m "feat: add useVisionAnalysis hook (extracts analysis pipeline from App.tsx)"
```

---

## Task 6: Refactor `src/App.tsx` to use the hook

**Files:**
- Modify: `src/App.tsx`

The goal: remove everything that moved to the hook/pdfGenerator, add one `useVisionAnalysis` call, prefix all JSX references that were bare state names with `vision.`.

- [ ] **Step 1: Update imports at the top of App.tsx**

Remove these imports (they are now internal to the hook or pdfGenerator):
- `GoogleGenAI`, `Type` from `@google/genai`
- `jsPDF` from `jspdf`
- `autoTable`, `CellHookData`, `RowInput` from `jspdf-autotable`
- `AnalysisMetrics`, `AnalysisRunSummary`, `BlueprintAnalysis`, `BlueprintSpec`, `BoundingBox`, `ExtractedOrder`, `WorkshopPdfUpload`, `ToolcribActiveDrawingView` from `./types` (keep `Order`, `WorkOrder`)
- `createDocumentHash`, `readCachedValue`, `writeCachedValue` from cache
- `runWithConcurrencyLimit` from concurrency
- `rasterizeAndNormalizePdf` from pdfWorkerClient
- `recordAnalysisRunFireAndForget` from analysisRuns
- `formatAgeDays`, `getOrderAgeDays` from age
- `MIN_BLUEPRINT_MATCH_SCORE` and the five matching imports
- `mergeGroupedOrders`, `parseOrdersResponse`, `validateOrderPdfName` from orderMerge
- `consolidateHotStamps`, `isHotStampCatalogEntry`, `isHotStampPiece` from hotStamp
- `cleanPieceName`, `withPartNumber`, `collapseDuplicateOrders`, `computeDueDate`, `dueSeverity`, `dueLabel`, `fmtISOToDisplay`, `dueDaysOrInfinity`, `summarizeOrders` from reportFormat
- `listActiveDrawingViews` from toolcrib
- `upsertWorkOrders`, `updateCantidad`, `archiveWorkOrder`, `IncomingWorkOrder` from workOrders
- `buildDedupeKey` from dedupe
- `fetchPdfAsDataUrl` from fetchPdf

Add:
```typescript
import { useVisionAnalysis } from './hooks/useVisionAnalysis';
```

Keep: `React`, `useCallback`, `useEffect`, `useMemo`, `useRef`, `useState`, `motion`, `AnimatePresence`, all lucide icons you need for the JSX, `Order`, `WorkOrder`, `ToolcribLibraryPanel`, `ToolcribAttachment`, `WorkOrdersPanel`, `AppShell`, `AppView`, `InicioView`, `AlertSeverity`, `BibliotecaView`, `useDashboardSummary`.

- [ ] **Step 2: Remove all extracted module-level code from App.tsx**

Delete these blocks entirely — they now live in the hook or pdfGenerator:
- Lines 75–84: constants (`ORDER_PROMPT_VERSION`, `BLUEPRINT_PROMPT_VERSION`, `SMV_VISION_APP_VERSION`, `METRICS_BASELINE_KEY`, `MAX_BLUEPRINT_CONCURRENCY`, `REFINEMENT_SKIP_AREA_THRESHOLD`, `GEMINI_ORDER_MODEL`, `GEMINI_BLUEPRINT_MODEL`)
- Lines 86–238: helper functions (`callWithRetry`, `MetricsComparison` interface, `BlueprintTaskResult` interface, `BlueprintStatusPatch` interface, `isRecord`, `asString`, `parseBoundingBox`, `parseBlueprintResponse`, `readBaselineMetrics`, `calculateMetricsComparison`, `isPdfFile`, `readFileAsDataUrl`, `dedupeKeyOfReportOrder`)

Keep: the `EditableCantidad` component (lines 245–279) and `StepLabel` component (lines 2592–end). Keep the `dedupeKeyOfReportOrder` function — App.tsx still needs it for `workOrderByKey`:

```typescript
// Stays in App.tsx — used for workOrderByKey map keying
function dedupeKeyOfReportOrder(order: Order): string {
  return buildDedupeKey({
    soNumber: order.orden,
    poNumber: order.poNumber ?? '',
    numeroParte: order.numero_parte ?? '',
    pieza: order.pieza,
  });
}
```

Wait — re-check: if `workOrderByKey` also moves to the hook, you don't need `dedupeKeyOfReportOrder` in App.tsx at all. Check whether `workOrderByKey` and `findWorkOrderId` stay in App.tsx. Per the spec they DO stay in App.tsx (they depend on `useDashboardSummary`). So keep `dedupeKeyOfReportOrder` in App.tsx and re-add the `buildDedupeKey` import.

- [ ] **Step 3: Replace extracted state/handlers in the App function body**

Inside `export default function App()`, delete these blocks (they all move to the hook):
- All `useState`/`useRef` lines for analysis state (282–303)
- Cleanup `useEffect` for timers (308–317)
- `flushWorkshopStatePatches`, `enqueueWorkshopStatusPatch` (319–342)
- `ingestOrderFile`, `handleOrderInputUpload`, `ingestWorkshopFiles` (344–406)
- `draggingZone`, `resultsFilter`, `filterUrgentOnly`, `filterMissingOnly`, `previewOrder` state (409–418)
- `editMode`, `originalResults`, `excludedOrders` state (425–427)
- `attachedToolcribDrawingIds`, `handleAttachToolcribDrawing` (522–551)
- `preparePdfPart`, `prepareImagePart`, `isValidBoundingBox`, `FALLBACK_CENTER_BOX`, `cropIsometricView`, `cropToBoxRaw` (553–664)
- `refineSpecBox` (670–729)
- `extractInfo` (730–1398)
- `copyResults`, `downloadCsv`, `downloadJson`, `downloadSingleOrderPdf`, `downloadPdf` (1400–1848)
- Edit handlers: `snapshotOriginalOnce`, `handleEditCantidad`, `handleExcludeOrder`, `handleRestoreOrder`, `handleRestoreAll` (1856–1942)
- `auditedCount`, `filteredResults` (1944–1966)

After the `useDashboardSummary` line and before `workOrderByKey`, add the hook call:

```typescript
  const vision = useVisionAnalysis({ findWorkOrderId, onDataChanged: refresh });
```

Keep in App.tsx:
- `activeView`, `controlAlert` state
- `summary`, `refresh` from `useDashboardSummary`
- `workOrderByKey` useMemo
- `findWorkOrderId` useCallback
- `navigate`, `handleFocusAlert` useCallbacks
- The `previewOrder` Escape key useEffect — but `previewOrder` is now `vision.previewOrder`, so update the dependency array:

```typescript
  useEffect(() => {
    if (!vision.previewOrder) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') vision.setPreviewOrder(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [vision.previewOrder, vision.setPreviewOrder]);
```

- [ ] **Step 4: Update the JSX to use `vision.*`**

In the JSX return (previously lines 1968–2591), replace every bare reference to extracted state/handlers with `vision.`:

Common replacements (use find-and-replace in the file, checking context):

| Old | New |
|---|---|
| `{results` | `{vision.results` |
| `!results` | `!vision.results` |
| `results.` | `vision.results.` |
| `isExtracting` | `vision.isExtracting` |
| `extractingStep` | `vision.extractingStep` |
| `orderPdf` | `vision.orderPdf` |
| `orderPdfName` | `vision.orderPdfName` |
| `orderPdfWarning` | `vision.orderPdfWarning` |
| `workshopPdfs` | `vision.workshopPdfs` |
| `orderLoadingState` | `vision.orderLoadingState` |
| `workshopLoadingStates` | `vision.workshopLoadingStates` |
| `error` (analysis error only) | `vision.error` |
| `setError(` | `vision.setError(` |
| `copying` | `vision.copying` |
| `metricsComparison` | `vision.metricsComparison` |
| `analysisSummary` | `vision.analysisSummary` |
| `draggingZone` | `vision.draggingZone` |
| `resultsFilter` | `vision.resultsFilter` |
| `filterUrgentOnly` | `vision.filterUrgentOnly` |
| `filterMissingOnly` | `vision.filterMissingOnly` |
| `filteredResults` | `vision.filteredResults` |
| `previewOrder` | `vision.previewOrder` |
| `editMode` | `vision.editMode` |
| `excludedOrders` | `vision.excludedOrders` |
| `auditedCount` | `vision.auditedCount` |
| `orderFileInputRef` | `vision.orderFileInputRef` |
| `extractInfo()` | `vision.extractInfo()` |
| `downloadPdf()` | `vision.downloadPdf()` |
| `downloadCsv()` | `vision.downloadCsv()` |
| `downloadJson()` | `vision.downloadJson()` |
| `downloadSingleOrderPdf(` | `vision.downloadSingleOrderPdf(` |
| `copyResults()` | `vision.copyResults()` |
| `ingestOrderFile` | `vision.ingestOrderFile` |
| `ingestWorkshopFiles` | `vision.ingestWorkshopFiles` |
| `handleOrderInputUpload` | `vision.handleOrderInputUpload` |
| `handleAttachToolcribDrawing` | `vision.handleAttachToolcribDrawing` |
| `removeFile(` | `vision.removeFile(` |
| `buildDropHandlers(` | `vision.buildDropHandlers(` |
| `attachedToolcribDrawingIds` | `vision.attachedToolcribDrawingIds` |
| `setResultsFilter(` | `vision.setResultsFilter(` |
| `setFilterUrgentOnly(` | `vision.setFilterUrgentOnly(` |
| `setFilterMissingOnly(` | `vision.setFilterMissingOnly(` |
| `setDraggingZone(` | `vision.setDraggingZone(` |
| `setEditMode(` | `vision.setEditMode(` |
| `setPreviewOrder(` | `vision.setPreviewOrder(` |
| `handleEditCantidad(` | `vision.handleEditCantidad(` |
| `handleExcludeOrder(` | `vision.handleExcludeOrder(` |
| `handleRestoreOrder(` | `vision.handleRestoreOrder(` |
| `handleRestoreAll()` | `vision.handleRestoreAll()` |
| `snapshotOriginalOnce()` | `vision.snapshotOriginalOnce()` |
| `toolcribPdfToDrawing` | `vision.toolcribPdfToDrawing` |

`ToolcribLibraryPanel` still receives `attachedDrawingIds={vision.attachedToolcribDrawingIds}` and `onAttach={vision.handleAttachToolcribDrawing}`.

- [ ] **Step 5: Lint check and fix**

```bash
npx tsc --noEmit
```

Fix any remaining errors (usually a stray reference to an old variable). Expected: zero errors after fixes.

- [ ] **Step 6: Manual smoke test**

Start the dev server:
```bash
npm run dev
```

Open http://localhost:3000. Verify:
1. The app loads (no runtime errors in console)
2. Upload a PO PDF — it shows in the UI
3. Click "Analizar" — the pipeline runs, produces results
4. Click "Generar PDF" — a PDF downloads correctly
5. Open "Control" view — work orders load

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/hooks/useVisionAnalysis.ts
git commit -m "refactor: wire App.tsx to useVisionAnalysis hook, App.tsx ~900 lines"
```

---

## Task 7: Fix `OrderCard` in WorkOrdersPanel

**Files:**
- Modify: `src/components/WorkOrdersPanel.tsx`

- [ ] **Step 1: Define `OrderCardProps` interface above the `WorkOrdersPanel` function**

In `WorkOrdersPanel.tsx`, just before `export function WorkOrdersPanel(...)`, add:

```typescript
// ── OrderCard (module scope + React.memo to prevent re-creation on render) ────

interface OrderCardProps {
  order: WorkOrder;
  busy: string | undefined;
  editingDueDateId: string | null;
  draftDueDate: string;
  editingNotesId: string | null;
  draftNotes: string;
  activeTorneros: Tornero[];
  onTransition: (order: WorkOrder, status: WorkOrderStatus, tornero?: string) => void;
  onArchive: (order: WorkOrder) => void;
  onPrint: (order: WorkOrder) => void;
  onSaveDueDate: (id: string, val: string) => void;
  onSaveNotes: (id: string) => void;
  onEditDueDate: (id: string | null) => void;
  onEditNotes: (id: string | null) => void;
  onDraftDueDateChange: (val: string) => void;
  onDraftNotesChange: (val: string) => void;
}
```

- [ ] **Step 2: Extract `OrderCard` to module scope with React.memo**

Copy the entire body of the inner `const OrderCard = (o: WorkOrder): ReactElement => { ... }` (lines 331–520 in WorkOrdersPanel.tsx), then delete the original. Create the module-scope component before `WorkOrdersPanel`:

```typescript
const OrderCard = React.memo(function OrderCard({
  order: o,
  busy,
  editingDueDateId,
  draftDueDate,
  editingNotesId,
  draftNotes,
  activeTorneros,
  onTransition,
  onArchive,
  onPrint,
  onSaveDueDate,
  onSaveNotes,
  onEditDueDate,
  onEditNotes,
  onDraftDueDateChange,
  onDraftNotesChange,
}: OrderCardProps): ReactElement {
  const severity = getDueDateSeverity(o.dueDate, o.status);
  const isEditingNotes = editingNotesId === o.id;
  const isEditingDueDate = editingDueDateId === o.id;

  // ← paste the JSX return block from the original OrderCard verbatim.
  // Replace every closure-captured reference:
  //   rowBusy[o.id]        → busy
  //   handleTransition(    → onTransition(
  //   handleArchive(       → onArchive(
  //   handlePrint(         → onPrint(
  //   handleSaveDueDate(   → onSaveDueDate(
  //   handleSaveNotes(     → onSaveNotes(
  //   setEditingDueDateId( → onEditDueDate(
  //   setEditingNotesId(   → onEditNotes(
  //   setDraftNotes(       → onDraftNotesChange(
  //   setDraftDueDate(     → onDraftDueDateChange(
});
```

Add `import React from 'react';` at the top of `WorkOrdersPanel.tsx` (it currently imports from 'react' without the default — add the default import needed for `React.memo`):

Change:
```typescript
import {
  useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode,
} from 'react';
```
To:
```typescript
import React, {
  useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode,
} from 'react';
```

- [ ] **Step 3: Update call sites inside WorkOrdersPanel**

In the render section, find every `<OrderCard .../>` or `{OrderCard(order)}` call and replace with explicit props. The component is called with `key` in the board columns and list view.

For **board view** (wherever `OrderCard(o)` is called):
```tsx
<OrderCard
  key={o.id}
  order={o}
  busy={rowBusy[o.id]}
  editingDueDateId={editingDueDateId}
  draftDueDate={draftDueDate}
  editingNotesId={editingNotesId}
  draftNotes={draftNotes}
  activeTorneros={activeTorneros}
  onTransition={handleTransition}
  onArchive={handleArchive}
  onPrint={handlePrint}
  onSaveDueDate={handleSaveDueDate}
  onSaveNotes={handleSaveNotes}
  onEditDueDate={setEditingDueDateId}
  onEditNotes={setEditingNotesId}
  onDraftDueDateChange={setDraftDueDate}
  onDraftNotesChange={setDraftNotes}
/>
```

Apply the same props for any list-view call sites.

- [ ] **Step 4: Wrap handlers with useCallback**

For `React.memo` to prevent re-renders, the handler props must be stable references. Ensure `handleTransition`, `handleArchive`, `handlePrint`, `handleSaveDueDate`, and `handleSaveNotes` are already wrapped in `useCallback` (they are — verify). The state setters `setEditingDueDateId`, `setEditingNotesId`, `setDraftDueDate`, `setDraftNotes` are always stable from React, no change needed.

- [ ] **Step 5: Lint check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Verify re-render fix manually**

In the browser, go to "Control" view. Open DevTools → React DevTools → Profiler. Record, type a character in the search bar. Confirm `OrderCard` components do **not** flash (re-render without prop change).

- [ ] **Step 7: Commit**

```bash
git add src/components/WorkOrdersPanel.tsx
git commit -m "refactor: extract OrderCard to module scope with React.memo"
```

---

## Task 8: Optimistic UI for `handleTransition`

**Files:**
- Modify: `src/components/WorkOrdersPanel.tsx`

- [ ] **Step 1: Extract the optimistic state-merge logic into a helper**

Just before `WorkOrdersPanel`, add a pure helper (no hook deps):

```typescript
function applyOptimisticTransition(
  orders: WorkOrder[],
  orderId: string,
  newStatus: WorkOrderStatus,
  torneroName?: string,
): WorkOrder[] {
  const now = new Date().toISOString();
  return orders.map((o) => {
    if (o.id !== orderId) return o;
    const base = { ...o, status: newStatus, updatedAtUTC: now };
    if (newStatus === 'en_proceso') {
      return { ...base, assignedToTornero: torneroName ?? null, assignedAtUTC: now };
    }
    if (newStatus === 'terminada') {
      return { ...base, finishedAtUTC: now };
    }
    if (newStatus === 'entregada') {
      return { ...base, deliveredToTornero: torneroName ?? null, deliveredAtUTC: now };
    }
    if (newStatus === 'pendiente') {
      return {
        ...base,
        assignedToTornero: null, assignedAtUTC: null,
        finishedAtUTC: null, deliveredToTornero: null, deliveredAtUTC: null,
      };
    }
    return base;
  });
}
```

- [ ] **Step 2: Replace `handleTransition` body**

Find the current `handleTransition` (lines 217–255 in WorkOrdersPanel.tsx):

```typescript
  const handleTransition = useCallback(async (
    order: WorkOrder,
    newStatus: WorkOrderStatus,
    torneroName?: string,
  ) => {
    setBusy(order.id, 'Guardando');
    const res = await updateOrderStatus(order.id, newStatus, torneroName);
    clearBusy(order.id);
    if (res.ok === false) {
      setErrorMessage(
        res.reason === 'not-authenticated'
          ? 'Inicia sesión para actualizar el estado.'
          : 'No fue posible actualizar el estado. Reintenta.',
      );
      return;
    }
    setOrders((prev) => prev.map((o) => {
      // ... 20 lines of status merge ...
    }));
    onDataChanged?.();
  }, [onDataChanged]);
```

Replace with:

```typescript
  const handleTransition = useCallback(async (
    order: WorkOrder,
    newStatus: WorkOrderStatus,
    torneroName?: string,
  ) => {
    // 1. Snapshot for rollback
    const snapshot = order;

    // 2. Optimistic update — UI responds instantly
    setOrders((prev) => applyOptimisticTransition(prev, order.id, newStatus, torneroName));

    // 3. Firebase write (background)
    const res = await updateOrderStatus(order.id, newStatus, torneroName);

    if (!res.ok) {
      // 4a. Revert on failure
      setOrders((prev) => prev.map((o) => (o.id === order.id ? snapshot : o)));
      setErrorMessage(
        res.reason === 'not-authenticated'
          ? 'Inicia sesión para actualizar el estado.'
          : 'No fue posible actualizar el estado. Reintenta.',
      );
      return;
    }

    // 4b. Merge server-authoritative fields (tornero name confirmed by Firebase)
    setOrders((prev) => prev.map((o) => {
      if (o.id !== order.id) return o;
      if (newStatus === 'entregada') return { ...o, deliveredToTornero: res.value.deliveredToTornero };
      if (newStatus === 'en_proceso') return { ...o, assignedToTornero: res.value.deliveredToTornero };
      return o;
    }));
    onDataChanged?.();
  }, [onDataChanged]);
```

Note: `setBusy`/`clearBusy` are **not called** for transitions — the UI no longer needs to block. The `busy` prop is still passed to `OrderCard` (from `rowBusy`) so operations that still call `setBusy` (e.g. `handlePrint`) continue to work correctly.

- [ ] **Step 3: Lint check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Manual test — happy path**

1. Open the Control panel, click "Asignar a tornero" on a `pendiente` order.
2. The card should flip to `EN PROCESO` **immediately** (no loading state, no delay).
3. After ~0.5 s, Firebase confirms. No visible change.

- [ ] **Step 5: Manual test — rollback path**

1. In browser DevTools → Network, set throttling to "Offline".
2. Try a status transition.
3. The card flips optimistically, then reverts and the error banner appears.
4. Re-enable network.

- [ ] **Step 6: Commit**

```bash
git add src/components/WorkOrdersPanel.tsx
git commit -m "feat: optimistic UI for work order status transitions"
```

---

## Task 9: Final verification and push

- [ ] **Step 1: Full lint pass**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2: Line count check**

```bash
wc -l src/App.tsx src/components/WorkOrdersPanel.tsx src/hooks/useVisionAnalysis.ts src/lib/pdfGenerator.ts
```

Expected (approximate):
- `App.tsx`: ≤ 950 lines
- `WorkOrdersPanel.tsx`: ≤ 810 lines
- `useVisionAnalysis.ts`: ≤ 1100 lines
- `pdfGenerator.ts`: ≤ 470 lines

- [ ] **Step 3: Full end-to-end smoke test**

1. Upload a real PO PDF → analysis runs → results display
2. Generate PDF → download and open — layout matches the old output
3. Generate single-order PDF from the ellipsis menu → opens correctly
4. Change a work order status in Control → instant visual update
5. Type in the search bar → no flicker (OrderCard memo working)
6. Exclude an order in edit mode → it disappears, "Restaurar" brings it back

- [ ] **Step 4: Push to GitHub**

```bash
git push origin main
```

---

## Self-Review Notes

**Spec coverage:**
- ✅ `useVisionAnalysis` hook — Tasks 2–5
- ✅ `pdfGenerator.ts` — Task 1
- ✅ App.tsx wired to hook — Task 6
- ✅ OrderCard module-scope + React.memo — Task 7
- ✅ Optimistic UI with rollback — Task 8
- ✅ Error handling (Firebase failure → revert + banner) — Task 8, Step 2
- ✅ `setBusy` preserved for print/archive (not removed) — Task 8 notes
- ✅ Verification checklist — Task 9

**Type consistency check:**
- `handleEditCantidad(order: Order, newValue: string)` — matches the interface in Task 2, Step 4
- `handleExcludeOrder(order: Order)` — matches
- `handleRestoreOrder(entry: { order: Order; workOrderId: string | null })` — matches
- `generateReportPdf(orders: Order[], options?: ReportPdfOptions)` — referenced in Task 3, Step 7 and defined in Task 1
- `applyOptimisticTransition` — defined in Task 8 Step 1, used in Task 8 Step 2
- `OrderCardProps.activeTorneros: Tornero[]` — used in Step 3

**Placeholder scan:** No TBD/TODO. All code steps show actual code or explicit "paste lines X–Y verbatim" with the change listed.
