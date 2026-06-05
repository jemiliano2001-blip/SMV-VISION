# Design: Kanban Drag-and-Drop + Analytics Dashboard

**Date:** 2026-06-05
**Status:** Approved

---

## Overview

Two independent features that improve the daily workflow of production operators:

1. **Drag-and-drop kanban** — move work orders between stages by dragging cards instead of using the status dropdown.
2. **Analytics in Inicio** — current metrics (stage distribution, tornero load) plus a historical on-time% trend chart powered by daily Firestore snapshots.

---

## Feature 1: Drag-and-Drop Kanban

### Approach

Use `@hello-pangea/dnd` (maintained React DnD library, ~10KB gzipped). Wraps the existing kanban columns with `DragDropContext`, `Droppable` (per column), and `Draggable` (per card). On drop, calls the existing `updateOrderStatus` function — the optimistic UI already handles local state and Firestore sync.

### Component Structure

```
<DragDropContext onDragEnd={handleDragEnd}>
  {STAGES.map(stage => (
    <Droppable droppableId={stage}>
      {ordersInStage.map((order, index) => (
        <Draggable draggableId={order.id} index={index}>
          <OrderCard ... />
        </Draggable>
      ))}
    </Droppable>
  ))}
</DragDropContext>
```

### Data Flow

1. User grabs a card → `@hello-pangea/dnd` lifts it visually, shows placeholder in origin column.
2. User drops on a different column → `onDragEnd` fires with `draggableId` (workOrderId) and `destination.droppableId` (stage name).
3. `handleDragEnd` calls `updateOrderStatus(workOrderId, newStage)`.
4. Optimistic UI updates local state immediately; Firestore `onSnapshot` (via `WorkOrdersContext`) confirms asynchronously.

### Rules

- Drag only active in kanban view (list view unchanged).
- Drag disabled when `editMode === true` (from `useEditMode`).
- Drop on same column is a no-op.
- Card receives elevated box-shadow during drag, using the existing brutalist shadow system.

### Files Changed

| File | Change |
|------|--------|
| `package.json` | Add `@hello-pangea/dnd` dependency |
| `vite.config.ts` | Add `dnd-vendor` manual chunk |
| `src/components/WorkOrdersPanel.tsx` | Wrap kanban with DnD components, add `handleDragEnd` |

---

## Feature 2: Analytics in Inicio

### Snapshot Data Model

New Firestore collection: `dailyMetricSnapshots`
Document ID: `YYYY-MM-DD`

```ts
interface DailyMetricSnapshot {
  date: string                     // 'YYYY-MM-DD'
  onTimePercent: number
  totalActive: number
  overdueCount: number
  criticalCount: number
  byStage: Record<string, number>  // { pendiente: 4, en_proceso: 7, terminada: 2, entregada: 1 }
  byTornero: Record<string, number> // keys are tornero names; unassigned orders use key '__unassigned__'
  capturedAt: Timestamp
}
```

### Snapshot Capture Logic

A new `useDailySnapshot` hook, called from `WorkOrdersContext` once `workOrders` data is available. Triggered on the first `onSnapshot` callback that returns a non-empty array (i.e., after the collection is confirmed loaded, not on the initial empty state):

1. Read `dailyMetricSnapshots/{today}` — if it exists, do nothing.
2. If not: compute metrics from current `workOrders` using existing functions from `metrics.ts`, then write the document.
3. Fire-and-forget — any write failure is logged with `log.warn` but never surfaces in UI.

This guarantees at most one snapshot per day, written by the first user to open the app each day.

### New Modules

**`src/lib/firebase/metricsSnapshots.ts`**
- `getTodaySnapshot(): Promise<SnapshotResult>` — read today's document
- `writeSnapshot(data): Promise<SnapshotResult>` — write today's document
- `getSnapshotsLastWeeks(n: number): Promise<SnapshotsResult>` — read last N weeks of documents for trend chart (queries by date string, ordered descending)
- Same result-type contract as the rest of the Firebase layer (never throws)

**`src/hooks/useDailySnapshot.ts`**
- Orchestrates the capture logic described above
- Accepts current `workOrders` array as input
- Called from `WorkOrdersContext` after initial data load

**`src/components/charts/LineChart.tsx`**
- Pure SVG, zero dependencies
- Props: `data: { date: string; value: number }[]`, `width`, `height`, `label`
- Renders on-time% trend with labeled axes
- Uses CSS color tokens (`accent`, `ok`, `danger`, `ink`, `line`)

**`src/components/charts/BarChart.tsx`**
- Pure SVG, zero dependencies
- Props: `data: { label: string; value: number }[]`, `width`, `height`, `horizontal?: boolean`
- Used for tornero load (horizontal) and stage distribution (vertical or horizontal)
- Uses CSS color tokens

### InicioView Layout

```
┌──────────────────────────────────────────────┐
│  KPIs existentes (overdue / critical / ...)   │
├───────────────────┬──────────────────────────┤
│  Carga torneros   │  Órdenes por stage        │
│  (BarChart)       │  (BarChart)               │
├───────────────────┴──────────────────────────┤
│  On-time % — últimas 8 semanas               │
│  (LineChart, ancho completo)                 │
│  Fallback: "Acumulando datos históricos..."  │
│  (shown when fewer than 2 snapshots exist)   │
└──────────────────────────────────────────────┘
```

All charts use the existing CSS variable tokens from `src/index.css`. No new colors introduced.

### Files Changed

| File | Change |
|------|--------|
| `src/lib/firebase/metricsSnapshots.ts` | New — snapshot read/write |
| `src/hooks/useDailySnapshot.ts` | New — capture orchestration |
| `src/components/charts/LineChart.tsx` | New — SVG line chart |
| `src/components/charts/BarChart.tsx` | New — SVG bar chart |
| `src/contexts/WorkOrdersContext.tsx` | Call `useDailySnapshot` after data loads |
| `src/components/InicioView.tsx` | Add three analytics sections |
| `firestore.rules` | Allow authenticated read/write on `dailyMetricSnapshots` |

---

## What Is Out of Scope

- Mobile/touch support for drag-and-drop (desktop-only app)
- Snapshot backfill (history starts from first run after deploy)
- Cloud Functions or server-side cron for snapshots
- Third-party chart libraries
- Exporting analytics data
