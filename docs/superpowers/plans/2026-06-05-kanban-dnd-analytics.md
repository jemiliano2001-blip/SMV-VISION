# Kanban Drag-and-Drop + Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-column drag-and-drop to the kanban board and historical analytics charts to the Inicio view.

**Architecture:** Feature 1 uses `@hello-pangea/dnd` to wrap the existing kanban — a pure function `resolveKanbanDrop` extracts the decision logic so it's unit-testable. Feature 2 adds a `dailyMetricSnapshots` Firestore collection (written client-side on first app load of each day), two SVG chart components, and inlines the analytics sections below the existing KPIs in `InicioView`.

**Tech Stack:** `@hello-pangea/dnd` (drag-and-drop), Firestore (snapshot storage), custom SVG (charts), Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-06-05-kanban-dnd-analytics-design.md`

---

## File Map

**Created:**
- `src/lib/workOrders/kanbanDrop.ts` — pure function `resolveKanbanDrop`
- `src/lib/workOrders/__tests__/kanbanDrop.test.ts`
- `src/lib/firebase/metricsSnapshots.ts` — snapshot read/write + `buildSnapshotData`
- `src/lib/firebase/__tests__/metricsSnapshots.test.ts`
- `src/hooks/useDailySnapshot.ts` — capture orchestration hook
- `src/components/charts/BarChart.tsx` — horizontal SVG bar chart
- `src/components/charts/LineChart.tsx` — SVG line chart

**Modified:**
- `package.json` — add `@hello-pangea/dnd`
- `vite.config.ts` — add `dnd-vendor` manual chunk
- `src/components/WorkOrdersPanel.tsx` — replace native DnD with @hello-pangea/dnd
- `src/contexts/WorkOrdersContext.tsx` — call `useDailySnapshot` after first data load
- `src/components/InicioView.tsx` — add analytics sections

---

## Task 1: Install @hello-pangea/dnd and configure Vite chunk

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Install the library**

```bash
npm install @hello-pangea/dnd
```

Expected: `package.json` now lists `@hello-pangea/dnd` in `dependencies`.

- [ ] **Step 2: Add dnd-vendor chunk to vite.config.ts**

In `vite.config.ts`, inside the `manualChunks` function, add this block **before** the final `return 'vendor'` line:

```ts
if (id.includes('@hello-pangea/dnd') || id.includes('use-latest-ref')) {
  return 'dnd-vendor';
}
```

- [ ] **Step 3: Verify build still works**

```bash
npm run build
```

Expected: exits 0, output includes `dnd-vendor` chunk.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "chore: add @hello-pangea/dnd and dnd-vendor chunk"
```

---

## Task 2: Pure `resolveKanbanDrop` function + tests

