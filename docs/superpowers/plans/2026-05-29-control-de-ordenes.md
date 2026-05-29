# Control de Órdenes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent order-control layer on top of the existing report generator: every piece of every uploaded PO is saved in Firestore as a tracked work order (Pendiente → Entregada a [tornero] + fecha), and the deliverable handed to the machinist is the original full blueprint stamped with SO · cantidad · fecha.

**Architecture:** Reuse the existing analysis pipeline (`extractInfo()` in `App.tsx`, matching in `src/lib/matching.ts`). Add (1) a pure dedupe module, (2) a Firestore data layer + validators following the existing `toolcrib.ts` result-type pattern, (3) a PDF-stamping helper using `pdf-lib`, (4) a new `WorkOrdersPanel` tab. The report generator is untouched.

**Tech Stack:** React 19 + TypeScript (strict, no `any`), Firebase Firestore (`firebase@12`), `pdf-lib` (new), `jspdf` (existing), Tailwind v4, Vite. No test runner — pure logic is verified with `tsx` assertion scripts; types with `tsc --noEmit`; UI/Firebase manually.

**Key decisions (from spec):**
- Single operator. States: `pendiente` / `entregada`.
- Input: multi-page PDF, one PO per page; uploads accumulate.
- The genuinely-new field is **PO**. **SO = existing `order.orden`**, **OT date = existing `order.fecha`** (no redundant fields). Only `poNumber` is added to the extraction.
- The stamped deliverable = original full blueprint (vector PDF) + top-left stamp box: **SO · cantidad · fecha**. The isometric crop is NOT stamped/delivered.
- Dedupe key = `${soNumber||poNumber}::${normalizedPartNumber||normalizedPieza}`. Re-upload never duplicates and never resets delivery state.
- `firestore.rules` already allow authenticated read/write via wildcard — **no rules change needed**.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | modify | add `pdf-lib` dependency |
| `src/types.ts` | modify | add `poNumber` to `ExtractedOrder`/`Order`; add `matchedDrawingId`/`matchedPartId` to `Order`; add `WorkOrder`, `Tornero` domain types |
| `src/lib/workOrders/dedupe.ts` | create | pure `buildDedupeKey` + `mergeUpsert` (no I/O) |
| `scripts/verify/workOrdersDedupe.ts` | create | tsx assertion script for dedupe |
| `src/lib/firebase/workOrderValidators.ts` | create | normalize/validate `workOrders` + `torneros` docs |
| `scripts/verify/workOrderValidators.ts` | create | tsx assertion script for validators |
| `src/lib/firebase/workOrders.ts` | create | Firestore data layer (result-type, never throws) |
| `src/lib/planoOt.ts` | create | stamp original blueprint PDF with SO·cantidad·fecha (pdf-lib) |
| `src/lib/orderMerge.ts` | modify | carry `poNumber` through parse + merge |
| `src/App.tsx` | modify | prompt + `ORDER_PROMPT_VERSION` bump; capture matched drawing per order; upsert to control; tab nav |
| `src/components/WorkOrdersPanel.tsx` | create | the Control de Órdenes view |

---

## Task 1: Add `pdf-lib` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pdf-lib**

Run:
```bash
npm install pdf-lib@^1.17.1
```
Expected: `package.json` `dependencies` gains `"pdf-lib": "^1.17.1"`, `package-lock.json` updated, no peer-dep errors.

- [ ] **Step 2: Verify it resolves**

Run:
```bash
node -e "require.resolve('pdf-lib'); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add pdf-lib for stamping work-order blueprints"
```

---

## Task 2: Domain types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `poNumber` to `ExtractedOrder`**

In `src/types.ts`, replace the `ExtractedOrder` interface with:

```ts
export interface ExtractedOrder {
  pieza: string;
  numero_parte: string;
  cantidad: string;
  orden: string;       // SO (sales order)
  fecha: string;       // OT date
  prioridad: 'URGENTE' | 'Normal';
  poNumber: string;    // PO (purchase order) — distinct from SO, trazabilidad interna
}
```

- [ ] **Step 2: Extend `Order`**

In `src/types.ts`, inside the `Order` interface, add these fields after `sourceImageDataUrl?: string;`:

```ts
  /** PO (orden de compra del cliente). Distinta del SO (`orden`). */
  poNumber?: string;
  /** Dibujo del catálogo Tool Crib emparejado con esta orden (si hubo match). */
  matchedDrawingId?: string;
  matchedPartId?: string;
```

- [ ] **Step 3: Add control-layer domain types**

Append to the end of `src/types.ts`:

```ts
/** Estado de una orden de trabajo en la capa de control. */
export type WorkOrderStatus = 'pendiente' | 'entregada';

/**
 * Forma canónica de una orden de trabajo (una pieza de una PO) lista para
 * la UI. Se construye normalizando el documento de Firestore. Las fechas
 * llegan como ISO-8601 UTC (string) o null — el formateo local es del componente.
 */
export interface WorkOrder {
  id: string;
  poNumber: string;
  soNumber: string;
  otDate: string;
  customer: string;
  pieza: string;
  numeroParte: string;
  cantidad: string;
  prioridad: 'URGENTE' | 'Normal';
  status: WorkOrderStatus;
  matchedPartId: string | null;
  matchedDrawingId: string | null;
  matchScore: number | null;
  deliveredToTornero: string | null;
  deliveredAtUTC: string | null;
  deliveredByUid: string | null;
  sourcePdfName: string;
  archived: boolean;
  createdAtUTC: string | null;
  updatedAtUTC: string | null;
}

/** Tornero al que se le entregan planos. */
export interface Tornero {
  id: string;
  name: string;
  active: boolean;
  createdAtUTC: string | null;
}
```

- [ ] **Step 4: Type-check**

Run:
```bash
npm run lint
```
Expected: PASS for `src/types.ts` itself. NOTE: `orderMerge.ts` and `App.tsx` will now report errors because `ExtractedOrder` requires `poNumber` — those are fixed in Tasks 7 & 8. If you want a green build now, do Step 5 commit and proceed; the build goes green again at end of Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add poNumber + work-order control types"
```

---

## Task 3: Pure dedupe logic

**Files:**
- Create: `src/lib/workOrders/dedupe.ts`
- Create (verification): `scripts/verify/workOrdersDedupe.ts`

- [ ] **Step 1: Write the dedupe module**

Create `src/lib/workOrders/dedupe.ts`:

```ts
/**
 * Lógica pura de deduplicación/upsert de órdenes de control. SIN I/O.
 *
 * La llave de dedup amarra una pieza concreta a su orden: `SO::parte`
 * (o `SO::pieza` si no hay número de parte; o `PO::…` si no hay SO).
 * Re-subir la misma PO produce las mismas llaves => no se duplica y, en el
 * upsert, NO se pisa el estado de entrega ya marcado.
 */

import { normalizePieceLabel } from '../matching';

/** Campos mínimos que necesita el dedup de una orden extraída. */
export interface DedupeInput {
  soNumber: string;
  poNumber: string;
  numeroParte: string;
  pieza: string;
}

