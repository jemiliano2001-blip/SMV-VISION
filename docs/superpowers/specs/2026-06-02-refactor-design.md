# Spec: Refactoring — useVisionAnalysis hook, pdfGenerator, OrderCard, Optimistic UI

**Date:** 2026-06-02  
**Status:** Approved

---

## Overview

App.tsx has grown to 2,601 lines and does too many things at once: manages UI state, runs the Gemini AI pipeline, rasterizes PDFs via Web Worker, and generates jsPDF reports. WorkOrdersPanel.tsx has a nested `OrderCard` component that re-creates on every render and uses a pessimistic UI update pattern that makes status changes feel slow.

**Goals:**
1. Extract the entire vision-analysis pipeline into a reusable custom hook (`useVisionAnalysis`).
2. Extract PDF rendering into a pure library module (`pdfGenerator.ts`).
3. Fix the `OrderCard` re-render anti-pattern (move to module scope + `React.memo`).
4. Implement Optimistic UI for work-order status transitions.

**Non-goals:** No Firestore schema changes. No new external dependencies. `EditableCantidad` and `StepLabel` stay in `App.tsx` for now.

---

## Affected Files

| File | Change |
|---|---|
| `src/hooks/useVisionAnalysis.ts` | NEW — analysis pipeline hook |
| `src/lib/pdfGenerator.ts` | NEW — pure PDF rendering |
| `src/App.tsx` | MODIFIED — ~700 lines after extraction |
| `src/components/WorkOrdersPanel.tsx` | MODIFIED — OrderCard fix + Optimistic UI |

---

## Section 1 — `src/hooks/useVisionAnalysis.ts`

### Purpose

Owns all state and logic for the "Reporte" workflow: file ingestion, AI extraction, results display, report editing, PDF/CSV/JSON export. Keeps App.tsx as a thin orchestrator that wires the hook to the JSX.

### Input

```typescript
interface UseVisionAnalysisOptions {
  findWorkOrderId: (order: Order) => string | null;
  onDataChanged: () => void;  // called after mutations that affect the Control panel
}
```

`findWorkOrderId` is provided by App.tsx (derived from `useDashboardSummary`) so the hook can sync edits to Firestore without owning the dashboard state.

### State owned by the hook

**File management**
- `orderPdf: string | null` — base64 data URL of the order PDF
- `orderPdfName: string | null`
- `orderPdfWarning: string | null`
- `workshopPdfs: WorkshopPdfUpload[]`
- `orderLoadingState: 'idle' | 'loading' | 'done' | 'error'`
- `workshopLoadingStates: Record<string, 'idle' | 'loading' | 'done' | 'error'>`
- `toolcribPdfToDrawing: Record<string, string>` — maps fileId → drawingId for attached Tool Crib entries

**Analysis running**
- `isExtracting: boolean`
- `extractingStep: string`
- `error: string | null`

**Results**
- `results: Order[] | null`
- `analysisSummary: AnalysisRunSummary | null`
- `metricsComparison: MetricsComparison | null`
- `copying: boolean`

**Edit mode**
- `editMode: boolean`
- `originalResults: Order[] | null`
- `excludedOrders: Array<{ order: Order; workOrderId: string | null }>`

**Results display UI**
- `draggingZone: 'order' | 'workshop' | null`
- `resultsFilter: string`
- `filterUrgentOnly: boolean`
- `filterMissingOnly: boolean`
- `filteredResults: Order[]` — derived via `useMemo` (never null once results exist)
- `previewOrder: Order | null`

**Internal refs (not exposed)**
- `hotStampRefImageRef: RefObject<string | null>` — reference ISO image for hot stamp row
- `workshopStatePatchQueueRef`, `workshopStatePatchTimerRef` — debounced flush of blueprint status patches
- `copyingResetTimerRef`
- `orderFileInputRef: RefObject<HTMLInputElement>` — exposed for the file input element

### Exported interface (summary)