**Files:**
- Create: `src/lib/workOrders/kanbanDrop.ts`
- Create: `src/lib/workOrders/__tests__/kanbanDrop.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/workOrders/__tests__/kanbanDrop.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { DropResult } from '@hello-pangea/dnd';
import { resolveKanbanDrop } from '../kanbanDrop';
import type { WorkOrder } from '../../../types';

function makeOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'wo-1',
    poNumber: 'PO-100',
    soNumber: 'SO-001',
    otDate: '2026-01-01',
    customer: 'SUPRAJIT',
    pieza: 'HEX BLOCK',
    numeroParte: 'WCD-001',
    cantidad: '2',
    prioridad: 'Normal',
    status: 'pendiente',
    matchedPartId: null,
    matchedDrawingId: null,
    matchScore: null,
    dueDate: null,
    notes: null,
    archived: false,
    sortIndex: null,
    assignedToTornero: null,
    deliveredToTornero: null,
    createdAtUTC: null,
    assignedAtUTC: null,
    finishedAtUTC: null,
    deliveredAtUTC: null,
    deliveredByUid: null,
    ...overrides,
  };
}

function makeDropResult(overrides: Partial<DropResult> = {}): DropResult {
  return {
    draggableId: 'wo-1',
    type: 'DEFAULT',
    source: { droppableId: 'pendiente', index: 0 },
    destination: { droppableId: 'en_proceso', index: 0 },
    reason: 'DROP',
    mode: 'FLUID',
    combine: null,
    ...overrides,
  };
}

describe('resolveKanbanDrop', () => {
  it('returns noop when destination is null', () => {
    const result = resolveKanbanDrop(
      makeDropResult({ destination: null }),
      [makeOrder()]
    );
    expect(result.type).toBe('noop');
    if (result.type === 'noop') expect(result.reason).toBe('no-destination');
  });

  it('returns reorder when dropped in the same column', () => {
    const result = resolveKanbanDrop(
      makeDropResult({ destination: { droppableId: 'pendiente', index: 1 } }),
      [makeOrder(), makeOrder({ id: 'wo-2', status: 'pendiente' })]
    );
    expect(result.type).toBe('reorder');
  });

  it('returns transition for valid cross-column drop to terminada', () => {
    const result = resolveKanbanDrop(
      makeDropResult({
        source: { droppableId: 'en_proceso', index: 0 },
        destination: { droppableId: 'terminada', index: 0 },
      }),
      [makeOrder({ id: 'wo-1', status: 'en_proceso', assignedToTornero: 'Juan' })]
    );
    expect(result.type).toBe('transition');
    if (result.type === 'transition') {
      expect(result.newStatus).toBe('terminada');
      expect(result.torneroName).toBeNull();
    }
  });

  it('returns transition with torneroName for drop to en_proceso when already assigned', () => {
    const result = resolveKanbanDrop(
      makeDropResult({
        source: { droppableId: 'pendiente', index: 0 },
        destination: { droppableId: 'en_proceso', index: 0 },
      }),
      [makeOrder({ assignedToTornero: 'Pedro' })]
    );
    expect(result.type).toBe('transition');
    if (result.type === 'transition') expect(result.torneroName).toBe('Pedro');
  });

  it('returns noop with tornero-required when dropping to en_proceso without assigned tornero', () => {
    const result = resolveKanbanDrop(
      makeDropResult({
        source: { droppableId: 'pendiente', index: 0 },
        destination: { droppableId: 'en_proceso', index: 0 },
      }),
      [makeOrder({ assignedToTornero: null })]
    );
    expect(result.type).toBe('noop');
    if (result.type === 'noop') expect(result.reason).toBe('tornero-required');
  });

  it('returns noop with tornero-required when dropping to entregada without assigned tornero', () => {
    const result = resolveKanbanDrop(
      makeDropResult({
        source: { droppableId: 'terminada', index: 0 },
        destination: { droppableId: 'entregada', index: 0 },
      }),
      [makeOrder({ status: 'terminada', assignedToTornero: null })]
    );
    expect(result.type).toBe('noop');
    if (result.type === 'noop') expect(result.reason).toBe('tornero-required');
  });

  it('returns noop when order is not found', () => {
    const result = resolveKanbanDrop(
      makeDropResult({ draggableId: 'nonexistent' }),
      [makeOrder()]
    );
    expect(result.type).toBe('noop');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- kanbanDrop
```

Expected: FAIL — `resolveKanbanDrop` not found.

- [ ] **Step 3: Implement `resolveKanbanDrop`**

Create `src/lib/workOrders/kanbanDrop.ts`:

```ts
import type { DropResult } from '@hello-pangea/dnd';
import type { WorkOrder, WorkOrderStatus } from '../../types';

const STAGES: WorkOrderStatus[] = ['pendiente', 'en_proceso', 'terminada', 'entregada'];

type KanbanDropNoop = { type: 'noop'; reason: 'no-destination' | 'same-column' | 'invalid-stage' | 'tornero-required' | 'order-not-found' };
type KanbanDropReorder = { type: 'reorder'; orderId: string; sourceIndex: number; destinationIndex: number };
type KanbanDropTransition = { type: 'transition'; orderId: string; newStatus: WorkOrderStatus; torneroName: string | null };

export type KanbanDropResult = KanbanDropNoop | KanbanDropReorder | KanbanDropTransition;

export function resolveKanbanDrop(result: DropResult, orders: WorkOrder[]): KanbanDropResult {
  if (!result.destination) {
    return { type: 'noop', reason: 'no-destination' };
  }

  const { droppableId: sourceCol, index: sourceIndex } = result.source;
  const { droppableId: destCol, index: destIndex } = result.destination;

  if (sourceCol === destCol) {
    return { type: 'reorder', orderId: result.draggableId, sourceIndex, destinationIndex: destIndex };
  }

  if (!STAGES.includes(destCol as WorkOrderStatus)) {
    return { type: 'noop', reason: 'invalid-stage' };
  }

  const order = orders.find((o) => o.id === result.draggableId);
  if (!order) {
    return { type: 'noop', reason: 'order-not-found' };
  }

  const newStatus = destCol as WorkOrderStatus;
  const needsTornero = newStatus === 'en_proceso' || newStatus === 'entregada';

  if (needsTornero && !order.assignedToTornero) {
    return { type: 'noop', reason: 'tornero-required' };
  }

  return {
    type: 'transition',
    orderId: result.draggableId,
    newStatus,
    torneroName: needsTornero ? order.assignedToTornero : null,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- kanbanDrop
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workOrders/kanbanDrop.ts src/lib/workOrders/__tests__/kanbanDrop.test.ts
git commit -m "feat: add resolveKanbanDrop pure function with tests"
```