/** Toma la primera línea no vacía (SO/fecha pueden venir multi-línea). */
function firstLine(value: string): string {
  return (value ?? '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)[0] ?? '';
}

export function buildDedupeKey(input: DedupeInput): string {
  const so = normalizePieceLabel(firstLine(input.soNumber));
  const po = normalizePieceLabel(firstLine(input.poNumber));
  const parte = normalizePieceLabel(input.numeroParte);
  const pieza = normalizePieceLabel(input.pieza);
  const orderKey = so || po || 'SIN-ORDEN';
  const pieceKey = parte || pieza || 'SIN-PIEZA';
  return `${orderKey}::${pieceKey}`;
}

/** Campos que un upsert puede refrescar sin tocar el estado de entrega. */
export interface UpsertMutableFields {
  cantidad: string;
  prioridad: 'URGENTE' | 'Normal';
  matchedDrawingId: string | null;
  matchedPartId: string | null;
  matchScore: number | null;
  otDate: string;
  poNumber: string;
  soNumber: string;
}

export interface MergeUpsertResult<TExisting> {
  /** Llaves nuevas (no existían): hay que crearlas. */
  toCreate: string[];
  /** Existentes a refrescar: id del doc + campos mutables. */
  toUpdate: Array<{ id: string; key: string; fields: UpsertMutableFields }>;
}

/**
 * Decide, dado el set de órdenes ya en la base (por dedupeKey) y las recién
 * extraídas, cuáles crear y cuáles actualizar. NUNCA marca para borrar nada.
 *
 * @param existingByKey  Map dedupeKey -> { id } de lo ya guardado.
 * @param incoming       órdenes extraídas (ya con su dedupeKey calculado).
 */
export function mergeUpsert<TExisting extends { id: string }>(
  existingByKey: ReadonlyMap<string, TExisting>,
  incoming: ReadonlyArray<{ key: string; fields: UpsertMutableFields }>,
): MergeUpsertResult<TExisting> {
  const toCreate: string[] = [];
  const toUpdate: Array<{ id: string; key: string; fields: UpsertMutableFields }> = [];
  const seen = new Set<string>();

  for (const item of incoming) {
    if (seen.has(item.key)) continue; // colapsa duplicados dentro del mismo lote
    seen.add(item.key);

    const existing = existingByKey.get(item.key);
    if (existing) {
      toUpdate.push({ id: existing.id, key: item.key, fields: item.fields });
    } else {
      toCreate.push(item.key);
    }
  }

  return { toCreate, toUpdate };
}
```

- [ ] **Step 2: Write the verification script**

Create `scripts/verify/workOrdersDedupe.ts`:

```ts
/* Verificación pura de dedupe. Correr: npx tsx scripts/verify/workOrdersDedupe.ts */
import { buildDedupeKey, mergeUpsert, type UpsertMutableFields } from '../../src/lib/workOrders/dedupe';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { failures += 1; console.error('  FAIL:', msg); }
  else { console.log('  ok:', msg); }
}

const f: UpsertMutableFields = {
  cantidad: '2', prioridad: 'Normal', matchedDrawingId: null, matchedPartId: null,
  matchScore: null, otDate: '2026-05-01', poNumber: 'PO-1', soNumber: 'SO-1',
};

// buildDedupeKey
assert(
  buildDedupeKey({ soNumber: 'SO-100', poNumber: 'PO-9', numeroParte: '90-1012-05', pieza: 'X' })
    === 'SO-100::90-1012-05',
  'usa SO + número de parte',
);
assert(
  buildDedupeKey({ soNumber: '', poNumber: 'PO-9', numeroParte: '', pieza: 'Buje 3/8' })
    === 'PO-9::BUJE 3/8',
  'cae a PO + pieza cuando faltan SO y parte',
);
assert(
  buildDedupeKey({ soNumber: 'SO 200\nSO 201', poNumber: '', numeroParte: 'A1', pieza: 'X' })
    === 'SO 200::A1',
  'toma la primera línea del SO multi-línea',
);

// mergeUpsert: create vs update + preserva (no marca borrados) + colapsa lote
const existing = new Map([['SO-1::A1', { id: 'doc-1' }]]);
const res = mergeUpsert(existing, [
  { key: 'SO-1::A1', fields: f },   // existe -> update
  { key: 'SO-2::B2', fields: f },   // nuevo  -> create
  { key: 'SO-2::B2', fields: f },   // duplicado en lote -> ignorado
]);
assert(res.toUpdate.length === 1 && res.toUpdate[0].id === 'doc-1', 'actualiza el existente por id');
assert(res.toCreate.length === 1 && res.toCreate[0] === 'SO-2::B2', 'crea solo el nuevo, una vez');

if (failures > 0) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('\nTODO OK');
```

- [ ] **Step 3: Run the verification — expect PASS**

Run:
```bash
npx tsx scripts/verify/workOrdersDedupe.ts
```
Expected: ends with `TODO OK`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workOrders/dedupe.ts scripts/verify/workOrdersDedupe.ts
git commit -m "feat(work-orders): pure dedupe/upsert logic + verification"
```

---

## Task 4: Firestore validators

**Files:**
- Create: `src/lib/firebase/workOrderValidators.ts`
- Create (verification): `scripts/verify/workOrderValidators.ts`

- [ ] **Step 1: Write the validators**

Create `src/lib/firebase/workOrderValidators.ts`:

```ts
/**
 * Validación/normalización de frontera para `workOrders` y `torneros`.
 * Mismo patrón que `toolcribValidators.ts`: documentos inválidos => null
 * (se descartan en el caller). Timestamps se normalizan a ISO UTC string.
 */

import type { Timestamp } from 'firebase/firestore';
import type { WorkOrder, WorkOrderStatus, Tornero } from '../../types';

const STR_MAX = 512;
const ID_MAX = 128;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
function str(v: unknown, fallback: string, maxLen = STR_MAX): string {
  if (typeof v !== 'string') return fallback;
  const t = v.trim();
  if (t.length === 0) return fallback;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}
function optStr(v: unknown, maxLen = STR_MAX): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function priority(v: unknown): 'URGENTE' | 'Normal' {
  return v === 'URGENTE' ? 'URGENTE' : 'Normal';
}
function statusOf(v: unknown): WorkOrderStatus {
  return v === 'entregada' ? 'entregada' : 'pendiente';
}
function hasTimestampShape(v: unknown): v is Timestamp {
  return isPlainObject(v) && typeof (v as { toDate?: unknown }).toDate === 'function';
}
function ts(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (hasTimestampShape(v)) { try { return v.toDate().toISOString(); } catch { return null; } }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function normalizeWorkOrder(id: string, raw: unknown): WorkOrder | null {
  if (!isPlainObject(raw) || typeof id !== 'string' || id.length === 0) return null;
  if (!isNonEmptyString(raw.pieza)) return null;
  return {
    id,
    poNumber: str(raw.poNumber, '', ID_MAX),
    soNumber: str(raw.soNumber, '', ID_MAX),
    otDate: str(raw.otDate, '', ID_MAX),
    customer: str(raw.customer, 'SUPRAJIT', ID_MAX),
    pieza: str(raw.pieza, '', STR_MAX),
    numeroParte: str(raw.numeroParte, '', ID_MAX),
    cantidad: str(raw.cantidad, '', ID_MAX),
    prioridad: priority(raw.prioridad),
    status: statusOf(raw.status),
    matchedPartId: optStr(raw.matchedPartId, ID_MAX),
    matchedDrawingId: optStr(raw.matchedDrawingId, ID_MAX),
    matchScore: num(raw.matchScore),
    deliveredToTornero: optStr(raw.deliveredToTornero, ID_MAX),
    deliveredAtUTC: ts(raw.deliveredAtUTC),
    deliveredByUid: optStr(raw.deliveredByUid, ID_MAX),
    sourcePdfName: str(raw.sourcePdfName, '', STR_MAX),
    archived: bool(raw.archived, false),
    createdAtUTC: ts(raw.createdAtUTC),
    updatedAtUTC: ts(raw.updatedAtUTC),
  };
}

export function normalizeTornero(id: string, raw: unknown): Tornero | null {
  if (!isPlainObject(raw) || typeof id !== 'string' || id.length === 0) return null;
  if (!isNonEmptyString(raw.name)) return null;
  return {
    id,
    name: str(raw.name, '', ID_MAX),
    active: bool(raw.active, true),
    createdAtUTC: ts(raw.createdAtUTC),
  };
}

/** Sanea un nombre de tornero para escritura. null => inválido. */
export function sanitizeTorneroName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(/\s+/g, ' ');
  if (t.length === 0 || t.length > 80) return null;
  return t;
}
```