```typescript
export interface VisionAnalysisHook {
  // State
  orderPdf: string | null;
  orderPdfName: string | null;
  orderPdfWarning: string | null;
  workshopPdfs: WorkshopPdfUpload[];
  orderLoadingState: 'idle' | 'loading' | 'done' | 'error';
  workshopLoadingStates: Record<string, 'idle' | 'loading' | 'done' | 'error'>;
  toolcribPdfToDrawing: Record<string, string>;
  attachedToolcribDrawingIds: Set<string>;  // derived via useMemo
  isExtracting: boolean;
  extractingStep: string;
  error: string | null;
  results: Order[] | null;
  analysisSummary: AnalysisRunSummary | null;
  metricsComparison: MetricsComparison | null;
  copying: boolean;
  editMode: boolean;
  originalResults: Order[] | null;
  excludedOrders: Array<{ order: Order; workOrderId: string | null }>;
  draggingZone: 'order' | 'workshop' | null;
  resultsFilter: string;
  filterUrgentOnly: boolean;
  filterMissingOnly: boolean;
  filteredResults: Order[];
  previewOrder: Order | null;
  orderFileInputRef: RefObject<HTMLInputElement>;

  // Actions
  extractInfo: () => Promise<void>;
  ingestOrderFile: (files: FileList | File[]) => Promise<void>;
  ingestWorkshopFiles: (files: FileList | File[]) => Promise<void>;
  handleOrderInputUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
  downloadPdf: () => void;
  downloadCsv: () => void;
  downloadJson: () => void;
  downloadSingleOrderPdf: (order: Order) => void;
  copyResults: () => Promise<void>;
  snapshotOriginalOnce: () => void;
  handleEditCantidad: (order: Order, newValue: string) => void;
  handleExcludeOrder: (order: Order) => void;
  handleRestoreOrder: (entry: { order: Order; workOrderId: string | null }) => void;
  handleRestoreAll: () => void;
  setResultsFilter: (v: string) => void;
  setFilterUrgentOnly: (v: boolean) => void;
  setFilterMissingOnly: (v: boolean) => void;
  setDraggingZone: (zone: 'order' | 'workshop' | null) => void;
  setEditMode: (v: boolean) => void;
  setPreviewOrder: (order: Order | null) => void;
}
```

### App.tsx after extraction

```tsx
export default function App() {
  const [activeView, setActiveView] = useState<AppView>('inicio');
  const [controlAlert, setControlAlert] = useState<AlertSeverity | null>(null);
  const { summary, refresh } = useDashboardSummary();

  const workOrderByKey = useMemo(() => { /* same logic */ }, [summary.orders]);
  const findWorkOrderId = useCallback(
    (order: Order) => workOrderByKey.get(dedupeKeyOfReportOrder(order))?.id ?? null,
    [workOrderByKey],
  );

  const vision = useVisionAnalysis({ findWorkOrderId, onDataChanged: refresh });

  const navigate = useCallback(...);
  const handleFocusAlert = useCallback(...);

  // Escape key for previewOrder
  useEffect(() => { /* same */ }, [vision.previewOrder]);

  return (
    <AppShell activeView={activeView} onNavigate={navigate} summary={summary}>
      {/* Reporte view uses vision.* */}
      {/* Control view uses WorkOrdersPanel (unchanged) */}
      {/* Biblioteca view unchanged */}
    </AppShell>
  );
}
```

**Expected size after**: ~900 lines (from 2,601). The JSX return block alone is ~620 lines and stays in App.tsx.

---

## Section 2 — `src/lib/pdfGenerator.ts`

### Purpose

Pure rendering functions — they receive data as arguments and trigger a browser download. They do not read React state.

### Interface

```typescript
export interface ReportPdfOptions {
  hotStampRefImage?: string | null;
  analysisSummary?: AnalysisRunSummary | null;
}

/**
 * Generates the full Suprajit work report PDF and triggers browser download.
 * Consolidates hot stamps, splits orders into audited/pending sections,
 * sorts by urgency, and embeds isometric images.
 */
export function generateReportPdf(orders: Order[], options?: ReportPdfOptions): void;

/**
 * Generates a single-order work ticket PDF and triggers browser download.
 */
export function generateSingleOrderPdf(order: Order): void;
```

All jsPDF/autoTable logic from `downloadPdf` and `downloadSingleOrderPdf` moves here verbatim. The caller (hook) reduces to:

```typescript
const downloadPdf = () => {
  if (!results) return;
  generateReportPdf(results, {
    hotStampRefImage: hotStampRefImageRef.current,
    analysisSummary,
  });
};
```

---

## Section 3 — WorkOrdersPanel: OrderCard fix

### Problem

`const OrderCard` is declared inside the `WorkOrdersPanel` function body (line 331). React destroys and recreates this function reference on every render, defeating reconciliation: every re-render (search keystrokes, status filter changes) unmounts/remounts all cards.

### Fix

Move `OrderCard` to **module scope** (outside `WorkOrdersPanel`) and wrap with `React.memo`. All values currently captured by closure become explicit props.

```typescript
interface OrderCardProps {
  order: WorkOrder;
  busy: string | undefined;
  editingDueDateId: string | null;
  editingNotesId: string | null;
  draftNotes: string;
  onTransition: (order: WorkOrder, status: WorkOrderStatus, tornero?: string) => void;
  onArchive: (order: WorkOrder) => void;
  onPrint: (order: WorkOrder) => void;
  onSaveDueDate: (id: string, val: string) => void;
  onSaveNotes: (id: string) => void;
  onEditDueDate: (id: string | null) => void;
  onEditNotes: (id: string | null) => void;
  onDraftNotesChange: (val: string) => void;
}

export const OrderCard = React.memo(function OrderCard(props: OrderCardProps) {
  const { order, busy, ...handlers } = props;
  // same JSX as today, but reading from props instead of closure
});
```