---

## Task 3: Wire @hello-pangea/dnd into WorkOrdersPanel kanban

**Files:**
- Modify: `src/components/WorkOrdersPanel.tsx`

This task replaces the existing HTML5 native drag handlers (used for within-pendiente manual sort) with `@hello-pangea/dnd`, which handles both within-column reordering and cross-column transitions.

- [ ] **Step 1: Add imports at the top of WorkOrdersPanel.tsx**

After the existing imports, add:

```ts
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { resolveKanbanDrop } from '../lib/workOrders/kanbanDrop';
```

- [ ] **Step 2: Replace native drag handlers with handleKanbanDrop**

Find and **delete** these five callbacks in the component body (lines ~742–799 in the current file):

```ts
const handleDragStart = useCallback(...)
const handleDragOver = useCallback(...)
const handleDragEnter = useCallback(...)
const handleDragLeave = useCallback(...)
const handleDragEnd = useCallback(...)
const handleDrop = useCallback(...)
```

Also delete the `dragTargetId` state declaration:
```ts
const [dragTargetId, setDragTargetId] = useState<string | null>(null);
```

**Add** the new handler in their place:

```ts
const handleKanbanDrop = useCallback((result: DropResult) => {
  const drop = resolveKanbanDrop(result, orders);

  if (drop.type === 'noop') {
    if (drop.reason === 'tornero-required') {
      setErrorMessage('Asigna un tornero a la orden antes de moverla a esta etapa.');
    }
    return;
  }

  if (drop.type === 'reorder') {
    // Within-pendiente manual sort — same fractional midpoint logic as before
    const pendingOrders = filtered
      .filter((o) => o.status === 'pendiente')
      .sort((a, b) => (a.sortIndex ?? Infinity) - (b.sortIndex ?? Infinity))
      .map((o, i) => ({ ...o, _idx: o.sortIndex ?? i }));

    const sourceItem = pendingOrders[drop.sourceIndex];
    const insertAfter = drop.sourceIndex < drop.destinationIndex;
    const prevItem = insertAfter
      ? pendingOrders[drop.destinationIndex]
      : pendingOrders[drop.destinationIndex - 1];
    const nextItem = insertAfter
      ? pendingOrders[drop.destinationIndex + 1]
      : pendingOrders[drop.destinationIndex];

    if (!sourceItem) return;
    const prevIdx = prevItem?._idx ?? (pendingOrders[0]?._idx ?? 0) - 1;
    const nextIdx = nextItem?._idx ?? (pendingOrders[pendingOrders.length - 1]?._idx ?? 0) + 1;
    const newIndex = prevIdx + (nextIdx - prevIdx) / 2;

    setOrders((prev) => prev.map((o) => (o.id === drop.orderId ? { ...o, sortIndex: newIndex } : o)));
    void updateSortIndex(drop.orderId, newIndex);
    onDataChanged?.();
    return;
  }

  // type === 'transition'
  const order = orders.find((o) => o.id === drop.orderId);
  if (!order) return;
  void handleTransition(order, drop.newStatus, drop.torneroName ?? undefined);
}, [orders, filtered, handleTransition, onDataChanged]);
```

- [ ] **Step 3: Update the kanban board JSX**

Find the kanban board section that starts with:
```tsx
{status === 'ready' && filtered.length > 0 && viewMode === 'board' && (
  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
```

Wrap the outer `<div className="grid...">` with `<DragDropContext>`:
```tsx
{status === 'ready' && filtered.length > 0 && viewMode === 'board' && (
  <DragDropContext onDragEnd={handleKanbanDrop}>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
```

Close it after the grid's closing `</div>`:
```tsx
    </div>
  </DragDropContext>
)}
```

- [ ] **Step 4: Wrap each column's card list with Droppable**

Inside the `.map((col) => {...})` loop, find the card list container:
```tsx
<div className="p-2 space-y-2 grow">
  {cards.length === 0
    ? <p ...>—</p>
    : cards.map((o) => (
        <OrderCard ... />
      ))}
</div>
```