- [ ] **Step 2: Write the verification script**

Create `scripts/verify/workOrderValidators.ts`:

```ts
/* Correr: npx tsx scripts/verify/workOrderValidators.ts */
import { normalizeWorkOrder, normalizeTornero, sanitizeTorneroName } from '../../src/lib/firebase/workOrderValidators';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { failures += 1; console.error('  FAIL:', msg); }
  else { console.log('  ok:', msg); }
}

assert(normalizeWorkOrder('', { pieza: 'X' }) === null, 'rechaza id vacío');
assert(normalizeWorkOrder('w1', { pieza: '' }) === null, 'rechaza pieza vacía');

const w = normalizeWorkOrder('w1', {
  pieza: 'BUJE', poNumber: 'PO-1', soNumber: 'SO-1', otDate: '2026-05-01',
  cantidad: '2', prioridad: 'URGENTE', status: 'entregada', matchScore: 95,
  deliveredToTornero: 'Juan', deliveredByUid: 'uid-1',
});
assert(w !== null && w.status === 'entregada' && w.prioridad === 'URGENTE', 'normaliza estado/prioridad');
assert(w !== null && w.customer === 'SUPRAJIT', 'customer default SUPRAJIT');
assert(w !== null && w.matchScore === 95 && w.matchedDrawingId === null, 'numéricos y opcionales');

const def = normalizeWorkOrder('w2', { pieza: 'X' });
assert(def !== null && def.status === 'pendiente' && def.archived === false, 'defaults pendiente/no-archivado');

assert(normalizeTornero('t1', { name: '' }) === null, 'tornero sin nombre => null');
const t = normalizeTornero('t1', { name: ' Juan  Pérez ' });
assert(t !== null && t.name === 'Juan Pérez' && t.active === true, 'tornero normaliza nombre/active');

assert(sanitizeTorneroName('   ') === null, 'nombre en blanco inválido');
assert(sanitizeTorneroName('  Ana   Lopez ') === 'Ana Lopez', 'colapsa espacios');

if (failures > 0) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('\nTODO OK');
```

- [ ] **Step 3: Run the verification — expect PASS**

Run:
```bash
npx tsx scripts/verify/workOrderValidators.ts
```
Expected: ends with `TODO OK`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/firebase/workOrderValidators.ts scripts/verify/workOrderValidators.ts
git commit -m "feat(work-orders): Firestore validators + verification"
```

---

## Task 5: Firestore data layer

**Files:**
- Create: `src/lib/firebase/workOrders.ts`

- [ ] **Step 1: Write the data layer**

Create `src/lib/firebase/workOrders.ts`:

```ts
/**
 * Capa de datos de la Control de Órdenes. Mismo contrato que `toolcrib.ts`:
 * las funciones NUNCA lanzan (devuelven result type), el uid se resuelve en el
 * writer desde Auth (no spoofeable) y los timestamps usan `serverTimestamp()`.
 */

import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit as fbLimit,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

import type { WorkOrder, Tornero } from '../../types';
import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
import {
  normalizeWorkOrder,
  normalizeTornero,
  sanitizeTorneroName,
} from './workOrderValidators';
import {
  buildDedupeKey,
  mergeUpsert,
  type UpsertMutableFields,
} from '../workOrders/dedupe';

export const WORK_ORDERS_COLLECTION = 'workOrders';
export const TORNEROS_COLLECTION = 'torneros';

const DEFAULT_MAX = 2000;

export type WorkOrderFailureReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'invalid-input'
  | 'read-failed'
  | 'write-failed';

export type WorkOrderResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: WorkOrderFailureReason };

function db(): Firestore | null {
  return getFirestoreClient();
}
function isAuthed(): boolean {
  return getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();
}

/** Una orden recién extraída lista para upsert (campos crudos + match). */
export interface IncomingWorkOrder {
  pieza: string;
  numeroParte: string;
  cantidad: string;
  prioridad: 'URGENTE' | 'Normal';
  soNumber: string;
  poNumber: string;
  otDate: string;
  customer: string;
  matchedDrawingId: string | null;
  matchedPartId: string | null;
  matchScore: number | null;
  sourcePdfName: string;
}

function toMutable(o: IncomingWorkOrder): UpsertMutableFields {
  return {
    cantidad: o.cantidad,
    prioridad: o.prioridad,
    matchedDrawingId: o.matchedDrawingId,
    matchedPartId: o.matchedPartId,
    matchScore: o.matchScore,
    otDate: o.otDate,
    poNumber: o.poNumber,
    soNumber: o.soNumber,
  };
}

/**
 * Lee todas las órdenes (con límite duro) y las normaliza. Sin orderBy para
 * no requerir índices compuestos; el orden/filtrado fino se hace en memoria.
 */