Usage in the render loop:
```tsx
{listVisible.map(order => (
  <OrderCard
    key={order.id}
    order={order}
    busy={rowBusy[order.id]}
    editingDueDateId={editingDueDateId}
    editingNotesId={editingNotesId}
    draftNotes={draftNotes}
    onTransition={handleTransition}
    onArchive={handleArchive}
    onPrint={handlePrint}
    onSaveDueDate={handleSaveDueDate}
    onSaveNotes={handleSaveNotes}
    onEditDueDate={setEditingDueDateId}
    onEditNotes={setEditingNotesId}
    onDraftNotesChange={setDraftNotes}
  />
))}
```

---

## Section 4 — WorkOrdersPanel: Optimistic UI

### Problem

`handleTransition` blocks the UI with `setBusy` while waiting for Firebase (~200–500 ms). The card is disabled until the server confirms.

### Solution

Apply the state change **immediately**, fire Firebase in the background, revert on failure.

```typescript
const handleTransition = useCallback(async (
  order: WorkOrder,
  newStatus: WorkOrderStatus,
  torneroName?: string,
) => {
  // 1. Snapshot for rollback
  const snapshot = order;

  // 2. Optimistic update — UI responds instantly
  setOrders(prev => prev.map(o => {
    if (o.id !== order.id) return o;
    const now = new Date().toISOString();
    const base = { ...o, status: newStatus, updatedAtUTC: now };
    if (newStatus === 'en_proceso') return { ...base, assignedToTornero: torneroName ?? null, assignedAtUTC: now };
    if (newStatus === 'terminada')  return { ...base, finishedAtUTC: now };
    if (newStatus === 'entregada')  return { ...base, deliveredToTornero: torneroName ?? null, deliveredAtUTC: now };
    if (newStatus === 'pendiente')  return {
      ...base, assignedToTornero: null, assignedAtUTC: null,
      finishedAtUTC: null, deliveredToTornero: null, deliveredAtUTC: null,
    };
    return base;
  }));

  // 3. Firebase write (background)
  const res = await updateOrderStatus(order.id, newStatus, torneroName);

  if (!res.ok) {
    // 4a. Revert on failure
    setOrders(prev => prev.map(o => o.id === order.id ? snapshot : o));
    setErrorMessage(
      res.reason === 'not-authenticated'
        ? 'Inicia sesión para actualizar el estado.'
        : 'No fue posible actualizar el estado. Reintenta.',
    );
    return;
  }

  // 4b. Merge server-authoritative fields (deliveredToTornero from Firebase)
  setOrders(prev => prev.map(o => {
    if (o.id !== order.id) return o;
    if (newStatus === 'entregada') return { ...o, deliveredToTornero: res.value.deliveredToTornero };
    if (newStatus === 'en_proceso') return { ...o, assignedToTornero: res.value.deliveredToTornero };
    return o;
  }));
  onDataChanged?.();
}, [onDataChanged]);
```

**`setBusy` / `clearBusy` for transitions**: removed (no longer needed — the UI responds instantly).  
`setBusy` is **kept** for `handlePrint` (fetches a PDF from Firebase Storage, takes noticeable time) and `handleArchive` (user needs visual confirmation it worked).

### Error handling

Revert is silent (the card snaps back to its previous state) plus the existing error banner. No toast library needed.

---

## Section 5 — Error Handling & Edge Cases

| Scenario | Behavior |
|---|---|
| Firebase write fails on status change | Revert card state + show error banner |
| `extractInfo` throws mid-pipeline | `setIsExtracting(false)` in finally, `setError(message)` |
| `generateReportPdf` called with null results | Guard at call site; function never called with null |
| OrderCard memoization equality | Stable `useCallback` handlers in WorkOrdersPanel prevent unnecessary re-renders |
| `useVisionAnalysis` used without Firebase | Existing feature-disabled fallbacks in workOrders.ts remain |

---

## Section 6 — Implementation Order

To minimize risk, implement in this order:

1. **`pdfGenerator.ts`** — Pure function, no React. Easiest to verify (run app, generate PDF, compare output).
2. **`useVisionAnalysis.ts`** — Move state + logic, then update App.tsx imports. TypeScript will catch any missed bindings.
3. **OrderCard fix** — Extract to module scope, add props, wrap in React.memo. Verify search/filter no longer causes unmount flicker.
4. **Optimistic UI** — Modify `handleTransition` last, test happy path + network error simulation.

Each step is independently verifiable and committable.

---

## Verification Checklist

- [ ] `npm run lint` passes (no TypeScript errors)
- [ ] Full analysis pipeline runs end-to-end (upload order PDF + blueprint, generate report)
- [ ] PDF report generates correctly (same layout, hot stamp row with image if applicable)
- [ ] CSV and JSON exports work
- [ ] Work order status changes apply immediately in the UI
- [ ] Status change revert works when Firebase returns an error (simulate by going offline)
- [ ] Searching/filtering orders does not cause visual flicker (OrderCard memo working)
- [ ] App.tsx line count is ≤ 900