Replace it with:
```tsx
<Droppable droppableId={col}>
  {(droppableProvided) => (
    <div
      ref={droppableProvided.innerRef}
      {...droppableProvided.droppableProps}
      className="p-2 space-y-2 grow min-h-[40px]"
    >
      {cards.length === 0
        ? <p className="text-[10px] font-mono text-ink-dim/60 text-center py-6">—</p>
        : cards.map((o, cardIndex) => (
            <Draggable
              key={o.id}
              draggableId={o.id}
              index={cardIndex}
              isDragDisabled={isBulkMode || (col === 'pendiente' && pendientesSortBy !== 'manual')}
            >
              {(draggableProvided) => (
                <div
                  ref={draggableProvided.innerRef}
                  {...draggableProvided.draggableProps}
                  {...draggableProvided.dragHandleProps}
                >
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
                    onAssignTornero={handleAssignTornero}
                    onArchive={handleArchive}
                    onPrint={handlePrint}
                    onSaveDueDate={handleSaveDueDate}
                    onSaveNotes={handleSaveNotes}
                    onEditDueDate={setEditingDueDateId}
                    onEditNotes={setEditingNotesId}
                    onDraftDueDateChange={setDraftDueDate}
                    onDraftNotesChange={setDraftNotes}
                    workload={workload}
                    isBulkMode={isBulkMode}
                    isSelected={selectedOrders.has(o.id)}
                    onToggleSelect={handleToggleSelect}
                  />
                </div>
              )}
            </Draggable>
          ))}
      {droppableProvided.placeholder}
    </div>
  )}
</Droppable>
```

Note: The `draggable`, `onDragStart`, `onDragOver`, `onDrop`, `onDragEnd`, `onDragEnter`, `onDragLeave`, `dragTargetId` props are removed from `<OrderCard>` — they are no longer needed.

- [ ] **Step 5: Clean up OrderCard props interface**

In `WorkOrdersPanel.tsx`, find the `OrderCardProps` interface (around line 140–165). Remove these props:
```ts
draggable: boolean;
onDragStart: (e: React.DragEvent<HTMLDivElement>, id: string) => void;
onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
onDrop: (e: React.DragEvent<HTMLDivElement>, id: string) => void;
onDragEnd: () => void;
onDragEnter: (e: React.DragEvent<HTMLDivElement>, id: string) => void;
onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
dragTargetId: string | null;
```