export async function listWorkOrders(options?: {
  max?: number;
}): Promise<WorkOrderResult<WorkOrder[]>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  try {
    const q = query(
      collection(database, WORK_ORDERS_COLLECTION),
      fbLimit(Math.min(options?.max ?? DEFAULT_MAX, DEFAULT_MAX)),
    );
    const snap = await getDocs(q);
    const out: WorkOrder[] = [];
    snap.forEach((d) => {
      const n = normalizeWorkOrder(d.id, d.data());
      if (n) out.push(n);
    });
    return { ok: true, value: out };
  } catch (error) {
    console.warn('[smv-vision][work-orders] listWorkOrders falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Crea/actualiza órdenes a partir de un lote extraído. Lee lo existente una
 * vez, calcula el diff con `mergeUpsert` (puro) y escribe en batch. Preserva
 * el estado de entrega: las actualizaciones nunca tocan `status`/`delivered*`.
 */
export async function upsertWorkOrders(
  incoming: IncomingWorkOrder[],
): Promise<WorkOrderResult<{ created: number; updated: number }>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  const uid = getCurrentUserUid();
  if (!uid && !isToolcribDebugUnauthAllowed()) {
    return { ok: false, reason: 'not-authenticated' };
  }
  if (incoming.length === 0) return { ok: true, value: { created: 0, updated: 0 } };

  // 1) snapshot existente -> Map por dedupeKey
  const existingResult = await listWorkOrders();
  if (existingResult.ok === false) return existingResult;
  const existingByKey = new Map<string, { id: string }>();
  for (const wo of existingResult.value) {
    const key = buildDedupeKey({
      soNumber: wo.soNumber, poNumber: wo.poNumber,
      numeroParte: wo.numeroParte, pieza: wo.pieza,
    });
    if (!existingByKey.has(key)) existingByKey.set(key, { id: wo.id });
  }

  // 2) diff puro
  const incomingWithKeys = incoming.map((o) => ({
    key: buildDedupeKey({
      soNumber: o.soNumber, poNumber: o.poNumber,
      numeroParte: o.numeroParte, pieza: o.pieza,
    }),
    fields: toMutable(o),
    raw: o,
  }));
  const byKey = new Map(incomingWithKeys.map((i) => [i.key, i.raw]));
  const diff = mergeUpsert(existingByKey, incomingWithKeys);

  // 3) escritura en batch (Firestore: máx 500 ops por batch)
  try {
    const batch = writeBatch(database);
    for (const key of diff.toCreate) {
      const o = byKey.get(key)!;
      const ref = doc(collection(database, WORK_ORDERS_COLLECTION));
      batch.set(ref, {
        poNumber: o.poNumber, soNumber: o.soNumber, otDate: o.otDate,
        customer: o.customer, pieza: o.pieza, numeroParte: o.numeroParte,
        cantidad: o.cantidad, prioridad: o.prioridad,
        status: 'pendiente',
        matchedPartId: o.matchedPartId, matchedDrawingId: o.matchedDrawingId,
        matchScore: o.matchScore,
        deliveredToTornero: null, deliveredAtUTC: null, deliveredByUid: null,
        sourcePdfName: o.sourcePdfName, archived: false,
        createdAtUTC: serverTimestamp(), updatedAtUTC: serverTimestamp(),
      });
    }
    for (const u of diff.toUpdate) {
      const ref = doc(database, WORK_ORDERS_COLLECTION, u.id);
      batch.update(ref, {
        cantidad: u.fields.cantidad, prioridad: u.fields.prioridad,
        matchedPartId: u.fields.matchedPartId, matchedDrawingId: u.fields.matchedDrawingId,
        matchScore: u.fields.matchScore, otDate: u.fields.otDate,
        poNumber: u.fields.poNumber, soNumber: u.fields.soNumber,
        updatedAtUTC: serverTimestamp(),
      });
    }
    await batch.commit();
    return { ok: true, value: { created: diff.toCreate.length, updated: diff.toUpdate.length } };
  } catch (error) {
    console.warn('[smv-vision][work-orders] upsertWorkOrders falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/** Marca una orden como entregada. El uid lo fija el writer desde Auth. */
export async function markDelivered(
  orderId: string,
  torneroName: string,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  const uid = getCurrentUserUid();
  if (!uid) return { ok: false, reason: 'not-authenticated' };
  const name = sanitizeTorneroName(torneroName);
  if (typeof orderId !== 'string' || orderId.trim().length === 0 || !name) {
    return { ok: false, reason: 'invalid-input' };
  }
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      status: 'entregada',
      deliveredToTornero: name,
      deliveredAtUTC: serverTimestamp(),
      deliveredByUid: uid,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] markDelivered falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

/** Revierte a pendiente (por si se marcó por error). */
export async function markPending(orderId: string): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid()) return { ok: false, reason: 'not-authenticated' };
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      status: 'pendiente',
      deliveredToTornero: null, deliveredAtUTC: null, deliveredByUid: null,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] markPending falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function archiveWorkOrder(
  orderId: string,
  archived: boolean,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid()) return { ok: false, reason: 'not-authenticated' };
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  try {
    await updateDoc(doc(database, WORK_ORDERS_COLLECTION, orderId.trim()), {
      archived: archived === true,
      updatedAtUTC: serverTimestamp(),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] archiveWorkOrder falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function listTorneros(): Promise<WorkOrderResult<Tornero[]>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };
  try {
    const snap = await getDocs(
      query(collection(database, TORNEROS_COLLECTION), fbLimit(200)),
    );
    const out: Tornero[] = [];
    snap.forEach((d) => {
      const n = normalizeTornero(d.id, d.data());
      if (n) out.push(n);
    });
    return { ok: true, value: out };
  } catch (error) {
    console.warn('[smv-vision][work-orders] listTorneros falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

export async function addTornero(name: string): Promise<WorkOrderResult<{ id: string }>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid()) return { ok: false, reason: 'not-authenticated' };
  const clean = sanitizeTorneroName(name);
  if (!clean) return { ok: false, reason: 'invalid-input' };
  try {
    const ref = await addDoc(collection(database, TORNEROS_COLLECTION), {
      name: clean, active: true, createdAtUTC: serverTimestamp(),
    });
    return { ok: true, value: { id: ref.id } };
  } catch (error) {
    console.warn('[smv-vision][work-orders] addTornero falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function setTorneroActive(
  id: string,
  active: boolean,
): Promise<WorkOrderResult<void>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!getCurrentUserUid()) return { ok: false, reason: 'not-authenticated' };
  if (typeof id !== 'string' || id.trim().length === 0) {
    return { ok: false, reason: 'invalid-input' };
  }
  try {
    await updateDoc(doc(database, TORNEROS_COLLECTION, id.trim()), { active: active === true });
    return { ok: true, value: undefined };
  } catch (error) {
    console.warn('[smv-vision][work-orders] setTorneroActive falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}
```

- [ ] **Step 2: Type-check (isolated)**

Run:
```bash
npm run lint
```
Expected: no NEW errors originating in `src/lib/firebase/workOrders.ts` or `workOrderValidators.ts`. (Pre-existing errors from Task 2 in `orderMerge.ts`/`App.tsx` may still show — resolved in Tasks 7–8.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/firebase/workOrders.ts
git commit -m "feat(work-orders): Firestore data layer (upsert/list/deliver/torneros)"
```

---

## Task 6: Plano-OT stamping helper

**Files:**
- Create: `src/lib/planoOt.ts`

- [ ] **Step 1: Write the stamping helper**

Create `src/lib/planoOt.ts`:

```ts
/**
 * Sella el blueprint ORIGINAL (con medidas) con un recuadro arriba-izquierda:
 * SO · cantidad · fecha. No recorta nada: el tornero necesita las cotas.
 * El cajetín del plano suele ir abajo-derecha, así que arriba-izquierda es
 * zona segura.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface PlanoOtStamp {
  soNumber: string;
  cantidad: string;
  fecha: string;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Una sola línea legible (SO/fecha pueden venir multi-línea). */
function oneLine(value: string): string {
  return (value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Toma el dataURL de un PDF y devuelve los bytes del PDF sellado en la página 1.
 */
export async function stampPlanoOt(
  pdfDataUrl: string,
  stamp: PlanoOtStamp,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(dataUrlToUint8Array(pdfDataUrl));
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  if (pages.length === 0) throw new Error('El PDF no tiene páginas.');
  const page = pages[0];
  const { height } = page.getSize();

  const lines = [
    `SO: ${oneLine(stamp.soNumber) || '—'}`,
    `CANT: ${oneLine(stamp.cantidad) || '—'}`,
    `FECHA: ${oneLine(stamp.fecha) || '—'}`,
  ];
  const fontSize = 11;
  const padding = 6;
  const lineHeight = fontSize + 4;
  const boxW = Math.max(
    ...lines.map((l) => font.widthOfTextAtSize(l, fontSize)),
  ) + padding * 2;
  const boxH = lineHeight * lines.length + padding;
  const margin = 12;
  const top = height - margin;

  // Fondo blanco con borde negro para legibilidad sobre el dibujo.
  page.drawRectangle({
    x: margin, y: top - boxH, width: boxW, height: boxH,
    color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1.5,
  });
  lines.forEach((line, i) => {
    page.drawText(line, {
      x: margin + padding,
      y: top - padding - fontSize - i * lineHeight,
      size: fontSize, font, color: rgb(0, 0, 0),
    });
  });

  return pdfDoc.save();
}

/** Abre el PDF sellado en una pestaña nueva (para imprimir). */
export async function openStampedPlanoOt(
  pdfDataUrl: string,
  stamp: PlanoOtStamp,
): Promise<void> {
  const bytes = await stampPlanoOt(pdfDataUrl, stamp);
  // Copia a un ArrayBuffer "limpio" para el Blob (evita SharedArrayBuffer typing).
  const buffer = bytes.slice().buffer;
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    // Fallback: forzar descarga si el navegador bloqueó el pop-up.
    const a = document.createElement('a');
    a.href = url;
    a.download = `plano-ot-${oneLine(stamp.soNumber) || 'orden'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint
```
Expected: no NEW errors in `src/lib/planoOt.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/planoOt.ts
git commit -m "feat(work-orders): stamp original blueprint as plano-OT (pdf-lib)"
```

---

## Task 7: Extraction prompt — capture PO

**Files:**
- Modify: `src/App.tsx` (prompt + schema + `ORDER_PROMPT_VERSION`)
- Modify: `src/lib/orderMerge.ts` (carry `poNumber`)

- [ ] **Step 1: Bump the prompt version**

In `src/App.tsx`, change line 51:
```ts
const ORDER_PROMPT_VERSION = 'orders-v6-sublineas-dedupe';
```
to:
```ts
const ORDER_PROMPT_VERSION = 'orders-v7-po-multi-hoja';
```

- [ ] **Step 2: Update the order prompt text + schema**

In `src/App.tsx`, in the order-extraction prompt (the `text:` starting `Analiza esta tabla PDF...`), replace the field list block:

```
- pieza: descripción completa y ÚNICA de la pieza (incluyendo el número de parte si no tiene columna propia)
- numero_parte: SOLO el código alfanumérico de parte (ej: "90-1012-05", "PN-12345", "WCD01-1824"). Si no existe o no aplica, devuelve "".
- cantidad: número con su unidad si aparece (ej: "2.00\\nPieza", "10\\nSet").
- orden
- fecha
- prioridad (solo "URGENTE" o "Normal")
```

with:

```
- pieza: descripción completa y ÚNICA de la pieza (incluyendo el número de parte si no tiene columna propia)
- numero_parte: SOLO el código alfanumérico de parte (ej: "90-1012-05", "PN-12345", "WCD01-1824"). Si no existe o no aplica, devuelve "".
- cantidad: número con su unidad si aparece (ej: "2.00\\nPieza", "10\\nSet").
- orden: el número de SO (sales order / orden interna) de la hoja. Si no hay, "".
- fecha: la fecha de la orden de trabajo (OT) que aparece en la hoja. Si no hay, "".
- prioridad (solo "URGENTE" o "Normal")
- poNumber: el número de PO (orden de compra del cliente) de la hoja. Cada hoja del PDF es una PO con sus piezas. PO y SO son DISTINTOS. Si no hay, "".
```

Then, in the same prompt, add this rule before the line `11) No inventes campos ni texto fuera del JSON.` (renumber the final rule to 12):

```
11) Cada HOJA del PDF corresponde a una PO. Propaga el mismo poNumber (y su SO/fecha) a TODAS las piezas listadas en esa hoja.
12) No inventes campos ni texto fuera del JSON.
```

- [ ] **Step 3: Update the responseSchema**

In `src/App.tsx`, in the order-extraction `responseSchema.items.properties`, add `poNumber` and include it in `required`:

```ts
                    properties: {
                      pieza: { type: Type.STRING },
                      numero_parte: { type: Type.STRING },
                      cantidad: { type: Type.STRING },
                      orden: { type: Type.STRING },
                      fecha: { type: Type.STRING },
                      prioridad: { type: Type.STRING, enum: ["URGENTE", "Normal"] },
                      poNumber: { type: Type.STRING }
                    },
                    required: ["pieza", "numero_parte", "cantidad", "orden", "fecha", "prioridad", "poNumber"]
```

- [ ] **Step 4: Carry `poNumber` through parse + merge in `orderMerge.ts`**

In `src/lib/orderMerge.ts`, in `parseOrdersResponse`, update the `.map(...)` object to include `poNumber`:

```ts
    .map((item) => ({
      pieza: asString(item.pieza),
      numero_parte: asString(item.numero_parte),
      cantidad: asString(item.cantidad) || 'N/A',
      orden: asString(item.orden) || 'N/A',
      fecha: asString(item.fecha) || 'N/A',
      prioridad: parsePriority(item.prioridad),
      poNumber: asString(item.poNumber),
    }))
```

In `src/lib/orderMerge.ts`, in `mergeGroupedOrders`, the merged-group `result.push(...)` must preserve `poNumber` from the first row of the group. Replace:

```ts
    result.push({ pieza: group[0].pieza, numero_parte: group[0].numero_parte, cantidad, orden, fecha, prioridad });
```

with:

```ts
    const poNumber = group.find((o) => o.poNumber)?.poNumber ?? group[0].poNumber ?? '';
    result.push({ pieza: group[0].pieza, numero_parte: group[0].numero_parte, cantidad, orden, fecha, prioridad, poNumber });
```

- [ ] **Step 5: Type-check**

Run:
```bash
npm run lint
```
Expected: `orderMerge.ts` errors from Task 2 are now resolved. (Remaining errors, if any, are in `App.tsx` from Task 2's `Order` change — resolved in Task 8.)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/lib/orderMerge.ts
git commit -m "feat(orders): extract PO per sheet; bump order prompt to v7"
```

---

## Task 8: Capture matched drawing + upsert to control

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import the upsert function**

In `src/App.tsx`, after the existing import from `./lib/firebase/toolcrib` (line 48), add:

```ts
import { upsertWorkOrders, type IncomingWorkOrder } from './lib/firebase/workOrders';
```

- [ ] **Step 2: Capture the matched library drawing per order**

In `src/App.tsx`, inside `extractInfo`, declare the capture map at FUNCTION scope so it is reachable both inside the matching loop and in the upsert block (Step 3). The matching loop lives inside `if (libResult.ok) { ... }`, but the upsert runs AFTER that block closes — so the map MUST be declared outside it.

Right after `const ordersList = mergeGroupedOrders(rawOrders);` (line 711), add:

```ts
      // Captura el dibujo de catálogo emparejado por orden, para la capa de control.
      // Declarado aquí (no dentro de `if (libResult.ok)`) para seguir en alcance en el upsert.
      const matchByOrder = new Map<ExtractedOrder, { drawingId: string; partId: string; score: number }>();
```

Then, INSIDE the matching loop `for (const order of ordersList) { ... }` (around line 735), record the match. The loop already computes `bestView`/`bestScore` and has an `if (bestView && bestScore >= MIN_BLUEPRINT_MATCH_SCORE) { ... }` block for fetching. Add a SEPARATE recording statement just before the loop's closing brace (records the match even when the drawing has no fetchable `pdfUrl`):

```ts
          if (bestView && bestScore >= MIN_BLUEPRINT_MATCH_SCORE) {
            matchByOrder.set(order, {
              drawingId: bestView.drawingId,
              partId: bestView.partId,
              score: bestScore,
            });
          }
```

> NOTE: orders that hit the earlier `hasManualMatch` `continue` won't be recorded here (manual PDFs have no catalog `drawingId`); they still get upserted with `matchedDrawingId: null`. That's expected for v1.

- [ ] **Step 3: Upsert orders into the control layer (before the workshop-empty guard)**

In `src/App.tsx`, the matching `if (libResult.ok) { ... }` block ends around line 819, immediately followed by:

```ts
      if (currentWorkshopPdfs.length === 0) {
```

INSERT the following upsert block BETWEEN the end of the `if (libResult.ok)` block and the `if (currentWorkshopPdfs.length === 0)` guard, so orders are saved even when no blueprint is attached:

```ts
      // Persistir TODAS las órdenes en la capa de control (incluso sin plano):
      // una orden "Pendiente sin plano" también se debe rastrear.
      try {
        const incoming: IncomingWorkOrder[] = ordersList.map((order) => {
          const m = matchByOrder.get(order);
          return {
            pieza: order.pieza,
            numeroParte: order.numero_parte,
            cantidad: order.cantidad,
            prioridad: order.prioridad,
            soNumber: order.orden,
            poNumber: order.poNumber ?? '',
            otDate: order.fecha,
            customer: 'SUPRAJIT',
            matchedDrawingId: m?.drawingId ?? null,
            matchedPartId: m?.partId ?? null,
            matchScore: m?.score ?? null,
            sourcePdfName: orderPdfName ?? '',
          };
        });
        const upsertResult = await upsertWorkOrders(incoming);
        if (upsertResult.ok) {
          log.debug('[smv-vision][work-orders] upsert', upsertResult.value);
        } else {
          console.warn('[smv-vision][work-orders] upsert no aplicado:', upsertResult.reason);
        }
      } catch (woErr) {
        console.warn('[smv-vision][work-orders] upsert lanzó (inesperado)', woErr);
      }
```

> NOTE: `matchByOrder` is keyed by the `ExtractedOrder` object reference, and `ordersList` holds those same references (output of `mergeGroupedOrders`), so the lookup is valid. `order.poNumber` exists because `ExtractedOrder` now has it (Task 7).

- [ ] **Step 4: Type-check**

Run:
```bash
npm run lint
```
Expected: PASS, zero errors (Task 2 type changes are now fully consumed).

- [ ] **Step 5: Manual smoke test**

Run `npm run dev`, sign in, upload a PO PDF, run analysis. In the browser console you should see `[smv-vision][work-orders] upsert { created: N, updated: 0 }`. Re-run the same PDF: expect `{ created: 0, updated: N }` (no duplicates).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(work-orders): upsert extracted orders into control layer"
```

---

## Task 9: Tab navigation in App

> **Depends on Task 10** (`WorkOrdersPanel`). Implement **Task 10 first**, then this task — the tab wiring imports the panel, so doing it before Task 10 leaves a dangling import and a red build.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add a tab state**

In `src/App.tsx`, near the other `useState` calls at the top of `App()` (e.g. after `const [previewOrder, setPreviewOrder] = useState<Order | null>(null);` around line 340), add:

```ts
  const [activeTab, setActiveTab] = useState<'reporte' | 'control'>('reporte');
```

- [ ] **Step 2: Import the panel**

In `src/App.tsx`, after the `WorkOrdersPanel` file exists (Task 10) this import resolves; add it now next to the other component import (line 47):

```ts
import { WorkOrdersPanel } from './components/WorkOrdersPanel';
```

> If doing Task 9 strictly before Task 10, temporarily skip this import and the `<WorkOrdersPanel/>` usage, then add both in Task 10. Recommended: do Task 10 first, then this step compiles cleanly.

- [ ] **Step 3: Render a tab bar under the header**

In `src/App.tsx` `return (...)`, immediately AFTER the closing `</header>` (line 1598) and BEFORE `<main ...>` (line 1600), insert:

```tsx
      {/* Tab bar */}
      <nav className="bg-bg border-b-2 border-ink px-10 flex gap-0">
        {([
          ['reporte', 'Generar Reporte'],
          ['control', 'Control de Órdenes'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-5 py-3 text-[12px] font-black uppercase tracking-widest border-r-2 border-ink transition-colors ${
              activeTab === key ? 'bg-ink text-bg' : 'bg-bg text-ink hover:bg-ink/10'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
```

- [ ] **Step 4: Gate the existing `<main>` and add the control panel**

In `src/App.tsx`, change the opening `<main className="grow grid grid-cols-1 xl:grid-cols-12 overflow-hidden">` (line 1600) to be conditional. Replace that single opening tag with:

```tsx
      {activeTab === 'control' && (
        <main className="grow overflow-y-auto p-8">
          <WorkOrdersPanel />
        </main>
      )}

      <main
        className="grow grid-cols-1 xl:grid-cols-12 overflow-hidden grid"
        style={{ display: activeTab === 'reporte' ? undefined : 'none' }}
      >
```

> NOTE: the existing report `<main>` is kept mounted (hidden via `display:none`) so an in-progress analysis isn't unmounted when switching tabs. Its original closing `</main>` stays where it is. The `grid`/`grid-cols` classes are preserved.

- [ ] **Step 5: Type-check + manual**

Run:
```bash
npm run lint
```
Expected: PASS (assuming Task 10 done so the import resolves).

Manual: `npm run dev` → two tabs appear; switching shows the report UI vs the control panel; an analysis running in "Generar Reporte" keeps running when you switch to "Control de Órdenes" and back.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): tab navigation between report and control views"
```

---

## Task 10: WorkOrdersPanel component

**Files:**
- Create: `src/components/WorkOrdersPanel.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/WorkOrdersPanel.tsx`:

```tsx
/**
 * WorkOrdersPanel — la vista "Control de Órdenes".
 *
 * Lista las órdenes acumuladas (Firestore), con filtros y búsqueda; permite
 * marcar "Entregar a [tornero]" (prueba con sello de servidor) e imprimir el
 * plano-OT (blueprint original sellado con SO·cantidad·fecha). Gestión mínima
 * de torneros. Toda la E/S pasa por `src/lib/firebase/workOrders.ts`.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  AlertCircle, CheckCircle2, Loader2, Printer, RefreshCcw, Search, Plus, Archive,
} from 'lucide-react';

import type { WorkOrder, Tornero } from '../types';
import {
  listWorkOrders, markDelivered, markPending, archiveWorkOrder,
  listTorneros, addTornero, setTorneroActive,
} from '../lib/firebase/workOrders';
import { getDrawingById } from '../lib/firebase/toolcrib';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { openStampedPlanoOt } from '../lib/planoOt';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
type StatusFilter = 'todas' | 'pendiente' | 'entregada';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
function oneLine(value: string): string {
  return (value ?? '').replace(/[\r\n]+/g, ' / ').replace(/\s+/g, ' ').trim();
}
function norm(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function WorkOrdersPanel(): ReactElement {
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [torneros, setTorneros] = useState<Tornero[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pendiente');
  const [showArchived, setShowArchived] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [rowBusy, setRowBusy] = useState<Record<string, string>>({});
  const [newTornero, setNewTornero] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    const [woRes, tRes] = await Promise.all([listWorkOrders(), listTorneros()]);
    if (woRes.ok === false) {
      setStatus('error');
      setErrorMessage(
        woRes.reason === 'not-configured'
          ? 'Firebase no está configurado. Completa VITE_FIREBASE_* en .env.local.'
          : woRes.reason === 'not-authenticated'
            ? 'Inicia sesión para ver y registrar órdenes.'
            : 'No fue posible cargar las órdenes. Revisa tu conexión.',
      );
      return;
    }
    setOrders(woRes.value);
    if (tRes.ok) setTorneros(tRes.value);
    setStatus('ready');
  }, []);

  useEffect(() => {
    if (status === 'idle') void load();
  }, [load, status]);

  const activeTorneros = useMemo(
    () => torneros.filter((t) => t.active).sort((a, b) => a.name.localeCompare(b.name)),
    [torneros],
  );

  const visible = useMemo(() => {
    const term = norm(search);
    return orders
      .filter((o) => (showArchived ? true : !o.archived))
      .filter((o) => (statusFilter === 'todas' ? true : o.status === statusFilter))
      .filter((o) => (urgentOnly ? o.prioridad === 'URGENTE' : true))
      .filter((o) => {
        if (term.length === 0) return true;
        const hay = norm(
          `${o.pieza} ${o.numeroParte} ${o.soNumber} ${o.poNumber} ${o.deliveredToTornero ?? ''}`,
        );
        return hay.includes(term);
      })
      .sort((a, b) => {
        if (a.prioridad !== b.prioridad) return a.prioridad === 'URGENTE' ? -1 : 1;
        return (b.createdAtUTC ?? '').localeCompare(a.createdAtUTC ?? '');
      });
  }, [orders, search, statusFilter, showArchived, urgentOnly]);

  const pendientes = useMemo(
    () => orders.filter((o) => !o.archived && o.status === 'pendiente').length,
    [orders],
  );

  const setBusy = (id: string, label: string) => setRowBusy((p) => ({ ...p, [id]: label }));
  const clearBusy = (id: string) => setRowBusy((p) => { const n = { ...p }; delete n[id]; return n; });

  const handleDeliver = useCallback(async (order: WorkOrder, torneroName: string) => {
    setBusy(order.id, 'Guardando');
    const res = await markDelivered(order.id, torneroName);
    clearBusy(order.id);
    if (res.ok === false) {
      setErrorMessage(
        res.reason === 'not-authenticated'
          ? 'Inicia sesión para registrar la entrega (queda con tu usuario y fecha del servidor).'
          : 'No fue posible registrar la entrega. Reintenta.',
      );
      return;
    }
    setOrders((prev) => prev.map((o) => (
      o.id === order.id
        ? { ...o, status: 'entregada', deliveredToTornero: torneroName, deliveredAtUTC: new Date().toISOString() }
        : o
    )));
  }, []);

  const handleUndo = useCallback(async (order: WorkOrder) => {
    setBusy(order.id, 'Revirtiendo');
    const res = await markPending(order.id);
    clearBusy(order.id);
    if (res.ok === false) { setErrorMessage('No fue posible revertir la entrega.'); return; }
    setOrders((prev) => prev.map((o) => (
      o.id === order.id
        ? { ...o, status: 'pendiente', deliveredToTornero: null, deliveredAtUTC: null }
        : o
    )));
  }, []);

  const handleArchive = useCallback(async (order: WorkOrder) => {
    setBusy(order.id, 'Archivando');
    const res = await archiveWorkOrder(order.id, !order.archived);
    clearBusy(order.id);
    if (res.ok === false) { setErrorMessage('No fue posible archivar.'); return; }
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, archived: !order.archived } : o)));
  }, []);

  const handlePrint = useCallback(async (order: WorkOrder) => {
    if (!order.matchedDrawingId) {
      setErrorMessage(`"${order.pieza}" no tiene plano emparejado en el catálogo.`);
      return;
    }
    setBusy(order.id, 'Abriendo plano');
    try {
      const drawing = await getDrawingById(order.matchedDrawingId);
      if (drawing.ok === false || !drawing.value.pdfUrl) {
        setErrorMessage('El plano emparejado no tiene PDF accesible (sube el plano a Storage o revisa el catálogo).');
        return;
      }
      const dataUrl = await fetchPdfAsDataUrl(drawing.value.pdfUrl);
      await openStampedPlanoOt(dataUrl, {
        soNumber: order.soNumber, cantidad: order.cantidad, fecha: order.otDate,
      });
    } catch (e) {
      console.warn('[smv-vision][work-orders] print falló', e);
      setErrorMessage('No fue posible abrir el plano-OT.');
    } finally {
      clearBusy(order.id);
    }
  }, []);

  const handleAddTornero = useCallback(async () => {
    const name = newTornero.trim();
    if (!name) return;
    const res = await addTornero(name);
    if (res.ok === false) { setErrorMessage('No fue posible agregar el tornero.'); return; }
    setNewTornero('');
    const t = await listTorneros();
    if (t.ok) setTorneros(t.value);
  }, [newTornero]);

  const handleToggleTornero = useCallback(async (t: Tornero) => {
    const res = await setTorneroActive(t.id, !t.active);
    if (res.ok === false) { setErrorMessage('No fue posible actualizar el tornero.'); return; }
    setTorneros((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: !t.active } : x)));
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[28px] font-black uppercase tracking-[-1px] mr-auto">
          Control de Órdenes
          <span className="ml-3 bg-accent text-bg px-2 py-0.5 text-[12px] align-middle">{pendientes} pendientes</span>
        </h2>
        <div className="flex items-center gap-2 border-2 border-ink px-2 py-1 bg-white">
          <Search size={14} className="text-ink/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pieza, parte, SO, PO, tornero…"
            className="bg-transparent outline-none text-[12px] font-mono w-64"
          />
        </div>
        <button
          type="button" onClick={() => void load()} disabled={status === 'loading'}
          className="border-2 border-ink bg-white px-3 py-2 text-[10px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40 flex items-center gap-1"
        >
          {status === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
          Refrescar
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(['pendiente', 'entregada', 'todas'] as const).map((f) => (
          <button
            key={f} type="button" onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border-2 border-ink transition-colors ${
              statusFilter === f ? 'bg-ink text-bg' : 'bg-white hover:bg-ink/10'
            }`}
          >
            {f}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider cursor-pointer">
          <input type="checkbox" checked={urgentOnly} onChange={(e) => setUrgentOnly(e.target.checked)} />
          Solo urgentes
        </label>
        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Ver archivadas
        </label>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2 border-2 border-accent bg-accent/10 px-3 py-2 text-[11px] font-mono text-accent" role="alert">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Torneros management */}
      <details className="border-2 border-ink bg-white">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-black uppercase tracking-wider hover:bg-ink hover:text-bg">
          Torneros ({activeTorneros.length} activos)
        </summary>
        <div className="border-t-2 border-ink p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={newTornero} onChange={(e) => setNewTornero(e.target.value)}
              placeholder="Nombre del tornero" className="grow border border-ink/40 px-2 py-1 text-[12px] font-mono outline-none"
            />
            <button type="button" onClick={() => void handleAddTornero()}
              className="border-2 border-ink bg-accent text-bg px-3 py-1 text-[10px] font-black uppercase flex items-center gap-1 hover:bg-ink">
              <Plus size={12} /> Agregar
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {torneros.map((t) => (
              <button key={t.id} type="button" onClick={() => void handleToggleTornero(t)}
                className={`px-2 py-1 text-[10px] font-black uppercase tracking-wider border-2 border-ink ${
                  t.active ? 'bg-ink text-bg' : 'bg-white text-ink/40 line-through'
                }`} title={t.active ? 'Click para desactivar' : 'Click para activar'}>
                {t.name}
              </button>
            ))}
            {torneros.length === 0 && <span className="text-[10px] font-mono text-ink/50">Aún no hay torneros. Agrega el primero.</span>}
          </div>
        </div>
      </details>

      {/* List */}
      {status === 'loading' && (
        <div className="text-[12px] font-mono text-ink/60 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Cargando órdenes…
        </div>
      )}
      {status === 'ready' && visible.length === 0 && (
        <div className="text-[12px] font-mono text-ink/60 border-2 border-dashed border-ink/30 p-6 text-center">
          No hay órdenes que coincidan. Sube una PO en "Generar Reporte" para empezar.
        </div>
      )}

      <div className="space-y-2">
        {visible.map((o) => {
          const busy = rowBusy[o.id];
          return (
            <div key={o.id}
              className={`border-2 border-ink bg-white p-3 shadow-[3px_3px_0px_rgba(0,0,0,1)] ${o.archived ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 grow">
                  <div className="flex items-center gap-2">
                    {o.prioridad === 'URGENTE' && (
                      <span className="bg-accent text-bg px-1.5 py-0.5 text-[9px] font-black uppercase">Urgente</span>
                    )}
                    <p className="text-[14px] font-black uppercase tracking-tight truncate" title={o.pieza}>{o.pieza}</p>
                  </div>
                  <p className="text-[10px] font-mono text-ink/60 mt-0.5">
                    PARTE: {o.numeroParte || '—'} · SO: {oneLine(o.soNumber) || '—'} · PO: {oneLine(o.poNumber) || '—'} · CANT: {oneLine(o.cantidad) || '—'} · FECHA: {oneLine(o.otDate) || '—'}
                  </p>
                  {o.status === 'entregada' ? (
                    <p className="text-[10px] font-mono text-green-700 mt-1 flex items-center gap-1">
                      <CheckCircle2 size={11} /> Entregada a <b>{o.deliveredToTornero}</b> · {fmtDate(o.deliveredAtUTC)}
                    </p>
                  ) : (
                    <p className="text-[10px] font-mono text-ink/50 mt-1">Pendiente de entregar</p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <button type="button" onClick={() => void handlePrint(o)} disabled={!!busy}
                    className="border-2 border-ink bg-white px-2 py-1 text-[9px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40 flex items-center gap-1">
                    <Printer size={11} /> Plano-OT
                  </button>

                  {o.status === 'pendiente' ? (
                    <select
                      defaultValue=""
                      disabled={!!busy || activeTorneros.length === 0}
                      onChange={(e) => { const v = e.target.value; if (v) void handleDeliver(o, v); e.currentTarget.value = ''; }}
                      className="border-2 border-ink bg-accent text-bg px-2 py-1 text-[9px] font-black uppercase disabled:opacity-40"
                      title={activeTorneros.length === 0 ? 'Agrega torneros primero' : 'Entregar a…'}
                    >
                      <option value="" disabled>{busy ?? 'Entregar a ▾'}</option>
                      {activeTorneros.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  ) : (
                    <button type="button" onClick={() => void handleUndo(o)} disabled={!!busy}
                      className="border-2 border-ink bg-white px-2 py-1 text-[9px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40">
                      Revertir
                    </button>
                  )}

                  <button type="button" onClick={() => void handleArchive(o)} disabled={!!busy}
                    className="text-ink/40 hover:text-ink text-[9px] font-black uppercase flex items-center gap-1">
                    <Archive size={10} /> {o.archived ? 'Desarchivar' : 'Archivar'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run lint
```
Expected: PASS, zero errors.

- [ ] **Step 3: Manual test**

`npm run dev` → "Control de Órdenes" tab. Add a tornero. Upload+analyze a PO in the other tab, return: orders appear as "Pendiente". Pick a tornero from "Entregar a ▾" → row flips to "Entregada a [name] · [fecha]". Click "Plano-OT" on a matched order → a new tab opens with the original blueprint stamped (top-left box: SO/CANT/FECHA). Filter Pendiente/Entregada/Todas and search work.

- [ ] **Step 4: Commit**

```bash
git add src/components/WorkOrdersPanel.tsx
git commit -m "feat(ui): Control de Órdenes panel (list, deliver, plano-OT, torneros)"
```

---

## Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run:
```bash
npm run lint
```
Expected: PASS, zero errors.

- [ ] **Step 2: Re-run pure verifications**

Run:
```bash
npx tsx scripts/verify/workOrdersDedupe.ts && npx tsx scripts/verify/workOrderValidators.ts
```
Expected: both print `TODO OK`.

- [ ] **Step 3: Production build**

Run:
```bash
npm run build
```
Expected: build succeeds (pdf-lib bundles fine).

- [ ] **Step 4: End-to-end manual checklist**

- [ ] Sign in (not bypass) so deliveries carry a uid.
- [ ] Upload a multi-page PO PDF → analysis completes → console shows upsert created N.
- [ ] Re-upload same PDF → upsert updated N, created 0 (no duplicates).
- [ ] Control tab: orders listed as Pendiente with correct SO/PO/CANT/FECHA.
- [ ] Add 2 torneros; deliver one order to each → flips to Entregada with name + server time.
- [ ] Reload page → delivery state persisted (proof survives).
- [ ] Plano-OT opens the full blueprint (with measurements) stamped SO·cantidad·fecha.
- [ ] Search by part/SO/PO/tornero returns the right rows.
- [ ] Report generator ("Generar Reporte") still works unchanged.

- [ ] **Step 5: Commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore(work-orders): final verification fixes"
```

---

## Notes for the implementer

- **No test runner exists** — do not add Jest/Vitest. Pure logic is checked via `tsx` scripts in `scripts/verify/`. Everything else is `tsc --noEmit` + manual browser checks.
- **Strict TS**: no `any`, no `@ts-ignore`. Match the existing result-type/validator style.
- **Firestore rules**: the wildcard already allows authenticated writes — no `firestore.rules` edit needed.
- **Auth**: deliveries require a signed-in user (uid is the proof). The DEV unauth bypass allows reads/upsert but `markDelivered` intentionally requires a real uid.
- **pdf-lib stamp position**: top-left corner box (title blocks are bottom-right). If a specific customer's blueprint has content top-left, adjust the `margin`/corner in `src/lib/planoOt.ts`.