Also remove the corresponding destructured variables inside the `OrderCard` function body and any JSX that references them (the `draggable`, `onDragStart`, etc. attributes on the card's root `<div>`).

- [ ] **Step 6: Type-check**

```bash
npm run lint
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/WorkOrdersPanel.tsx src/lib/workOrders/kanbanDrop.ts
git commit -m "feat: replace native DnD with @hello-pangea/dnd for cross-column kanban drag"
```

---

## Task 4: `metricsSnapshots.ts` Firebase module + tests

**Files:**
- Create: `src/lib/firebase/metricsSnapshots.ts`
- Create: `src/lib/firebase/__tests__/metricsSnapshots.test.ts`

- [ ] **Step 1: Write failing tests for `buildSnapshotData`**

Create `src/lib/firebase/__tests__/metricsSnapshots.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSnapshotData } from '../metricsSnapshots';
import type { WorkOrder } from '../../../types';

function makeOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'wo-1',
    poNumber: 'PO-100',
    soNumber: 'SO-001',
    otDate: '2026-01-01',
    customer: 'SUPRAJIT',
    pieza: 'HEX BLOCK',
    numeroParte: 'WCD-001',
    cantidad: '2',
    prioridad: 'Normal',
    status: 'pendiente',
    matchedPartId: null,
    matchedDrawingId: null,
    matchScore: null,
    dueDate: null,
    notes: null,
    archived: false,
    sortIndex: null,
    assignedToTornero: null,
    deliveredToTornero: null,
    createdAtUTC: null,
    assignedAtUTC: null,
    finishedAtUTC: null,
    deliveredAtUTC: null,
    deliveredByUid: null,
    ...overrides,
  };
}

describe('buildSnapshotData', () => {
  it('counts active orders by stage', () => {
    const orders = [
      makeOrder({ id: '1', status: 'pendiente' }),
      makeOrder({ id: '2', status: 'pendiente' }),
      makeOrder({ id: '3', status: 'en_proceso', assignedToTornero: 'Juan' }),
      makeOrder({ id: '4', status: 'terminada', assignedToTornero: 'Juan' }),
      makeOrder({ id: '5', status: 'entregada' }),
    ];
    const snap = buildSnapshotData(orders);
    expect(snap.byStage).toEqual({ pendiente: 2, en_proceso: 1, terminada: 1, entregada: 1 });
    expect(snap.totalActive).toBe(5);
  });

  it('excludes archived orders', () => {
    const orders = [
      makeOrder({ id: '1', status: 'pendiente' }),
      makeOrder({ id: '2', status: 'pendiente', archived: true }),
    ];
    const snap = buildSnapshotData(orders);
    expect(snap.totalActive).toBe(1);
    expect(snap.byStage.pendiente).toBe(1);
  });

  it('groups non-entregada orders by tornero', () => {
    const orders = [
      makeOrder({ id: '1', status: 'pendiente', assignedToTornero: null }),
      makeOrder({ id: '2', status: 'en_proceso', assignedToTornero: 'Juan' }),
      makeOrder({ id: '3', status: 'en_proceso', assignedToTornero: 'Juan' }),
      makeOrder({ id: '4', status: 'terminada', assignedToTornero: 'Pedro' }),
      makeOrder({ id: '5', status: 'entregada', assignedToTornero: 'Pedro' }), // excluded
    ];
    const snap = buildSnapshotData(orders);
    expect(snap.byTornero['Juan']).toBe(2);
    expect(snap.byTornero['Pedro']).toBe(1);
    expect(snap.byTornero['__unassigned__']).toBe(1);
    expect(snap.byTornero['Pedro']).not.toBeUndefined();
    // entregada orders are not counted in byTornero
    expect(Object.values(snap.byTornero).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('counts overdue orders (past due date, not entregada)', () => {
    const orders = [
      makeOrder({ id: '1', status: 'pendiente', dueDate: '2020-01-01' }), // overdue
      makeOrder({ id: '2', status: 'pendiente', dueDate: '2030-01-01' }), // ok
      makeOrder({ id: '3', status: 'entregada', dueDate: '2020-01-01' }), // entregada, not overdue
    ];
    const snap = buildSnapshotData(orders);
    expect(snap.overdueCount).toBe(1);
  });

  it('sets date as today in YYYY-MM-DD format', () => {
    const snap = buildSnapshotData([]);
    expect(snap.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- metricsSnapshots
```

Expected: FAIL — `buildSnapshotData` not found.

- [ ] **Step 3: Implement `metricsSnapshots.ts`**

Create `src/lib/firebase/metricsSnapshots.ts`:

```ts
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import type { WorkOrder } from '../../types';
import { getFirestoreClient } from './client';
import { calcMetrics, getDueDateSeverity } from '../workOrders/metrics';
import { log } from '../log';

const COLLECTION = 'dailyMetricSnapshots';

export interface DailyMetricSnapshot {
  date: string;
  onTimePercent: number | null;
  totalActive: number;
  overdueCount: number;
  criticalCount: number;
  byStage: Record<string, number>;
  byTornero: Record<string, number>;
}

type SnapshotResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Pure — computes snapshot data from current orders. No Firebase I/O. */
export function buildSnapshotData(orders: WorkOrder[]): DailyMetricSnapshot {
  const today = new Date().toISOString().slice(0, 10);
  const active = orders.filter((o) => !o.archived);
  const metrics = calcMetrics(orders);

  const byStage: Record<string, number> = {
    pendiente: 0, en_proceso: 0, terminada: 0, entregada: 0,
  };
  for (const o of active) {
    byStage[o.status] = (byStage[o.status] ?? 0) + 1;
  }

  const byTornero: Record<string, number> = {};
  for (const o of active.filter((o) => o.status !== 'entregada')) {
    const key = o.assignedToTornero ?? '__unassigned__';
    byTornero[key] = (byTornero[key] ?? 0) + 1;
  }

  const overdueCount = active.filter(
    (o) => getDueDateSeverity(o.dueDate, o.status) === 'overdue',
  ).length;
  const criticalCount = active.filter(
    (o) => getDueDateSeverity(o.dueDate, o.status) === 'critical',
  ).length;

  return {
    date: today,
    onTimePercent: metrics.onTimePct,
    totalActive: active.length,
    overdueCount,
    criticalCount,
    byStage,
    byTornero,
  };
}

/** Returns today's snapshot if it exists, null if it doesn't. */
export async function getTodaySnapshot(): Promise<SnapshotResult<DailyMetricSnapshot | null>> {
  const database = getFirestoreClient();
  if (!database) return { ok: false, reason: 'not-configured' };
  const today = new Date().toISOString().slice(0, 10);
  try {
    const snap = await getDoc(doc(database, COLLECTION, today));
    if (!snap.exists()) return { ok: true, value: null };
    return { ok: true, value: snap.data() as DailyMetricSnapshot };
  } catch (err) {
    log.warn('[metricsSnapshots] getTodaySnapshot failed', err);
    return { ok: false, reason: 'read-failed' };
  }
}

/** Writes today's snapshot. Overwrites if called more than once in a day. */
export async function writeSnapshot(data: DailyMetricSnapshot): Promise<SnapshotResult<void>> {
  const database = getFirestoreClient();
  if (!database) return { ok: false, reason: 'not-configured' };
  try {
    await setDoc(doc(database, COLLECTION, data.date), {
      ...data,
      capturedAt: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (err) {
    log.warn('[metricsSnapshots] writeSnapshot failed', err);
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * Returns up to n * 7 snapshots (n weeks), in chronological order.
 * Queries by date string descending then reverses, so Firestore needs no
 * composite index (date is the document ID, ordered naturally).
 */
export async function getSnapshotsLastWeeks(
  n: number,
): Promise<SnapshotResult<DailyMetricSnapshot[]>> {
  const database = getFirestoreClient();
  if (!database) return { ok: false, reason: 'not-configured' };
  try {
    const q = query(
      collection(database, COLLECTION),
      orderBy('date', 'desc'),
      limit(n * 7),
    );
    const snap = await getDocs(q);
    const results: DailyMetricSnapshot[] = [];
    snap.forEach((d) => results.push(d.data() as DailyMetricSnapshot));
    return { ok: true, value: results.reverse() };
  } catch (err) {
    log.warn('[metricsSnapshots] getSnapshotsLastWeeks failed', err);
    return { ok: false, reason: 'read-failed' };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- metricsSnapshots
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/firebase/metricsSnapshots.ts src/lib/firebase/__tests__/metricsSnapshots.test.ts
git commit -m "feat: add metricsSnapshots Firebase module with buildSnapshotData"
```

---

## Task 5: `useDailySnapshot` hook

**Files:**
- Create: `src/hooks/useDailySnapshot.ts`

This hook is called from `WorkOrdersContext` after orders first load. It checks if today's snapshot exists; if not, it writes one. Fire-and-forget — no UI state.

- [ ] **Step 1: Create the hook**

Create `src/hooks/useDailySnapshot.ts`:

```ts
import { useEffect, useRef } from 'react';
import type { WorkOrder } from '../types';
import { buildSnapshotData, getTodaySnapshot, writeSnapshot } from '../lib/firebase/metricsSnapshots';
import { log } from '../lib/log';

/**
 * Writes a daily metric snapshot once per day on first app load.
 * Called after WorkOrdersContext has its first non-empty snapshot.
 * Fire-and-forget — errors are logged but never surfaced.
 */
export function useDailySnapshot(orders: WorkOrder[], isReady: boolean): void {
  const hasCaptured = useRef(false);

  useEffect(() => {
    if (!isReady || orders.length === 0 || hasCaptured.current) return;
    hasCaptured.current = true;

    void (async () => {
      const existing = await getTodaySnapshot();
      if (!existing.ok || existing.value !== null) {
        // Already captured today (or Firestore unavailable) — skip
        return;
      }
      const data = buildSnapshotData(orders);
      const result = await writeSnapshot(data);
      if (result.ok) {
        log.info('[useDailySnapshot] snapshot captured for', data.date);
      }
    })();
  }, [isReady, orders]);
}
```

- [ ] **Step 2: Type-check**

```bash
npm run lint
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDailySnapshot.ts
git commit -m "feat: add useDailySnapshot hook for daily metric capture"
```

---

## Task 6: `BarChart` SVG component

**Files:**
- Create: `src/components/charts/BarChart.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/charts/BarChart.tsx`:

```tsx
import type { ReactElement } from 'react';

export interface BarChartEntry {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarChartEntry[];
  title?: string;
  /** CSS variable name for bar fill, e.g. '--color-accent'. Default: '--color-accent'. */
  colorVar?: string;
  emptyMessage?: string;
}

const BAR_H = 20;
const GAP = 6;
const LABEL_W = 88;
const VALUE_W = 24;
const CHART_W = 300;
const BAR_AREA_W = CHART_W - LABEL_W - VALUE_W;

export function BarChart({
  data,
  title,
  colorVar = '--color-accent',
  emptyMessage = '—',
}: BarChartProps): ReactElement {
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const svgH = data.length * (BAR_H + GAP) - GAP;

  return (
    <div>
      {title && (
        <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mb-2">{title}</p>
      )}
      {data.length === 0 ? (
        <p className="font-mono text-[10px] text-ink-dim">{emptyMessage}</p>
      ) : (
        <svg
          width="100%"
          viewBox={`0 0 ${CHART_W} ${svgH}`}
          aria-label={title}
          role="img"
        >
          {data.map((d, i) => {
            const barW = Math.max((d.value / maxVal) * BAR_AREA_W, d.value > 0 ? 2 : 0);
            const y = i * (BAR_H + GAP);
            return (
              <g key={d.label}>
                {/* label */}
                <text
                  x={LABEL_W - 6}
                  y={y + BAR_H / 2 + 4}
                  textAnchor="end"
                  fontSize={9}
                  fontFamily="monospace"
                  fill="currentColor"
                  opacity={0.6}
                >
                  {d.label}
                </text>
                {/* bar */}
                <rect
                  x={LABEL_W}
                  y={y}
                  width={barW}
                  height={BAR_H}
                  fill={`var(${colorVar})`}
                  opacity={0.75}
                />
                {/* value */}
                <text
                  x={LABEL_W + barW + 4}
                  y={y + BAR_H / 2 + 4}
                  fontSize={9}
                  fontFamily="monospace"
                  fill="currentColor"
                  opacity={0.8}
                >
                  {d.value}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run lint
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/charts/BarChart.tsx
git commit -m "feat: add BarChart SVG component"
```

---

## Task 7: `LineChart` SVG component

**Files:**
- Create: `src/components/charts/LineChart.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/charts/LineChart.tsx`:

```tsx
import type { ReactElement } from 'react';

export interface LineChartPoint {
  date: string;   // 'YYYY-MM-DD'
  value: number | null;
}

interface LineChartProps {
  data: LineChartPoint[];
  title?: string;
  unit?: string;
  minValue?: number;
  maxValue?: number;
}

const W = 300;
const H = 100;
const PAD = { top: 10, right: 28, bottom: 20, left: 24 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

export function LineChart({
  data,
  title,
  unit = '%',
  minValue = 0,
  maxValue = 100,
}: LineChartProps): ReactElement {
  const validPoints = data.filter((d) => d.value !== null);

  if (validPoints.length < 2) {
    return (
      <div>
        {title && (
          <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mb-2">{title}</p>
        )}
        <p className="font-mono text-[10px] text-ink-dim py-4 text-center">
          Acumulando datos históricos…
        </p>
      </div>
    );
  }

  const n = data.length;
  const range = maxValue - minValue || 1;

  const toX = (i: number) => PAD.left + (i / Math.max(n - 1, 1)) * INNER_W;
  const toY = (v: number) => PAD.top + INNER_H - ((v - minValue) / range) * INNER_H;

  const pathSegments: string[] = [];
  let inLine = false;
  data.forEach((d, i) => {
    if (d.value === null) { inLine = false; return; }
    const x = toX(i).toFixed(1);
    const y = toY(d.value).toFixed(1);
    pathSegments.push(`${inLine ? 'L' : 'M'} ${x} ${y}`);
    inLine = true;
  });

  const lastValid = [...data].reverse().find((d) => d.value !== null);
  const lastIdx = lastValid ? data.lastIndexOf(lastValid) : -1;

  // X-axis: show first and last date (abbreviated)
  const firstDate = data[0]?.date.slice(5) ?? ''; // MM-DD
  const lastDate = data[n - 1]?.date.slice(5) ?? '';

  return (
    <div>
      {title && (
        <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mb-2">{title}</p>
      )}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} aria-label={title} role="img">
        {/* Axes */}
        <line
          x1={PAD.left} y1={PAD.top}
          x2={PAD.left} y2={PAD.top + INNER_H}
          stroke="currentColor" strokeOpacity={0.15}
        />
        <line
          x1={PAD.left} y1={PAD.top + INNER_H}
          x2={W - PAD.right} y2={PAD.top + INNER_H}
          stroke="currentColor" strokeOpacity={0.15}
        />
        {/* Y-axis labels */}
        <text x={PAD.left - 3} y={PAD.top + 4} textAnchor="end" fontSize={7} fontFamily="monospace" fill="currentColor" opacity={0.4}>{maxValue}{unit}</text>
        <text x={PAD.left - 3} y={PAD.top + INNER_H + 4} textAnchor="end" fontSize={7} fontFamily="monospace" fill="currentColor" opacity={0.4}>{minValue}</text>
        {/* X-axis labels */}
        <text x={PAD.left} y={H - 3} fontSize={7} fontFamily="monospace" fill="currentColor" opacity={0.4}>{firstDate}</text>
        <text x={W - PAD.right} y={H - 3} textAnchor="end" fontSize={7} fontFamily="monospace" fill="currentColor" opacity={0.4}>{lastDate}</text>
        {/* Line */}
        <path d={pathSegments.join(' ')} fill="none" stroke="var(--color-ok)" strokeWidth={2} strokeLinejoin="round" />
        {/* Dots */}
        {data.map((d, i) =>
          d.value !== null ? (
            <circle key={i} cx={toX(i)} cy={toY(d.value)} r={2.5} fill="var(--color-ok)" />
          ) : null,
        )}
        {/* Last value annotation */}
        {lastIdx >= 0 && lastValid?.value !== null && (
          <text
            x={toX(lastIdx) + 5}
            y={toY(lastValid!.value as number) + 4}
            fontSize={8}
            fontFamily="monospace"
            fill="currentColor"
            opacity={0.8}
          >
            {lastValid!.value}{unit}
          </text>
        )}
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run lint
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/charts/LineChart.tsx
git commit -m "feat: add LineChart SVG component"
```

---

## Task 8: Wire `useDailySnapshot` into `WorkOrdersContext`

**Files:**
- Modify: `src/contexts/WorkOrdersContext.tsx`

- [ ] **Step 1: Add import**

At the top of `WorkOrdersContext.tsx`, add:

```ts
import { useDailySnapshot } from '../hooks/useDailySnapshot';
```

- [ ] **Step 2: Call the hook inside `WorkOrdersProvider`**

Inside `WorkOrdersProvider`, after the existing state declarations, add:

```ts
// Capture one daily metric snapshot per day after orders first load.
useDailySnapshot(orders, status === 'ready');
```

Place this directly before the `return` statement (after all `useEffect`s).

- [ ] **Step 3: Type-check**

```bash
npm run lint
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/WorkOrdersContext.tsx
git commit -m "feat: wire useDailySnapshot into WorkOrdersContext"
```

---

## Task 9: Add analytics sections to InicioView

**Files:**
- Modify: `src/components/InicioView.tsx`

- [ ] **Step 1: Update imports**

`InicioView.tsx` currently has `import type { ReactElement } from 'react'`. Replace that line with:

```ts
import { useEffect, useMemo, useState, type ReactElement } from 'react';
```

Then add after the existing imports:

```ts
import { BarChart } from './charts/BarChart';
import { LineChart } from './charts/LineChart';
import type { DailyMetricSnapshot } from '../lib/firebase/metricsSnapshots';
import { getSnapshotsLastWeeks } from '../lib/firebase/metricsSnapshots';
```

- [ ] **Step 2: Add state and derived data inside `InicioView`**

The function currently destructures `const { counts, metrics, attention, status, reason } = summary;`. Add `orders` to that destructure:

```ts
const { counts, metrics, attention, status, reason, orders } = summary;
```

Then, after the existing `kpis` array, add:

```ts
const [snapshots, setSnapshots] = useState<DailyMetricSnapshot[]>([]);

useEffect(() => {
  void getSnapshotsLastWeeks(8).then((res) => {
    if (res.ok) setSnapshots(res.value);
  });
}, []);

const stageData = [
  { label: 'Pendiente', value: counts.pendiente },
  { label: 'En proceso', value: counts.enProceso },
  { label: 'Terminada', value: counts.terminada },
  { label: 'Entregada', value: counts.entregada },
];

const torneroData = useMemo(() => {
  const map: Record<string, number> = {};
  for (const o of orders.filter((o) => !o.archived && o.status !== 'entregada')) {
    const key = o.assignedToTornero ?? 'Sin asignar';
    map[key] = (map[key] ?? 0) + 1;
  }
  return Object.entries(map)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}, [orders]);

const trendData = snapshots.map((s) => ({ date: s.date, value: s.onTimePercent }));
```

- [ ] **Step 3: Add analytics sections to JSX**

After the closing `</div>` of the `<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">` section (around line 208, right before `</motion.div>`), insert:

```tsx
{/* ── Analytics ── */}
{status === 'ready' && (
  <>
    <motion.div variants={item} className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
      <div className="bg-surface border-2 border-line p-4">
        <BarChart
          data={stageData}
          title="Órdenes por etapa"
          colorVar="--color-accent"
        />
      </div>
      <div className="bg-surface border-2 border-line p-4">
        <BarChart
          data={torneroData}
          title="Carga por tornero"
          colorVar="--color-draft"
          emptyMessage="Sin asignaciones activas"
        />
      </div>
    </motion.div>

    <motion.div variants={item} className="mt-4 bg-surface border-2 border-line p-4">
      <LineChart
        data={trendData}
        title="% A tiempo — últimas 8 semanas"
        unit="%"
      />
    </motion.div>
  </>
)}
```

- [ ] **Step 4: Type-check**

```bash
npm run lint
```

Expected: exits 0.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all tests PASS (kanbanDrop, metricsSnapshots, plus existing suite).

- [ ] **Step 6: Commit**

```bash
git add src/components/InicioView.tsx src/components/charts/
git commit -m "feat: add analytics charts to Inicio view (stage, tornero, on-time trend)"
```

---

## Done

After Task 9 both features are complete:
- Kanban cards draggable across columns; within-pendiente manual sort preserved.
- Daily snapshot captured automatically; Inicio shows stage distribution, tornero load, and on-time% trend.
