# Biblioteca: juegos, notas permanentes y presets — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la Biblioteca guarde relaciones de par/juego, notas permanentes por pieza y presets de impresión, e imprima cada pieza de un juego en su propia OT.

**Architecture:** Lógica pura y probada en `src/lib/` (juegos, notas, presets, armado de trabajos de impresión); capa Firestore con result-type siguiendo `src/lib/firebase/aliases.ts`; UI en componentes nuevos pequeños y cambios quirúrgicos en `ToolcribLibraryPanel` y `ToolcribPrintModal`. `findCompanionDrawings` gana un tercer parámetro (`sets`, por defecto los juegos activos en memoria), así el modal, el puente orden-plano y el lote respetan los juegos guardados sin cambiar sus llamadas.

**Tech Stack:** React 19 + TypeScript (sin `strictNullChecks`), Vitest, Firebase Firestore, pdf-lib (existente), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-29-biblioteca-juegos-notas-presets-design.md`

## Global Constraints

- Sin `strictNullChecks`: para ramificar un result-type usa `result.ok === false`, nunca `!result.ok`.
- Todas las funciones Firebase nuevas usan result-type y **nunca lanzan** (patrón de `src/lib/firebase/aliases.ts`).
- Límites: máximo 8 miembros por juego (`MAX_SET_MEMBERS`), mínimo 2; máximo 10 notas por pieza y 300 caracteres por nota; `cantidadPorJuego` entero entre 1 y 99.
- Una pieza pertenece a un solo juego guardado.
- El juego guardado siempre gana sobre `KNOWN_RULES`; las 4 reglas fijas siguen como respaldo.
- Presets solo en `localStorage`, clave `smv.printPresets.v1`, todo acceso en try/catch.
- Defecto de impresión de juegos: `juego: 'separadas'` (una impresión por pieza, sello y ficha completos).
- `firestore.rules`: bloques nuevos con `isSignedIn()` (excluye anónimos). No tocar el bloque del Dashboard (`company_configs` / `work_orders*`).
- Deploy de reglas: `firebase deploy --only firestore:rules --project smv-brain`, solo con autorización de Emiliano.
- **Commits: solo con autorización de Emiliano** (regla global). Los pasos "Commit" indican qué archivos y mensaje usar cuando la dé. Mensajes terminan con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Ejecutar pruebas con `npx vitest run <archivo>`; type-check con `npm run lint`.

## Review Focus

- Juego guardado cuyos hermanos ya no existen en el catálogo → devuelve `[]` (no cae a reglas fijas) y la impresión sigue con una sola pieza.
- Pieza movida de un juego a otro → el juego viejo pierde el miembro y se borra si queda con menos de 2.
- Documentos de Firestore mal formados (tipo inválido, miembros duplicados, `cantidadPorJuego` 0 o decimal) → se normalizan o se descartan, sin lanzar.
- `localStorage` roto o con JSON corrupto → presets de fábrica, sin lanzar.
- Cantidad con `cantidadPorJuego` > 1 (10 juegos × 2 = 20) y cantidad no entera/≤ 0 → no se imprime.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/toolcribSets.ts` (nuevo) | Tipos de juego, `normalizeSet`, búsqueda de juego guardado, `companionsFromSet`, cantidades, `reconcileSets`, almacén en memoria de juegos activos |
| `src/lib/toolcribSetSuggestions.ts` (nuevo) | `suggestSets` (agrupar por raíz de número de parte) |
| `src/lib/companionDrawings.ts` (mod) | 3er parámetro `sets`; `knownRuleGroupKey`; campo `cantidadPorJuego` en `CompanionInfo` |
| `src/lib/firebase/toolcribSets.ts` (nuevo) | `listSets`, `saveSet`, `deleteSet`, `ensureActiveSets` |
| `src/lib/partNotes.ts` (nuevo) | Tipos de nota, `normalizePartNotes`, `composeOtNotes`, `QUICK_NOTE_CHIPS`, `noteDocId` |
| `src/lib/firebase/partNotes.ts` (nuevo) | `listPartNotes`, `savePartNotes` |
| `src/lib/printPresets.ts` (nuevo) | Presets de fábrica + carga/guardado/borrado en `localStorage` |
| `src/lib/setPrintJobs.ts` (nuevo) | `buildSeparatePrintJobs`: un `{ piece, stamp }` por pieza del juego |
| `src/lib/planoOt.ts` (mod) | `PlanoOtSetItem` gana `customer?` y `cantidadPorJuego?` |
| `src/components/ToolcribSetModal.tsx` (nuevo) | Formulario "Vincular como juego" |
| `src/components/ToolcribSetSuggestions.tsx` (nuevo) | Bloque de sugerencias |
| `src/components/ToolcribNotesModal.tsx` (nuevo) | Editar notas permanentes de una pieza |
| `src/components/ToolcribLibraryPanel.tsx` (mod) | Cargar juegos y notas, insignia, filtro, botones en el menú de la fila |
| `src/components/ToolcribPrintModal.tsx` (mod) | Presets, notas permanentes, chips, impresión separada por pieza |
| `src/hooks/useBatchPrintOts.ts` (mod) | `await ensureActiveSets()` antes de resolver el lote |
| `firestore.rules` (mod) | Colecciones `toolcribSets` y `toolcribPartNotes` |
| `tests/firestore-rules.emulator.test.ts` (mod) | Pruebas de reglas nuevas |
| `src/lib/__tests__/toolcribSets.test.ts`, `toolcribSetSuggestions.test.ts`, `partNotes.test.ts`, `printPresets.test.ts`, `setPrintJobs.test.ts` (nuevos); `companionDrawings.test.ts` (mod) | Pruebas |
| `CLAUDE.md` / `AGENTS.md` (mod) | Tabla de colecciones y nota de deploy |

---

### Task 1: Lógica pura de juegos guardados

**Files:**
- Create: `src/lib/toolcribSets.ts`
- Test: `src/lib/__tests__/toolcribSets.test.ts`
- Modify: `src/lib/companionDrawings.ts:17-22` (agregar campo a `CompanionInfo`)

**Interfaces:**
- Produces (todo exportado desde `src/lib/toolcribSets.ts`):
  - `type ToolcribSetType = 'par' | 'hoja' | 'complemento' | 'variante'`
  - `interface ToolcribSetMember { partNumber: string; rol: string; orden: number; cantidadPorJuego: number }`
  - `interface ToolcribSet { id: string; nombre: string; tipo: ToolcribSetType; miembros: ToolcribSetMember[] }`
  - `const MAX_SET_MEMBERS = 8`
  - `normalizeSet(raw: unknown): ToolcribSet | null`
  - `setPartKey(partNumber: string): string` (canónico en mayúsculas)
  - `findSavedSetForPart(partNumber: string, sets: readonly ToolcribSet[]): ToolcribSet | null`
  - `companionsFromSet(base: ToolcribActiveDrawingView | string, library: readonly ToolcribActiveDrawingView[], sets: readonly ToolcribSet[]): CompanionInfo[] | null`
  - `baseQuantityFactor(partNumber: string, sets: readonly ToolcribSet[]): number`
  - `quantityForMember(juegos: number, cantidadPorJuego: number): number`
  - `reconcileSets(existing: readonly ToolcribSet[], saved: ToolcribSet): { toDelete: string[]; toUpdate: ToolcribSet[] }`
  - `setActiveSets(sets: readonly ToolcribSet[]): void`, `getActiveSets(): readonly ToolcribSet[]`

- [ ] **Step 1: Agregar `cantidadPorJuego` a `CompanionInfo`**

En `src/lib/companionDrawings.ts`, cambia la interfaz:

```ts
export interface CompanionInfo {
  drawing: ToolcribActiveDrawingView;
  type: CompanionType;
  label: string;
  order: number;
  /** Piezas de este plano por cada juego pedido (solo juegos guardados; por defecto 1). */
  cantidadPorJuego?: number;
}
```

- [ ] **Step 2: Escribir la prueba que falla**

Crea `src/lib/__tests__/toolcribSets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ToolcribActiveDrawingView } from '../../types';
import {
  baseQuantityFactor,
  companionsFromSet,
  findSavedSetForPart,
  getActiveSets,
  normalizeSet,
  quantityForMember,
  reconcileSets,
  setActiveSets,
  type ToolcribSet,
} from '../toolcribSets';

function makeView(partNumber: string, extra: Partial<ToolcribActiveDrawingView> = {}): ToolcribActiveDrawingView {
  return {
    drawingId: `id_${partNumber}`,
    partId: `part_${partNumber}`,
    partNumber,
    revision: '1',
    pdfUrl: `https://storage.mock/${partNumber}.pdf`,
    sourcePath: `${partNumber}.pdf`,
    customer: 'SUPRAJIT',
    description: '',
    sourceType: 'storage',
    stlUrl: null,
    effectiveFromUTC: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

const par: ToolcribSet = {
  id: 's1',
  nombre: 'Hex Swage Block',
  tipo: 'par',
  miembros: [
    { partNumber: '1012-05-CHICO', rol: 'Mitad Chica', orden: 1, cantidadPorJuego: 1 },
    { partNumber: '1012-05-GRANDE', rol: 'Mitad Grande', orden: 2, cantidadPorJuego: 2 },
  ],
};

describe('toolcribSets — búsqueda y compañeros', () => {
  it('encuentra el juego sin importar mayúsculas ni sufijo .ISO', () => {
    expect(findSavedSetForPart('1012-05-chico', [par])?.id).toBe('s1');
    expect(findSavedSetForPart('1012-05-GRANDE.ISO', [par])?.id).toBe('s1');
    expect(findSavedSetForPart('OTRA-PIEZA', [par])).toBeNull();
  });

  it('devuelve null si la pieza no está en ningún juego guardado', () => {
    expect(companionsFromSet('OTRA-PIEZA', [makeView('OTRA-PIEZA')], [par])).toBeNull();
  });

  it('devuelve los hermanos del juego con rol, orden y cantidad por juego', () => {
    const library = [makeView('1012-05-CHICO'), makeView('1012-05-GRANDE'), makeView('1012-05-GRANDE.ISO')];
    const companions = companionsFromSet('1012-05-CHICO', library, [par]);
    expect(companions).toHaveLength(1);
    expect(companions[0].drawing.partNumber).toBe('1012-05-GRANDE');
    expect(companions[0].label).toBe('Mitad Grande');
    expect(companions[0].type).toBe('pair');
    expect(companions[0].order).toBe(2);
    expect(companions[0].cantidadPorJuego).toBe(2);
  });

  it('con juego guardado pero hermano ausente del catálogo devuelve [] (no cae a reglas)', () => {
    expect(companionsFromSet('1012-05-CHICO', [makeView('1012-05-CHICO')], [par])).toEqual([]);
  });

  it('factor de cantidad de la pieza base (1 si no hay juego)', () => {
    expect(baseQuantityFactor('1012-05-GRANDE', [par])).toBe(2);
    expect(baseQuantityFactor('NADA', [par])).toBe(1);
  });

  it('cantidad = juegos × cantidad por juego, entera', () => {
    expect(quantityForMember(10, 2)).toBe(20);
    expect(quantityForMember(3, 1)).toBe(3);
  });

  it('almacén en memoria de juegos activos', () => {
    setActiveSets([par]);
    expect(getActiveSets()).toHaveLength(1);
    setActiveSets([]);
    expect(getActiveSets()).toHaveLength(0);
  });
});

describe('toolcribSets — normalizeSet', () => {
  const valid = {
    id: 'a',
    nombre: 'Juego',
    tipo: 'par',
    miembros: [
      { partNumber: 'x-1', rol: 'A', orden: 1, cantidadPorJuego: 1 },
      { partNumber: 'x-2', rol: 'B', orden: 2, cantidadPorJuego: 1 },
    ],
  };

  it('acepta un documento válido y canoniza los números de parte', () => {
    const set = normalizeSet(valid);
    expect(set?.miembros.map((m) => m.partNumber)).toEqual(['X-1', 'X-2']);
  });

  it('rechaza tipo inválido, menos de 2 miembros, duplicados y más de 8', () => {
    expect(normalizeSet({ ...valid, tipo: 'otro' })).toBeNull();
    expect(normalizeSet({ ...valid, miembros: [valid.miembros[0]] })).toBeNull();
    expect(normalizeSet({ ...valid, miembros: [valid.miembros[0], valid.miembros[0]] })).toBeNull();
    const nine = Array.from({ length: 9 }, (_, i) => ({ partNumber: `p-${i}`, rol: 'r', orden: i + 1, cantidadPorJuego: 1 }));
    expect(normalizeSet({ ...valid, miembros: nine })).toBeNull();
    expect(normalizeSet(null)).toBeNull();
  });

  it('cantidadPorJuego 0, negativa o decimal se reemplaza por 1', () => {
    const set = normalizeSet({
      ...valid,
      miembros: [
        { partNumber: 'x-1', rol: 'A', orden: 1, cantidadPorJuego: 0 },
        { partNumber: 'x-2', rol: 'B', orden: 2, cantidadPorJuego: 1.5 },
      ],
    });
    expect(set?.miembros.map((m) => m.cantidadPorJuego)).toEqual([1, 1]);
  });
});

describe('toolcribSets — reconcileSets (una pieza, un juego)', () => {
  const mk = (id: string, parts: string[]): ToolcribSet => ({
    id,
    nombre: id,
    tipo: 'par',
    miembros: parts.map((p, i) => ({ partNumber: p, rol: p, orden: i + 1, cantidadPorJuego: 1 })),
  });

  it('borra el juego viejo si queda con menos de 2 miembros', () => {
    const result = reconcileSets([mk('A', ['X', 'Y', 'Z'])], mk('B', ['Y', 'Z']));
    expect(result.toDelete).toEqual(['A']);
    expect(result.toUpdate).toEqual([]);
  });

  it('actualiza el juego viejo si aún le quedan 2 o más', () => {
    const result = reconcileSets([mk('A', ['X', 'Y', 'Z', 'W'])], mk('B', ['Y', 'Z']));
    expect(result.toDelete).toEqual([]);
    expect(result.toUpdate[0].miembros.map((m) => m.partNumber)).toEqual(['X', 'W']);
  });

  it('ignora el propio juego guardado y los juegos sin traslape', () => {
    const result = reconcileSets([mk('B', ['Y', 'Z']), mk('C', ['P', 'Q'])], mk('B', ['Y', 'Z']));
    expect(result).toEqual({ toDelete: [], toUpdate: [] });
  });
});
```

- [ ] **Step 3: Correr la prueba y ver que falla**

Run: `npx vitest run src/lib/__tests__/toolcribSets.test.ts`
Expected: FAIL (`Cannot find module '../toolcribSets'`).

- [ ] **Step 4: Implementar `src/lib/toolcribSets.ts`**

```ts
/**
 * Juegos (pares, hojas, complementos) guardados por el operador.
 * Lógica pura: sin Firebase ni React. Ver src/lib/firebase/toolcribSets.ts para la persistencia.
 */

import type { ToolcribActiveDrawingView } from '../types';
import type { CompanionInfo, CompanionType } from './companionDrawings';
import { isIsoDrawingView } from './matching';
import { canonicalPartNumber } from './toolcribCatalog';

export type ToolcribSetType = 'par' | 'hoja' | 'complemento' | 'variante';

export interface ToolcribSetMember {
  partNumber: string;
  rol: string;
  orden: number;
  cantidadPorJuego: number;
}

export interface ToolcribSet {
  id: string;
  nombre: string;
  tipo: ToolcribSetType;
  miembros: ToolcribSetMember[];
}

export const MAX_SET_MEMBERS = 8;
const SET_TYPES: readonly ToolcribSetType[] = ['par', 'hoja', 'complemento', 'variante'];
const TYPE_MAP: Record<ToolcribSetType, CompanionType> = {
  par: 'pair',
  hoja: 'sheet',
  complemento: 'complement',
  variante: 'variant',
};

export function setPartKey(partNumber: string): string {
  return canonicalPartNumber(partNumber).trim();
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Valida un documento de Firestore; null si no se puede rescatar. */
export function normalizeSet(raw: unknown): ToolcribSet | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const id = asString(data.id);
  const nombre = asString(data.nombre).slice(0, 100);
  const tipo = data.tipo as ToolcribSetType;
  if (!id || !nombre || !SET_TYPES.includes(tipo)) return null;
  if (!Array.isArray(data.miembros)) return null;
  if (data.miembros.length < 2 || data.miembros.length > MAX_SET_MEMBERS) return null;

  const seen = new Set<string>();
  const miembros: ToolcribSetMember[] = [];
  for (const item of data.miembros) {
    if (!item || typeof item !== 'object') return null;
    const m = item as Record<string, unknown>;
    const partNumber = setPartKey(asString(m.partNumber));
    if (!partNumber || seen.has(partNumber)) return null;
    seen.add(partNumber);
    const cantidad = typeof m.cantidadPorJuego === 'number' ? m.cantidadPorJuego : 1;
    miembros.push({
      partNumber,
      rol: asString(m.rol).slice(0, 60),
      orden: Number.isFinite(m.orden) ? Number(m.orden) : miembros.length + 1,
      cantidadPorJuego: Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= 99 ? cantidad : 1,
    });
  }
  return { id, nombre, tipo, miembros };
}

export function findSavedSetForPart(partNumber: string, sets: readonly ToolcribSet[]): ToolcribSet | null {
  const key = setPartKey(partNumber);
  return sets.find((set) => set.miembros.some((m) => m.partNumber === key)) ?? null;
}

/**
 * Compañeros de `base` según un juego guardado.
 * `null` = la pieza no está en ningún juego guardado (el llamador usa las reglas fijas).
 * `[]` = está en un juego, pero sus hermanos no están en el catálogo.
 */
export function companionsFromSet(
  base: ToolcribActiveDrawingView | string,
  library: readonly ToolcribActiveDrawingView[],
  sets: readonly ToolcribSet[],
): CompanionInfo[] | null {
  const basePart = typeof base === 'string' ? base : base.partNumber;
  const set = findSavedSetForPart(basePart, sets);
  if (!set) return null;

  const baseKey = setPartKey(basePart);
  const companions: CompanionInfo[] = [];
  for (const member of set.miembros) {
    if (member.partNumber === baseKey) continue;
    const view = library.find(
      (candidate) => !isIsoDrawingView(candidate) && setPartKey(candidate.partNumber) === member.partNumber,
    );
    if (!view) continue;
    companions.push({
      drawing: view,
      type: TYPE_MAP[set.tipo],
      label: member.rol || member.partNumber,
      order: member.orden,
      cantidadPorJuego: member.cantidadPorJuego,
    });
  }
  companions.sort((a, b) => a.order - b.order || a.drawing.partNumber.localeCompare(b.drawing.partNumber));
  return companions;
}

export function baseQuantityFactor(partNumber: string, sets: readonly ToolcribSet[]): number {
  const set = findSavedSetForPart(partNumber, sets);
  const key = setPartKey(partNumber);
  return set?.miembros.find((m) => m.partNumber === key)?.cantidadPorJuego ?? 1;
}

export function quantityForMember(juegos: number, cantidadPorJuego: number): number {
  return Math.round(juegos * cantidadPorJuego);
}

/**
 * Al guardar `saved`, quita sus piezas de los demás juegos (una pieza, un juego).
 * Juegos que quedan con menos de 2 miembros se borran; el resto se actualiza.
 */
export function reconcileSets(
  existing: readonly ToolcribSet[],
  saved: ToolcribSet,
): { toDelete: string[]; toUpdate: ToolcribSet[] } {
  const taken = new Set(saved.miembros.map((m) => m.partNumber));
  const toDelete: string[] = [];
  const toUpdate: ToolcribSet[] = [];
  for (const set of existing) {
    if (set.id === saved.id) continue;
    if (!set.miembros.some((m) => taken.has(m.partNumber))) continue;
    const remaining = set.miembros.filter((m) => !taken.has(m.partNumber));
    if (remaining.length < 2) toDelete.push(set.id);
    else toUpdate.push({ ...set, miembros: remaining });
  }
  return { toDelete, toUpdate };
}

let activeSets: readonly ToolcribSet[] = [];
export function setActiveSets(sets: readonly ToolcribSet[]): void {
  activeSets = sets;
}
export function getActiveSets(): readonly ToolcribSet[] {
  return activeSets;
}
```

- [ ] **Step 5: Correr la prueba y ver que pasa**

Run: `npx vitest run src/lib/__tests__/toolcribSets.test.ts`
Expected: PASS (todas).

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 7: Commit (solo con autorización)**

```bash
git add src/lib/toolcribSets.ts src/lib/__tests__/toolcribSets.test.ts src/lib/companionDrawings.ts
git commit -m "feat(biblioteca): logica pura de juegos guardados"
```

---

### Task 2: `findCompanionDrawings` respeta los juegos guardados

**Files:**
- Modify: `src/lib/companionDrawings.ts` (imports, firma de `findCompanionDrawings`, nueva `knownRuleGroupKey`)
- Test: `src/lib/__tests__/companionDrawings.test.ts`

**Interfaces:**
- Consumes: `companionsFromSet`, `getActiveSets`, `ToolcribSet` de `./toolcribSets`.
- Produces:
  - `findCompanionDrawings(base, library, sets?: readonly ToolcribSet[])` — por defecto `getActiveSets()`.
  - `knownRuleGroupKey(partNumber: string): string | null` — `groupKey` de la regla fija que aplica, o `null`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agrega al final de `src/lib/__tests__/companionDrawings.test.ts` (y agrega `knownRuleGroupKey` al import de `../companionDrawings`; agrega `import type { ToolcribSet } from '../toolcribSets';`):

```ts
describe('companionDrawings — juegos guardados y reglas fijas', () => {
  const library = [
    makeView({ partNumber: 'ZZ-100-IZQ' }),
    makeView({ partNumber: 'ZZ-100-DER' }),
    makeView({ partNumber: '1012-05-CHICO' }),
    makeView({ partNumber: '1012-05-GRANDE' }),
  ];
  const saved: ToolcribSet = {
    id: 's',
    nombre: 'ZZ',
    tipo: 'par',
    miembros: [
      { partNumber: 'ZZ-100-IZQ', rol: 'Izquierda', orden: 1, cantidadPorJuego: 1 },
      { partNumber: 'ZZ-100-DER', rol: 'Derecha', orden: 2, cantidadPorJuego: 1 },
    ],
  };

  it('un juego guardado aporta compañeros que ninguna regla fija conoce', () => {
    const result = findCompanionDrawings('ZZ-100-IZQ', library, [saved]);
    expect(result.map((c) => c.label)).toEqual(['Derecha']);
  });

  it('sin juegos guardados se usan las reglas fijas como antes', () => {
    const result = findCompanionDrawings('1012-05-CHICO', library, []);
    expect(result.some((c) => c.drawing.partNumber === '1012-05-GRANDE')).toBe(true);
  });

  it('el guardado gana sobre la regla fija', () => {
    const override: ToolcribSet = {
      id: 'o',
      nombre: 'Override',
      tipo: 'complemento',
      miembros: [
        { partNumber: '1012-05-CHICO', rol: 'Base', orden: 1, cantidadPorJuego: 1 },
        { partNumber: 'ZZ-100-DER', rol: 'Extra', orden: 2, cantidadPorJuego: 1 },
      ],
    };
    const result = findCompanionDrawings('1012-05-CHICO', library, [override]);
    expect(result.map((c) => c.drawing.partNumber)).toEqual(['ZZ-100-DER']);
  });

  it('knownRuleGroupKey identifica las piezas de reglas fijas', () => {
    expect(knownRuleGroupKey('1012-05-CHICO')).toBe('90-1012-05');
    expect(knownRuleGroupKey('90-4150-06 -A')).toBe('90-4150-06');
    expect(knownRuleGroupKey('ZZ-100-IZQ')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/__tests__/companionDrawings.test.ts`
Expected: FAIL (`knownRuleGroupKey` no exportada / tercer parámetro ignorado).

- [ ] **Step 3: Implementar**

En `src/lib/companionDrawings.ts`, agrega el import:

```ts
import { companionsFromSet, getActiveSets, type ToolcribSet } from './toolcribSets';
```

Cambia la firma y el arranque de `findCompanionDrawings`:

```ts
export function findCompanionDrawings(
  base: ToolcribActiveDrawingView | string,
  library: readonly ToolcribActiveDrawingView[],
  sets: readonly ToolcribSet[] = getActiveSets(),
): CompanionInfo[] {
  // 0. Un juego guardado por el operador siempre gana sobre las reglas fijas.
  const saved = companionsFromSet(base, library, sets);
  if (saved) return saved;

  const basePart = typeof base === 'string' ? base : base.partNumber;
```

(Elimina la línea original `const basePart = ...` que quedaba justo después de la firma para no duplicarla.)

Agrega, debajo de `KNOWN_RULES`:

```ts
/** groupKey de la regla fija que aplica a la pieza (O(4)); sirve para la insignia de la Biblioteca. */
export function knownRuleGroupKey(partNumber: string): string | null {
  const canonical = canonicalPartNumber(partNumber).toUpperCase().trim();
  return KNOWN_RULES.find((rule) => rule.match.test(canonical))?.groupKey ?? null;
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run src/lib/__tests__/companionDrawings.test.ts src/lib/__tests__/toolcribSets.test.ts src/lib/__tests__/orderDrawingBridge.test.ts`
Expected: PASS (los tests existentes de compañeros y del puente siguen verdes).

- [ ] **Step 5: Type-check y commit (solo con autorización)**

Run: `npm run lint` → sin errores.

```bash
git add src/lib/companionDrawings.ts src/lib/__tests__/companionDrawings.test.ts
git commit -m "feat(biblioteca): findCompanionDrawings usa juegos guardados"
```

---

### Task 3: Persistencia de juegos y reglas de Firestore

**Files:**
- Create: `src/lib/firebase/toolcribSets.ts`
- Modify: `firestore.rules` (después del bloque `partAliases`, línea ~90)
- Modify: `tests/firestore-rules.emulator.test.ts`

**Interfaces:**
- Consumes: `normalizeSet`, `reconcileSets`, `setActiveSets`, `ToolcribSet` de `../toolcribSets`; `getFirestoreClient` de `./client`; `getCurrentUserUid` de `./auth`; `isToolcribDebugUnauthAllowed` de `./env`; `log` de `../log`.
- Produces:
  - `type SetFailureReason = 'not-configured' | 'not-authenticated' | 'invalid-input' | 'read-failed' | 'write-failed'`
  - `type SetResult<T> = { ok: true; value: T } | { ok: false; reason: SetFailureReason }`
  - `listSets(): Promise<SetResult<ToolcribSet[]>>`
  - `saveSet(input: { id?: string; nombre: string; tipo: ToolcribSetType; miembros: ToolcribSetMember[] }): Promise<SetResult<{ id: string }>>`
  - `deleteSet(id: string): Promise<SetResult<true>>`
  - `ensureActiveSets(force?: boolean): Promise<readonly ToolcribSet[]>` — carga con caché de 60 s y actualiza el almacén en memoria; nunca lanza (si falla devuelve lo que hubiera en memoria).

- [ ] **Step 1: Escribir la prueba de reglas que falla**

En `tests/firestore-rules.emulator.test.ts`, dentro del `it("un anónimo no crea, edita ni borra compras", ...)` agrega estas dos líneas debajo de la de `partAliases`:

```ts
    await assertFails(anonimo().doc("toolcribSets/s-1").set({ nombre: "X" }))
    await assertFails(anonimo().doc("toolcribPartNotes/N-1").set({ notas: [] }))
```

Y dentro de `it("un usuario real de Vision sigue trabajando igual", ...)` agrega:

```ts
    await assertSucceeds(usuario().doc("toolcribSets/s-1").set({ nombre: "Juego" }))
    await assertSucceeds(usuario().doc("toolcribSets/s-1").get())
    await assertSucceeds(usuario().doc("toolcribPartNotes/N-1").set({ notas: [] }))
    await assertSucceeds(usuario().doc("toolcribPartNotes/N-1").delete())
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm run test:rules` (necesita Java en el PATH)
Expected: FAIL (el usuario real no puede escribir en las colecciones nuevas: cae en el catch-all `deny`).

- [ ] **Step 3: Agregar las reglas**

En `firestore.rules`, después del bloque `partAliases`:

```
    // ── Juegos (pares/hojas/complementos) y notas permanentes por pieza ───
    match /toolcribSets/{setId} {
      allow read, create, update, delete: if isSignedIn();
    }
    match /toolcribPartNotes/{noteId} {
      allow read, create, update, delete: if isSignedIn();
    }
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm run test:rules`
Expected: PASS (incluye el test "desplegar las reglas de Vision no rompe al Dashboard").

- [ ] **Step 5: Implementar `src/lib/firebase/toolcribSets.ts`**

```ts
/**
 * Juegos (pares/hojas/complementos) en Firestore (colección `toolcribSets`).
 * Contrato de resultado: nunca lanza excepciones.
 */

import { collection, doc, getDocs, limit, query, serverTimestamp, writeBatch } from 'firebase/firestore';

import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
import { log } from '../log';
import {
  getActiveSets,
  normalizeSet,
  reconcileSets,
  setActiveSets,
  type ToolcribSet,
  type ToolcribSetMember,
  type ToolcribSetType,
} from '../toolcribSets';

export const TOOLCRIB_SETS_COLLECTION = 'toolcribSets';
const CACHE_TTL_MS = 60_000;

export type SetFailureReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'invalid-input'
  | 'read-failed'
  | 'write-failed';

export type SetResult<T> = { ok: true; value: T } | { ok: false; reason: SetFailureReason };

function isAuthed(): boolean {
  return getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();
}

export async function listSets(): Promise<SetResult<ToolcribSet[]>> {
  const db = getFirestoreClient();
  if (!db) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };
  try {
    const snap = await getDocs(query(collection(db, TOOLCRIB_SETS_COLLECTION), limit(500)));
    const sets: ToolcribSet[] = [];
    snap.forEach((d) => {
      const set = normalizeSet({ ...(d.data() as Record<string, unknown>), id: d.id });
      if (set) sets.push(set);
    });
    return { ok: true, value: sets };
  } catch (error) {
    log.warn('[smv-vision][toolcribSets] listSets falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

let lastLoadAt = 0;
let inflight: Promise<readonly ToolcribSet[]> | null = null;

/** Carga los juegos al almacén en memoria (caché de 60 s). Nunca lanza. */
export function ensureActiveSets(force = false): Promise<readonly ToolcribSet[]> {
  if (!force && Date.now() - lastLoadAt < CACHE_TTL_MS) return Promise.resolve(getActiveSets());
  if (inflight) return inflight;
  inflight = listSets()
    .then((res) => {
      if (res.ok === true) {
        setActiveSets(res.value);
        lastLoadAt = Date.now();
      }
      return getActiveSets();
    })
    .catch(() => getActiveSets())
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function saveSet(input: {
  id?: string;
  nombre: string;
  tipo: ToolcribSetType;
  miembros: ToolcribSetMember[];
}): Promise<SetResult<{ id: string }>> {
  const db = getFirestoreClient();
  if (!db) return { ok: false, reason: 'not-configured' };
  const uid = getCurrentUserUid();
  if (!uid && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };

  const id = input.id?.trim() || doc(collection(db, TOOLCRIB_SETS_COLLECTION)).id;
  const candidate = normalizeSet({ ...input, id });
  if (!candidate) return { ok: false, reason: 'invalid-input' };

  const existing = await listSets();
  if (existing.ok === false) return { ok: false, reason: existing.reason };
  const { toDelete, toUpdate } = reconcileSets(existing.value, candidate);

  try {
    const batch = writeBatch(db);
    batch.set(
      doc(db, TOOLCRIB_SETS_COLLECTION, id),
      {
        nombre: candidate.nombre,
        tipo: candidate.tipo,
        miembros: candidate.miembros,
        updatedByUid: uid ?? 'debug',
        updatedAtUTC: serverTimestamp(),
      },
      { merge: true },
    );
    for (const other of toUpdate) {
      batch.set(
        doc(db, TOOLCRIB_SETS_COLLECTION, other.id),
        { miembros: other.miembros, updatedAtUTC: serverTimestamp() },
        { merge: true },
      );
    }
    for (const otherId of toDelete) batch.delete(doc(db, TOOLCRIB_SETS_COLLECTION, otherId));
    await batch.commit();
    await ensureActiveSets(true);
    return { ok: true, value: { id } };
  } catch (error) {
    log.warn('[smv-vision][toolcribSets] saveSet falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}

export async function deleteSet(id: string): Promise<SetResult<true>> {
  const db = getFirestoreClient();
  if (!db) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };
  if (!id.trim()) return { ok: false, reason: 'invalid-input' };
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, TOOLCRIB_SETS_COLLECTION, id));
    await batch.commit();
    await ensureActiveSets(true);
    return { ok: true, value: true };
  } catch (error) {
    log.warn('[smv-vision][toolcribSets] deleteSet falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}
```

- [ ] **Step 6: Type-check y commit (solo con autorización)**

Run: `npm run lint` → sin errores.

```bash
git add src/lib/firebase/toolcribSets.ts firestore.rules tests/firestore-rules.emulator.test.ts
git commit -m "feat(biblioteca): persistencia de juegos y reglas de firestore"
```

---

### Task 4: Sugerencias de juegos (lógica pura)

**Files:**
- Create: `src/lib/toolcribSetSuggestions.ts`
- Test: `src/lib/__tests__/toolcribSetSuggestions.test.ts`

**Interfaces:**
- Consumes: `extractBasePartRoot` de `./companionDrawings`; `isIsoDrawingView` de `./matching`; `findSavedSetForPart`, `setPartKey`, `ToolcribSet` de `./toolcribSets`.
- Produces:
  - `interface SetSuggestion { root: string; partNumbers: string[] }`
  - `suggestSets(library: readonly ToolcribActiveDrawingView[], sets: readonly ToolcribSet[]): SetSuggestion[]`

- [ ] **Step 1: Escribir la prueba que falla**

```ts
import { describe, expect, it } from 'vitest';
import type { ToolcribActiveDrawingView } from '../../types';
import { suggestSets } from '../toolcribSetSuggestions';
import type { ToolcribSet } from '../toolcribSets';

function makeView(partNumber: string): ToolcribActiveDrawingView {
  return {
    drawingId: `id_${partNumber}`,
    partId: `part_${partNumber}`,
    partNumber,
    revision: '1',
    pdfUrl: `https://storage.mock/${partNumber}.pdf`,
    sourcePath: `${partNumber}.pdf`,
    customer: 'SUPRAJIT',
    description: '',
    sourceType: 'storage',
    stlUrl: null,
    effectiveFromUTC: '2026-01-01T00:00:00Z',
  };
}

describe('suggestSets', () => {
  const library = [
    makeView('1012-05-CHICO'),
    makeView('1012-05-GRANDE'),
    makeView('1012-05-GRANDE.ISO'),
    makeView('SOLA-777'),
    makeView('90-1012-06'),
    makeView('90-1012-06-2'),
  ];

  it('agrupa por raíz común, ignora ISO y piezas solas', () => {
    const result = suggestSets(library, []);
    expect(result.map((s) => s.root)).toEqual(['1012-05', '90-1012-06']);
    expect(result[0].partNumbers).toEqual(['1012-05-CHICO', '1012-05-GRANDE']);
  });

  it('omite grupos donde alguna pieza ya está en un juego guardado', () => {
    const saved: ToolcribSet = {
      id: 's',
      nombre: 'x',
      tipo: 'par',
      miembros: [
        { partNumber: '1012-05-CHICO', rol: 'a', orden: 1, cantidadPorJuego: 1 },
        { partNumber: '1012-05-GRANDE', rol: 'b', orden: 2, cantidadPorJuego: 1 },
      ],
    };
    expect(suggestSets(library, [saved]).map((s) => s.root)).toEqual(['90-1012-06']);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/__tests__/toolcribSetSuggestions.test.ts`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implementar**

```ts
import type { ToolcribActiveDrawingView } from '../types';
import { extractBasePartRoot } from './companionDrawings';
import { isIsoDrawingView } from './matching';
import { findSavedSetForPart, setPartKey, type ToolcribSet } from './toolcribSets';

export interface SetSuggestion {
  root: string;
  partNumbers: string[];
}

/** Candidatos a juego: piezas CAD con la misma raíz de número de parte y aún sin juego guardado. */
export function suggestSets(
  library: readonly ToolcribActiveDrawingView[],
  sets: readonly ToolcribSet[],
): SetSuggestion[] {
  const groups = new Map<string, Set<string>>();
  for (const view of library) {
    if (isIsoDrawingView(view)) continue;
    const root = extractBasePartRoot(view.partNumber);
    if (!root || root.length < 4) continue;
    const bucket = groups.get(root) ?? new Set<string>();
    bucket.add(setPartKey(view.partNumber));
    groups.set(root, bucket);
  }

  const suggestions: SetSuggestion[] = [];
  for (const [root, parts] of groups) {
    if (parts.size < 2) continue;
    const partNumbers = [...parts].sort((a, b) => a.localeCompare(b));
    if (partNumbers.some((part) => findSavedSetForPart(part, sets))) continue;
    suggestions.push({ root, partNumbers });
  }
  return suggestions.sort((a, b) => a.root.localeCompare(b.root));
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run src/lib/__tests__/toolcribSetSuggestions.test.ts`
Expected: PASS. Si el orden de `partNumbers` en el primer test no coincide, ajusta solo la expectativa al orden alfabético real (`'1012-05-CHICO'` < `'1012-05-GRANDE'`).

- [ ] **Step 5: Commit (solo con autorización)**

```bash
git add src/lib/toolcribSetSuggestions.ts src/lib/__tests__/toolcribSetSuggestions.test.ts
git commit -m "feat(biblioteca): sugerencias de juegos por raiz de numero de parte"
```

---

### Task 5: UI de juegos en la Biblioteca (insignia, filtro, vincular, sugerencias)

**Files:**
- Create: `src/components/ToolcribSetModal.tsx`, `src/components/ToolcribSetSuggestions.tsx`
- Modify: `src/components/ToolcribLibraryPanel.tsx`

**Interfaces:**
- Consumes: `ensureActiveSets`, `saveSet`, `deleteSet` (Task 3); `suggestSets` (Task 4); `findSavedSetForPart`, `setPartKey`, `MAX_SET_MEMBERS`, tipos (Task 1); `knownRuleGroupKey` (Task 2).
- Produces:
  - `ToolcribSetModal({ open, initialMembers, initialSet, catalogParts, onClose, onSaved })` donde `initialMembers: string[]`, `initialSet: ToolcribSet | null`, `catalogParts: string[]`, `onSaved: () => void`.
  - `ToolcribSetSuggestions({ suggestions, onAccept, onDismiss })`.

- [ ] **Step 1: Crear `src/components/ToolcribSetModal.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { deleteSet, saveSet } from '../lib/firebase/toolcribSets';
import { MAX_SET_MEMBERS, setPartKey, type ToolcribSet, type ToolcribSetMember, type ToolcribSetType } from '../lib/toolcribSets';

const TYPE_LABELS: Record<ToolcribSetType, string> = {
  par: 'Par (piezas distintas que se piden juntas)',
  hoja: 'Hojas de un mismo plano',
  complemento: 'Complemento',
  variante: 'Variante',
};

export interface ToolcribSetModalProps {
  open: boolean;
  /** Números de parte precargados (sugerencia o pieza desde la que se abrió). */
  initialMembers: string[];
  /** Juego existente que se edita; null = juego nuevo. */
  initialSet: ToolcribSet | null;
  /** Números de parte del catálogo, para elegir hermanos. */
  catalogParts: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function ToolcribSetModal({ open, initialMembers, initialSet, catalogParts, onClose, onSaved }: ToolcribSetModalProps) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<ToolcribSetType>('par');
  const [miembros, setMiembros] = useState<ToolcribSetMember[]>([]);
  const [nuevo, setNuevo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNuevo('');
    if (initialSet) {
      setNombre(initialSet.nombre);
      setTipo(initialSet.tipo);
      setMiembros(initialSet.miembros.map((m) => ({ ...m })));
    } else {
      setNombre(initialMembers[0] ?? '');
      setTipo('par');
      setMiembros(
        initialMembers.map((partNumber, index) => ({ partNumber: setPartKey(partNumber), rol: '', orden: index + 1, cantidadPorJuego: 1 })),
      );
    }
  }, [open, initialMembers, initialSet]);

  const update = (index: number, patch: Partial<ToolcribSetMember>) =>
    setMiembros((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  const addMember = () => {
    const key = setPartKey(nuevo);
    if (!key) return;
    if (miembros.some((m) => m.partNumber === key)) {
      setError('Esa pieza ya está en el juego.');
      return;
    }
    if (miembros.length >= MAX_SET_MEMBERS) {
      setError(`Máximo ${MAX_SET_MEMBERS} piezas por juego.`);
      return;
    }
    setError(null);
    setMiembros((prev) => [...prev, { partNumber: key, rol: '', orden: prev.length + 1, cantidadPorJuego: 1 }]);
    setNuevo('');
  };

  const handleSave = async () => {
    if (miembros.length < 2) {
      setError('Un juego necesita al menos 2 piezas.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await saveSet({
      id: initialSet?.id,
      nombre: nombre.trim() || miembros[0].partNumber,
      tipo,
      miembros: miembros.map((m, index) => ({ ...m, rol: m.rol.trim() || m.partNumber, orden: index + 1 })),
    });
    setBusy(false);
    if (res.ok === false) {
      setError(`No se pudo guardar el juego (${res.reason}).`);
      return;
    }
    onSaved();
    onClose();
  };

  const handleDelete = async () => {
    if (!initialSet) return;
    setBusy(true);
    const res = await deleteSet(initialSet.id);
    setBusy(false);
    if (res.ok === false) {
      setError(`No se pudo borrar el juego (${res.reason}).`);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg bg-surface border-2 border-line rounded-none text-ink">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest">
            {initialSet ? 'Editar juego' : 'Vincular como juego'}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-ink-dim">
            Piezas que se piden juntas. Al imprimir una, se ofrece imprimir las demás, cada una con su propia OT.
          </DialogDescription>
        </DialogHeader>

        {error && <p role="alert" className="border-2 border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger">{error}</p>}

        <div className="space-y-3">
          <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim">
            Nombre del juego
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={busy} className="mt-1 rounded-none border-2 border-line bg-surface-2 h-9 text-[12px] font-mono" />
          </label>

          <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim">
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as ToolcribSetType)} disabled={busy} className="mt-1 w-full h-9 border-2 border-line bg-surface-2 text-[12px] font-mono px-2 rounded-none">
              {(Object.keys(TYPE_LABELS) as ToolcribSetType[]).map((key) => (
                <option key={key} value={key}>{TYPE_LABELS[key]}</option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-ink-dim">Piezas (en orden de impresión)</p>
            {miembros.map((m, index) => (
              <div key={m.partNumber} className="grid grid-cols-[1fr_1fr_64px_32px] gap-2 items-center">
                <span className="font-mono text-xs font-bold truncate" title={m.partNumber}>{m.partNumber}</span>
                <Input aria-label={`Rol de ${m.partNumber}`} value={m.rol} onChange={(e) => update(index, { rol: e.target.value })} placeholder="Ej. Mitad Chica" disabled={busy} className="rounded-none border-2 border-line bg-surface-2 h-8 text-[11px] font-mono" />
                <Input aria-label={`Cantidad por juego de ${m.partNumber}`} type="number" min={1} max={99} value={m.cantidadPorJuego} onChange={(e) => update(index, { cantidadPorJuego: Number(e.target.value) })} disabled={busy} className="rounded-none border-2 border-line bg-surface-2 h-8 text-[11px] font-mono" />
                <button type="button" aria-label={`Quitar ${m.partNumber}`} onClick={() => setMiembros((prev) => prev.filter((_, i) => i !== index))} disabled={busy} className="text-ink-dim hover:text-danger">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <p className="text-[9px] font-mono text-ink-dim">La columna numérica es "piezas por juego" (1 = una por cada juego pedido).</p>
          </div>

          <div className="flex gap-2">
            <Input list="set-modal-parts" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Agregar pieza del catálogo…" disabled={busy} className="rounded-none border-2 border-line bg-surface-2 h-9 text-[12px] font-mono" />
            <datalist id="set-modal-parts">{catalogParts.map((p) => <option key={p} value={p} />)}</datalist>
            <Button type="button" variant="outline" onClick={addMember} disabled={busy} className="rounded-none border-2 border-line h-9 text-[10px] font-black uppercase">Agregar</Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {initialSet && <Button type="button" variant="outline" onClick={handleDelete} disabled={busy} className="rounded-none border-2 border-danger/60 text-danger h-9 text-[10px] font-black uppercase mr-auto">Borrar juego</Button>}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="rounded-none border-2 border-line h-9 text-[10px] font-black uppercase">Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={busy} className="rounded-none bg-accent text-bg h-9 text-[10px] font-black uppercase flex items-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin" />} Guardar juego
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Crear `src/components/ToolcribSetSuggestions.tsx`**

```tsx
import { Sparkles, X } from 'lucide-react';
import type { SetSuggestion } from '../lib/toolcribSetSuggestions';

export interface ToolcribSetSuggestionsProps {
  suggestions: SetSuggestion[];
  onAccept: (suggestion: SetSuggestion) => void;
  onDismiss: (suggestion: SetSuggestion) => void;
}

export function ToolcribSetSuggestions({ suggestions, onAccept, onDismiss }: ToolcribSetSuggestionsProps) {
  if (suggestions.length === 0) return null;
  const visible = suggestions.slice(0, 5);
  return (
    <div className="border-2 border-accent/40 bg-accent/10 p-3 space-y-2" role="region" aria-label="Sugerencias de juegos">
      <p className="text-[10px] font-mono font-black uppercase tracking-wider text-accent flex items-center gap-1.5">
        <Sparkles size={12} /> Posibles juegos ({suggestions.length})
      </p>
      {visible.map((suggestion) => (
        <div key={suggestion.root} className="flex items-center justify-between gap-2 text-[11px] font-mono">
          <span className="truncate">{suggestion.partNumbers.join(' + ')}</span>
          <span className="flex gap-1.5 shrink-0">
            <button type="button" onClick={() => onAccept(suggestion)} className="px-2 py-0.5 border-2 border-accent text-accent font-black uppercase text-[9px] hover:bg-accent hover:text-bg">Revisar</button>
            <button type="button" aria-label={`Descartar ${suggestion.root}`} onClick={() => onDismiss(suggestion)} className="px-1 border-2 border-line text-ink-dim hover:text-danger"><X size={11} /></button>
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Cambios en `ToolcribLibraryPanel.tsx` — estado y carga**

Imports nuevos (junto a los de `aliases`, línea ~37):

```tsx
import { ensureActiveSets } from '../lib/firebase/toolcribSets';
import { knownRuleGroupKey } from '../lib/companionDrawings';
import { findSavedSetForPart, setPartKey, type ToolcribSet } from '../lib/toolcribSets';
import { suggestSets, type SetSuggestion } from '../lib/toolcribSetSuggestions';
import { ToolcribSetModal } from './ToolcribSetModal';
import { ToolcribSetSuggestions } from './ToolcribSetSuggestions';
```

Estado nuevo (junto a `const [aliases, ...]`, línea ~326):

```tsx
  const [savedSets, setSavedSets] = useState<readonly ToolcribSet[]>([]);
  const [onlySets, setOnlySets] = useState(false);
  const [dismissedRoots, setDismissedRoots] = useState<ReadonlySet<string>>(new Set());
  const [setDraft, setSetDraft] = useState<{ members: string[]; set: ToolcribSet | null } | null>(null);

  const loadSets = useCallback(async (force = false) => {
    setSavedSets(await ensureActiveSets(force));
  }, []);

  useEffect(() => {
    void loadSets();
  }, [loadSets]);
```

- [ ] **Step 4: Derivados, filtro y sugerencias**

Debajo de `filteredGroups` no; primero arriba de `filteredGroups` (línea ~531), agrega:

```tsx
  const isGroupInSet = useCallback(
    (group: ToolcribPartGroup) =>
      findSavedSetForPart(group.partNumber, savedSets) !== null || knownRuleGroupKey(group.partNumber) !== null,
    [savedSets],
  );

  const setSuggestions = useMemo(
    () => suggestSets(views, savedSets).filter((s) => !dismissedRoots.has(s.root)),
    [views, savedSets, dismissedRoots],
  );
```

En `passesFilters` (línea ~534) cámbialo a:

```tsx
    const passesFilters = (group: ToolcribPartGroup) =>
      matchesFamilyGroup(group, selectedFamily) &&
      matchesAssetFilter(group, selectedAsset) &&
      (!onlySets || isGroupInSet(group));
```

y agrega `onlySets` e `isGroupInSet` al arreglo de dependencias de ese `useMemo` (junto a `selectedAsset`, línea ~564). También agrega `onlySets` a `hasNarrowingFilters` (línea ~706): `const hasNarrowingFilters = selectedFamily !== 'all' || selectedAsset !== 'all' || onlySets;` y en `resetFilters` agrega `setOnlySets(false);` (busca la función `resetFilters` con Grep y añade esa línea dentro).

- [ ] **Step 5: Chip de filtro y bloque de sugerencias en el render**

Justo después del bloque de chips de `selectedAsset` (línea ~851, dentro del mismo contenedor de chips), agrega un botón con el mismo estilo que los otros chips. Lee las líneas 835-870 y copia el marcado de un chip existente; el contenido es:

```tsx
            <button
              type="button"
              aria-pressed={onlySets}
              onClick={() => setOnlySets((prev) => !prev)}
              className={`px-2 py-1 border-2 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors ${onlySets ? 'border-accent bg-accent/10 text-accent' : 'border-line text-ink-dim hover:border-accent/40'}`}
            >
              Solo pares / juegos
            </button>
```

Justo antes de la tabla (busca el `<Table` principal, línea ~960) inserta:

```tsx
        <ToolcribSetSuggestions
          suggestions={setSuggestions}
          onAccept={(s) => setSetDraft({ members: s.partNumbers, set: null })}
          onDismiss={(s) => setDismissedRoots((prev) => new Set(prev).add(s.root))}
        />
```

- [ ] **Step 6: Insignia y botón en `PartGroupRow`**

Agrega a `PartGroupRowProps` (línea ~1280):

```tsx
  setInfo: { label: string; title: string } | null;
  onLinkSet: (group: ToolcribPartGroup) => void;
```

Desestructúralos en la firma del componente (junto a `onAlias`). Junto a la insignia `sin CAD` (línea ~1390), agrega:

```tsx
            {setInfo && (
              <button
                type="button"
                onClick={() => onLinkSet(group)}
                title={setInfo.title}
                className="bg-accent/10 text-accent border-2 border-accent/40 hover:bg-accent/20 text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-none transition-colors"
              >
                {setInfo.label}
              </button>
            )}
```

En el menú de la fila, antes del `<DropdownMenuSeparator>` previo a "Eliminar CAD" (línea ~1601), agrega:

```tsx
              <DropdownMenuItem
                onClick={() => onLinkSet(group)}
                className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5"
              >
                <Files size={12} className="mr-1.5" />
                {setInfo ? 'Editar juego' : 'Vincular como juego'}
              </DropdownMenuItem>
```

(`Files` viene de `lucide-react`; agrégalo al import existente de íconos del panel si no está.)

En el `displayedGroups.map` (línea ~1003), pasa las props nuevas:

```tsx
                  setInfo={setInfoFor(group)}
                  onLinkSet={openSetDraftFor}
```

y define, antes del `return` del panel, junto a `isGroupInSet`:

```tsx
  const setInfoFor = useCallback(
    (group: ToolcribPartGroup): { label: string; title: string } | null => {
      const saved = findSavedSetForPart(group.partNumber, savedSets);
      if (saved) {
        const key = setPartKey(group.partNumber);
        const index = saved.miembros.findIndex((m) => m.partNumber === key) + 1;
        const others = saved.miembros.filter((m) => m.partNumber !== key).map((m) => m.partNumber).join(', ');
        return { label: `${saved.tipo === 'hoja' ? 'HOJA' : 'PAR'} ${index}/${saved.miembros.length}`, title: `${saved.nombre} · con ${others}. Clic para editar.` };
      }
      return knownRuleGroupKey(group.partNumber)
        ? { label: 'JUEGO', title: 'Juego detectado por regla del taller. Clic para guardarlo y personalizarlo.' }
        : null;
    },
    [savedSets],
  );

  const openSetDraftFor = useCallback(
    (group: ToolcribPartGroup) => {
      const saved = findSavedSetForPart(group.partNumber, savedSets);
      setSetDraft({ members: saved ? saved.miembros.map((m) => m.partNumber) : [setPartKey(group.partNumber)], set: saved });
    },
    [savedSets],
  );
```

Junto a los otros modales al final del JSX (cerca de `<ToolcribPrintModal`, línea ~1184):

```tsx
      <ToolcribSetModal
        open={setDraft !== null}
        initialMembers={setDraft?.members ?? []}
        initialSet={setDraft?.set ?? null}
        catalogParts={groups.map((g) => g.partNumber)}
        onClose={() => setSetDraft(null)}
        onSaved={() => void loadSets(true)}
      />
```

- [ ] **Step 7: Verificar**

Run: `npm run lint` → sin errores.
Run: `npm test` → todo verde.
Run (verificación visual): `preview_start` con el servidor de desarrollo del proyecto; abre Biblioteca, comprueba que aparece el chip "Solo pares / juegos", la insignia "JUEGO" en piezas 1012-05 / 4150-06, el bloque de sugerencias, y que "Vincular como juego" abre el modal. Revisa `read_console_messages` sin errores.

- [ ] **Step 8: Commit (solo con autorización)**

```bash
git add src/components/ToolcribSetModal.tsx src/components/ToolcribSetSuggestions.tsx src/components/ToolcribLibraryPanel.tsx
git commit -m "feat(biblioteca): insignia, filtro, vinculo y sugerencias de juegos"
```

---

### Task 6: Armado de impresiones separadas (lógica pura)

**Files:**
- Create: `src/lib/setPrintJobs.ts`
- Modify: `src/lib/planoOt.ts:780-787` (`PlanoOtSetItem`)
- Test: `src/lib/__tests__/setPrintJobs.test.ts`

**Interfaces:**
- Consumes: `PlanoOtStamp` de `./planoOt`; `quantityForMember` de `./toolcribSets`.
- Produces:
  - `interface SetPrintPiece { pdfDataUrl: string; partNumber: string; revision?: string; description?: string; customer?: string; companionLabel?: string; cantidadPorJuego: number; permanentNotes: string[] }`
  - `interface SetPrintJob { piece: SetPrintPiece; stamp: PlanoOtStamp }`
  - `buildSeparatePrintJobs(pieces: SetPrintPiece[], baseStamp: PlanoOtStamp, juegos: number, corrida: string): SetPrintJob[]`
  - `PlanoOtSetItem` con `customer?: string; cantidadPorJuego?: number`.
  - `composeOtNotes` se agrega en Task 8; aquí se usa una función local `joinNotes`.

- [ ] **Step 1: Agregar campos a `PlanoOtSetItem`**

En `src/lib/planoOt.ts`:

```ts
export interface PlanoOtSetItem {
  pdfDataUrl: string;
  partNumber: string;
  revision?: string;
  description?: string;
  customer?: string;
  /** Piezas de este plano por cada juego pedido (1 por defecto). */
  cantidadPorJuego?: number;
  isCompanion?: boolean;
  companionLabel?: string;
}
```

- [ ] **Step 2: Escribir la prueba que falla**

```ts
import { describe, expect, it } from 'vitest';
import type { PlanoOtStamp } from '../planoOt';
import { buildSeparatePrintJobs, type SetPrintPiece } from '../setPrintJobs';

const baseStamp: PlanoOtStamp = {
  soNumber: 'SO-1234',
  cantidad: '10',
  fecha: '2026-09-29 10:00',
  poNumber: 'PO-9',
  notas: '',
  partNumber: '1012-05-CHICO',
  customer: 'SUPRAJIT',
  piezaDescripcion: 'Hex swage block',
  mode: 'both',
  headerStyle: 'slim',
  quantityMask: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
};

const pieces: SetPrintPiece[] = [
  { pdfDataUrl: 'data:a', partNumber: '1012-05-CHICO', description: 'Chica', cantidadPorJuego: 1, permanentNotes: ['Rebabear'] },
  { pdfDataUrl: 'data:b', partNumber: '1012-05-GRANDE', description: 'Grande', companionLabel: 'Mitad Grande', customer: 'SUPRAJIT', cantidadPorJuego: 2, permanentNotes: [] },
];

describe('buildSeparatePrintJobs', () => {
  it('genera un trabajo por pieza con SO, PO y fecha compartidos', () => {
    const jobs = buildSeparatePrintJobs(pieces, baseStamp, 10, 'Urgente');
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.stamp.soNumber === 'SO-1234' && j.stamp.poNumber === 'PO-9')).toBe(true);
    expect(jobs.every((j) => j.stamp.fecha === '2026-09-29 10:00')).toBe(true);
  });

  it('multiplica la cantidad por las piezas por juego', () => {
    const jobs = buildSeparatePrintJobs(pieces, baseStamp, 10, '');
    expect(jobs.map((j) => j.stamp.cantidad)).toEqual(['10', '20']);
  });

  it('solo la pieza base conserva la máscara de cantidad', () => {
    const jobs = buildSeparatePrintJobs(pieces, baseStamp, 10, '');
    expect(jobs[0].stamp.quantityMask).not.toBeNull();
    expect(jobs[1].stamp.quantityMask).toBeNull();
  });

  it('cada pieza lleva sus notas permanentes y la nota de la corrida', () => {
    const jobs = buildSeparatePrintJobs(pieces, baseStamp, 10, 'Urgente');
    expect(jobs[0].stamp.notas).toBe('Rebabear · Urgente');
    expect(jobs[1].stamp.notas).toBe('Urgente');
  });

  it('cada pieza usa su número de parte, cliente y descripción con el rol', () => {
    const jobs = buildSeparatePrintJobs(pieces, baseStamp, 10, '');
    expect(jobs[1].stamp.partNumber).toBe('1012-05-GRANDE');
    expect(jobs[1].stamp.piezaDescripcion).toBe('Grande · Mitad Grande');
    expect(jobs[0].stamp.customer).toBe('SUPRAJIT');
  });

  it('no modifica el sello base recibido', () => {
    buildSeparatePrintJobs(pieces, baseStamp, 10, 'x');
    expect(baseStamp.notas).toBe('');
    expect(baseStamp.cantidad).toBe('10');
  });
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npx vitest run src/lib/__tests__/setPrintJobs.test.ts`
Expected: FAIL (`Cannot find module '../setPrintJobs'`).

- [ ] **Step 4: Implementar `src/lib/setPrintJobs.ts`**

```ts
import type { PlanoOtStamp } from './planoOt';
import { quantityForMember } from './toolcribSets';

export interface SetPrintPiece {
  pdfDataUrl: string;
  partNumber: string;
  revision?: string;
  description?: string;
  customer?: string;
  /** Rol dentro del juego ("Mitad Grande"); vacío para la pieza base. */
  companionLabel?: string;
  cantidadPorJuego: number;
  /** Textos de notas permanentes ya filtrados (solo las que van a la OT). */
  permanentNotes: string[];
}

export interface SetPrintJob {
  piece: SetPrintPiece;
  stamp: PlanoOtStamp;
}

function joinNotes(parts: readonly string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(' · ');
}

/**
 * Una OT completa por pieza del juego (sello y ficha completos).
 * Comparten SO/PO/fecha; la cantidad es `juegos × cantidadPorJuego`.
 * La máscara de cantidad solo aplica a la primera pieza (la que se previsualizó).
 */
export function buildSeparatePrintJobs(
  pieces: SetPrintPiece[],
  baseStamp: PlanoOtStamp,
  juegos: number,
  corrida: string,
): SetPrintJob[] {
  return pieces.map((piece, index) => {
    const description = piece.description || baseStamp.piezaDescripcion || '';
    return {
      piece,
      stamp: {
        ...baseStamp,
        partNumber: piece.partNumber,
        customer: piece.customer || baseStamp.customer,
        piezaDescripcion: piece.companionLabel ? `${description} · ${piece.companionLabel}`.trim() : description,
        cantidad: String(quantityForMember(juegos, piece.cantidadPorJuego)),
        notas: joinNotes([...piece.permanentNotes, corrida]),
        quantityMask: index === 0 ? baseStamp.quantityMask : null,
      },
    };
  });
}
```

- [ ] **Step 5: Correr y ver que pasa; type-check**

Run: `npx vitest run src/lib/__tests__/setPrintJobs.test.ts` → PASS. Run: `npm run lint` → sin errores.

- [ ] **Step 6: Commit (solo con autorización)**

```bash
git add src/lib/setPrintJobs.ts src/lib/__tests__/setPrintJobs.test.ts src/lib/planoOt.ts
git commit -m "feat(ot): trabajos de impresion separados por pieza del juego"
```

---

### Task 7: Modal de impresión — juegos guardados e impresión separada

**Files:**
- Modify: `src/components/ToolcribPrintModal.tsx`
- Modify: `src/hooks/useBatchPrintOts.ts:76-78`

**Interfaces:**
- Consumes: `ensureActiveSets` (Task 3), `getActiveSets`, `baseQuantityFactor` (Task 1), `findCompanionDrawings` con sets (Task 2), `buildSeparatePrintJobs`, `SetPrintPiece`, `SetPrintJob` (Task 6), `openStampedPlanoOt`, `PlanoOtSetItem`.
- Produces: estado `juegoMode: 'separadas' | 'unificado'` (lo controlará el preset en Task 10; aquí se inicializa en `'separadas'`).

- [ ] **Step 1: Cargar juegos activos y usarlos en `companions`**

En `ToolcribPrintModal.tsx` agrega imports:

```tsx
import { ensureActiveSets } from '../lib/firebase/toolcribSets';
import { baseQuantityFactor, getActiveSets } from '../lib/toolcribSets';
import { buildSeparatePrintJobs, type SetPrintJob, type SetPrintPiece } from '../lib/setPrintJobs';
```

Estado nuevo (junto a `setItems`):

```tsx
  const [setsTick, setSetsTick] = useState(0);
  const [juegoMode, setJuegoMode] = useState<'separadas' | 'unificado'>('separadas');
  const [pendingJobs, setPendingJobs] = useState<{ job: SetPrintJob; printed: boolean }[] | null>(null);
```

Efecto para cargar los juegos al abrir (debajo del efecto de catálogo):

```tsx
  useEffect(() => {
    if (!drawing) return;
    let cancelled = false;
    void ensureActiveSets().then(() => {
      if (!cancelled) setSetsTick((tick) => tick + 1);
    });
    return () => { cancelled = true; };
  }, [drawing]);
```

Cambia el `useMemo` de `companions`:

```tsx
  const companions: CompanionInfo[] = useMemo(() => {
    if (!drawing || catalog.length === 0) return [];
    return findCompanionDrawings(drawing, catalog, getActiveSets());
    // setsTick fuerza el recálculo cuando terminan de cargar los juegos guardados.
  }, [drawing, catalog, setsTick]);
```

En el efecto de reinicio (el que hace `setSetItems(null)`, línea ~103), agrega `setPendingJobs(null);`.

- [ ] **Step 2: Incluir `customer` y `cantidadPorJuego` en los items del juego**

En `handleSubmit`, en el push de `compItems` (línea ~222) agrega `customer: comp.drawing.customer, cantidadPorJuego: comp.cantidadPorJuego ?? 1,`; y en el objeto de la pieza base dentro de `preparedSet` agrega `customer: drawing.customer, cantidadPorJuego: baseQuantityFactor(drawing.partNumber, getActiveSets()),`.

- [ ] **Step 3: Impresión separada al confirmar**

Reemplaza el bloque final de impresión (líneas ~254-259) por:

```tsx
      if (setItems && setItems.length > 1 && juegoMode === 'separadas') {
        const juegos = Number(cantidad);
        const pieces: SetPrintPiece[] = setItems.map((item, index) => ({
          pdfDataUrl: item.pdfDataUrl,
          partNumber: item.partNumber,
          revision: item.revision,
          description: item.description,
          customer: item.customer,
          companionLabel: index === 0 ? undefined : item.companionLabel,
          cantidadPorJuego: item.cantidadPorJuego ?? 1,
          permanentNotes: [],
        }));
        const jobs = buildSeparatePrintJobs(pieces, { ...preview.stamp, quantityMask: mask }, juegos, notas.trim());
        await openStampedPlanoOt(jobs[0].piece.pdfDataUrl, jobs[0].stamp);
        if (generation.current !== currentGeneration) return;
        setPendingJobs(jobs.map((job, index) => ({ job, printed: index === 0 })));
        return;
      }

      if (setItems && setItems.length > 1) {
        await openStampedPlanoOtSet(setItems, { ...preview.stamp, quantityMask: mask });
      } else {
        await openStampedPlanoOt(preview.dataUrl, { ...preview.stamp, quantityMask: mask });
      }
      if (generation.current !== currentGeneration) return;
```

(`permanentNotes: []` se llena en Task 9.)

- [ ] **Step 4: Panel "Piezas del juego" tras imprimir la primera**

Agrega dos funciones dentro del componente:

```tsx
  const handlePrintPending = async (index: number) => {
    if (!pendingJobs) return;
    setError(null);
    try {
      await openStampedPlanoOt(pendingJobs[index].job.piece.pdfDataUrl, pendingJobs[index].job.stamp);
      setPendingJobs((prev) => prev && prev.map((entry, i) => (i === index ? { ...entry, printed: true } : entry)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al imprimir esta pieza.');
    }
  };

  const handleFinishSet = () => {
    const submittedSoNumber = soNumber.trim() || null;
    setSoNumber('');
    setCantidad('');
    setPoNumber('');
    setNotas('');
    setPendingJobs(null);
    onSuccess({ soNumber: submittedSoNumber });
    onClose();
  };
```

En el JSX, envuelve el contenido del `<form>` para que, si `pendingJobs` no es null, se muestre solo este panel en lugar de vista previa/campos (coloca esta rama antes de `preview ? <> ... </> : <> ... </>`, convirtiendo el ternario en `pendingJobs ? (<panel/>) : preview ? <>…</> : <>…</>`):

```tsx
          {pendingJobs ? (
            <div className="space-y-3" role="region" aria-label="Piezas del juego">
              <p className="text-[10px] font-mono font-black uppercase text-accent flex items-center gap-1.5">
                <Files size={13} /> Juego: una OT por pieza
              </p>
              {pendingJobs.map((entry, index) => (
                <div key={entry.job.piece.partNumber} className="flex items-center justify-between gap-2 border-2 border-line bg-surface-2 p-2">
                  <span className="font-mono text-xs">
                    <strong>{entry.job.piece.partNumber}</strong>{entry.job.piece.companionLabel ? ` · ${entry.job.piece.companionLabel}` : ''} · {entry.job.stamp.cantidad} pzs
                  </span>
                  <Button type="button" variant="outline" onClick={() => void handlePrintPending(index)} className="rounded-none border-2 border-line h-8 text-[10px] font-black uppercase">
                    {entry.printed ? 'Reimprimir' : 'Imprimir'}
                  </Button>
                </div>
              ))}
            </div>
          ) : preview ? <>
```

(y el cierre del ternario al final: `</>}` pasa a `</>}` sin cambios, porque `pendingJobs ? (...) : preview ? <>…</> : <>…</>` termina igual.)

En el `DialogFooter`, cuando `pendingJobs` existe, muestra solo un botón "Terminar" que llama a `handleFinishSet`. Envuelve el contenido actual del footer:

```tsx
          <DialogFooter className="pt-2 flex justify-end gap-2 border-t-2 border-line mt-4">
            {pendingJobs ? (
              <Button type="button" onClick={handleFinishSet} className="bg-accent text-bg px-6 h-9 text-[10px] font-black uppercase tracking-widest rounded-none">
                Terminar
              </Button>
            ) : (<>
              {/* …contenido actual del footer sin cambios… */}
            </>)}
          </DialogFooter>
```

Cambia también el texto del botón de imprimir cuando hay juego separado: en la rama `setItems && setItems.length > 1` usa `juegoMode === 'separadas' ? `Imprimir ${setItems.length} OTs (una por pieza)` : `Imprimir Juego (${setItems.length} Planos)``.

En la casilla "Imprimir juego completo" agrega bajo el texto de compañeros una línea: `Cantidad = juegos pedidos; cada pieza se multiplica por sus piezas por juego.` (`<p className="text-[9px] font-mono text-ink-dim">…</p>`).

- [ ] **Step 5: El lote respeta los juegos guardados**

En `src/hooks/useBatchPrintOts.ts`, agrega `import { ensureActiveSets } from '../lib/firebase/toolcribSets';` y, en `handleBatchPrintOts`, justo antes de `const library = await ensureCatalogViews();`:

```ts
      await ensureActiveSets();
```

(El puente `orderDrawingBridge` llama a `findCompanionDrawings(view, library)` y ya usa el almacén en memoria por defecto.)

- [ ] **Step 6: Verificar**

Run: `npm run lint` → sin errores. Run: `npm test` → verde (incluye `planoOt.test.ts`, `companionDrawings.test.ts`, `orderDrawingBridge.test.ts`).
Verificación visual con `preview_start`: Biblioteca → imprimir 1012-05-CHICO → "Vista previa" → "Imprimir 2 OTs" abre la primera OT y aparece la lista con "Imprimir" para la GRANDE; el sello de la GRANDE muestra su número de parte y la cantidad multiplicada.

- [ ] **Step 7: Commit (solo con autorización)**

```bash
git add src/components/ToolcribPrintModal.tsx src/hooks/useBatchPrintOts.ts
git commit -m "feat(ot): imprimir cada pieza del juego en su propia OT"
```

---

### Task 8: Notas permanentes — lógica y persistencia

**Files:**
- Create: `src/lib/partNotes.ts`, `src/lib/firebase/partNotes.ts`
- Test: `src/lib/__tests__/partNotes.test.ts`

**Interfaces:**
- Consumes: `canonicalPartNumber` de `./toolcribCatalog`; patrón de `aliases.ts`.
- Produces (`src/lib/partNotes.ts`):
  - `interface PartNote { id: string; texto: string; imprimirEnOT: boolean }`
  - `const MAX_NOTES_PER_PART = 10`, `const MAX_NOTE_LENGTH = 300`
  - `const QUICK_NOTE_CHIPS: readonly string[]`
  - `normalizePartNotes(raw: unknown): PartNote[]`
  - `composeOtNotes(texts: readonly string[], corrida: string): string`
  - `noteDocId(partNumber: string): string`
- Produces (`src/lib/firebase/partNotes.ts`): `listPartNotes(): Promise<NotesResult<Map<string, PartNote[]>>>` (clave = `setPartKey(partNumber)`), `savePartNotes(partNumber: string, notes: PartNote[]): Promise<NotesResult<true>>`, tipo `NotesResult<T>` con las mismas razones que `SetResult`.

- [ ] **Step 1: Escribir la prueba que falla**

```ts
import { describe, expect, it } from 'vitest';
import { composeOtNotes, MAX_NOTE_LENGTH, MAX_NOTES_PER_PART, noteDocId, normalizePartNotes } from '../partNotes';

describe('partNotes', () => {
  it('normaliza notas válidas y descarta basura', () => {
    const notes = normalizePartNotes([
      { id: 'a', texto: '  Rebabear  ', imprimirEnOT: true },
      { id: 'b', texto: '', imprimirEnOT: true },
      { id: 'c', texto: 'Sin flag' },
      null,
      42,
    ]);
    expect(notes).toEqual([
      { id: 'a', texto: 'Rebabear', imprimirEnOT: true },
      { id: 'c', texto: 'Sin flag', imprimirEnOT: false },
    ]);
  });

  it('recorta el texto a 300 caracteres y limita a 10 notas', () => {
    const long = normalizePartNotes([{ id: 'a', texto: 'x'.repeat(500), imprimirEnOT: true }]);
    expect(long[0].texto).toHaveLength(MAX_NOTE_LENGTH);
    const many = normalizePartNotes(Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, texto: `t${i}`, imprimirEnOT: true })));
    expect(many).toHaveLength(MAX_NOTES_PER_PART);
  });

  it('entrada que no es arreglo devuelve []', () => {
    expect(normalizePartNotes(undefined)).toEqual([]);
    expect(normalizePartNotes('hola')).toEqual([]);
  });

  it('composeOtNotes une con " · " y omite vacíos', () => {
    expect(composeOtNotes(['Rebabear', ' Rectificar '], 'Urgente')).toBe('Rebabear · Rectificar · Urgente');
    expect(composeOtNotes([], '  ')).toBe('');
    expect(composeOtNotes([], 'Solo corrida')).toBe('Solo corrida');
  });

  it('noteDocId es determinista y seguro para Firestore', () => {
    expect(noteDocId('1012-05-chico')).toBe('1012_05_CHICO');
    expect(noteDocId('90-1012-06.ISO')).toBe('90_1012_06');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/__tests__/partNotes.test.ts`
Expected: FAIL (`Cannot find module '../partNotes'`).

- [ ] **Step 3: Implementar `src/lib/partNotes.ts`**

```ts
/** Notas permanentes por pieza (lógica pura). Persistencia: src/lib/firebase/partNotes.ts */

import { canonicalPartNumber } from './toolcribCatalog';

export interface PartNote {
  id: string;
  texto: string;
  /** Si es true, la nota viene marcada por defecto para salir en la OT. */
  imprimirEnOT: boolean;
}

export const MAX_NOTES_PER_PART = 10;
export const MAX_NOTE_LENGTH = 300;

/** Notas rápidas de un clic en el modal de impresión. Edita esta lista para cambiarlas. */
export const QUICK_NOTE_CHIPS: readonly string[] = ['Rebabear', 'Tratamiento térmico', 'Rectificar', 'Revisar tolerancias'];

export function normalizePartNotes(raw: unknown): PartNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: PartNote[] = [];
  for (const item of raw) {
    if (notes.length >= MAX_NOTES_PER_PART) break;
    if (!item || typeof item !== 'object') continue;
    const data = item as Record<string, unknown>;
    const texto = typeof data.texto === 'string' ? data.texto.trim().slice(0, MAX_NOTE_LENGTH) : '';
    if (!texto) continue;
    const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : `n${notes.length + 1}`;
    notes.push({ id, texto, imprimirEnOT: data.imprimirEnOT === true });
  }
  return notes;
}

/** Une notas permanentes (ya filtradas) y la nota de la corrida en una sola línea para el sello. */
export function composeOtNotes(texts: readonly string[], corrida: string): string {
  return [...texts, corrida].map((t) => t.trim()).filter(Boolean).join(' · ');
}

export function noteDocId(partNumber: string): string {
  return canonicalPartNumber(partNumber).replace(/[^A-Z0-9]/g, '_').slice(0, 100);
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run src/lib/__tests__/partNotes.test.ts` → PASS.

- [ ] **Step 5: Implementar `src/lib/firebase/partNotes.ts`**

```ts
/**
 * Notas permanentes por pieza en Firestore (colección `toolcribPartNotes`).
 * Contrato de resultado: nunca lanza excepciones.
 */

import { collection, deleteDoc, doc, getDocs, limit, query, serverTimestamp, setDoc } from 'firebase/firestore';

import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';
import { log } from '../log';
import { noteDocId, normalizePartNotes, type PartNote } from '../partNotes';
import { setPartKey } from '../toolcribSets';

export const TOOLCRIB_PART_NOTES_COLLECTION = 'toolcribPartNotes';

export type NotesFailureReason = 'not-configured' | 'not-authenticated' | 'invalid-input' | 'read-failed' | 'write-failed';
export type NotesResult<T> = { ok: true; value: T } | { ok: false; reason: NotesFailureReason };

function isAuthed(): boolean {
  return getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();
}

/** Todas las notas, indexadas por número de parte canónico. */
export async function listPartNotes(): Promise<NotesResult<Map<string, PartNote[]>>> {
  const db = getFirestoreClient();
  if (!db) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };
  try {
    const snap = await getDocs(query(collection(db, TOOLCRIB_PART_NOTES_COLLECTION), limit(2000)));
    const byPart = new Map<string, PartNote[]>();
    snap.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      const partNumber = typeof data.partNumber === 'string' ? setPartKey(data.partNumber) : '';
      const notes = normalizePartNotes(data.notas);
      if (partNumber && notes.length > 0) byPart.set(partNumber, notes);
    });
    return { ok: true, value: byPart };
  } catch (error) {
    log.warn('[smv-vision][partNotes] listPartNotes falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/** Guarda las notas de una pieza; con lista vacía borra el documento. */
export async function savePartNotes(partNumber: string, notes: PartNote[]): Promise<NotesResult<true>> {
  const db = getFirestoreClient();
  if (!db) return { ok: false, reason: 'not-configured' };
  const uid = getCurrentUserUid();
  if (!uid && !isToolcribDebugUnauthAllowed()) return { ok: false, reason: 'not-authenticated' };

  const key = setPartKey(partNumber);
  if (!key) return { ok: false, reason: 'invalid-input' };
  const clean = normalizePartNotes(notes);

  try {
    const ref = doc(db, TOOLCRIB_PART_NOTES_COLLECTION, noteDocId(key));
    if (clean.length === 0) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { partNumber: key, notas: clean, updatedByUid: uid ?? 'debug', updatedAtUTC: serverTimestamp() }, { merge: true });
    }
    return { ok: true, value: true };
  } catch (error) {
    log.warn('[smv-vision][partNotes] savePartNotes falló', error);
    return { ok: false, reason: 'write-failed' };
  }
}
```

- [ ] **Step 6: Type-check y commit (solo con autorización)**

Run: `npm run lint` → sin errores.

```bash
git add src/lib/partNotes.ts src/lib/firebase/partNotes.ts src/lib/__tests__/partNotes.test.ts
git commit -m "feat(biblioteca): notas permanentes por pieza (logica y firestore)"
```

---

### Task 9: Notas permanentes en la UI (Biblioteca y modal de impresión)

**Files:**
- Create: `src/components/ToolcribNotesModal.tsx`
- Modify: `src/components/ToolcribLibraryPanel.tsx`, `src/components/ToolcribPrintModal.tsx`

**Interfaces:**
- Consumes: `listPartNotes`, `savePartNotes` (Task 8); `PartNote`, `MAX_NOTES_PER_PART`, `MAX_NOTE_LENGTH`, `QUICK_NOTE_CHIPS`, `composeOtNotes` (Task 8); `setPartKey` (Task 1); `SetPrintPiece.permanentNotes` (Task 6).
- Produces: `ToolcribNotesModal({ partNumber, notes, onClose, onSaved })` con `partNumber: string | null`, `notes: PartNote[]`, `onSaved: () => void`.

- [ ] **Step 1: Crear `src/components/ToolcribNotesModal.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { savePartNotes } from '../lib/firebase/partNotes';
import { MAX_NOTE_LENGTH, MAX_NOTES_PER_PART, type PartNote } from '../lib/partNotes';

export interface ToolcribNotesModalProps {
  partNumber: string | null;
  notes: PartNote[];
  onClose: () => void;
  onSaved: () => void;
}

export function ToolcribNotesModal({ partNumber, notes, onClose, onSaved }: ToolcribNotesModalProps) {
  const [draft, setDraft] = useState<PartNote[]>([]);
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(notes.map((n) => ({ ...n })));
    setTexto('');
    setError(null);
  }, [partNumber, notes]);

  const add = () => {
    const value = texto.trim();
    if (!value) return;
    if (draft.length >= MAX_NOTES_PER_PART) {
      setError(`Máximo ${MAX_NOTES_PER_PART} notas por pieza.`);
      return;
    }
    setError(null);
    setDraft((prev) => [...prev, { id: `n${Date.now().toString(36)}`, texto: value.slice(0, MAX_NOTE_LENGTH), imprimirEnOT: true }]);
    setTexto('');
  };

  const handleSave = async () => {
    if (!partNumber) return;
    setBusy(true);
    const res = await savePartNotes(partNumber, draft);
    setBusy(false);
    if (res.ok === false) {
      setError(`No se pudieron guardar las notas (${res.reason}).`);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Dialog open={partNumber !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg bg-surface border-2 border-line rounded-none text-ink">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest">Notas de {partNumber}</DialogTitle>
          <DialogDescription className="text-[11px] text-ink-dim">
            Se guardan con la pieza. Las marcadas "en OT" aparecen precargadas al imprimir.
          </DialogDescription>
        </DialogHeader>

        {error && <p role="alert" className="border-2 border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger">{error}</p>}

        <div className="space-y-2">
          {draft.length === 0 && <p className="text-[11px] font-mono text-ink-dim">Sin notas todavía.</p>}
          {draft.map((note, index) => (
            <div key={note.id} className="flex items-start gap-2 border-2 border-line bg-surface-2 p-2">
              <p className="flex-1 text-xs font-mono">{note.texto}</p>
              <label className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase whitespace-nowrap">
                <input type="checkbox" checked={note.imprimirEnOT} onChange={(e) => setDraft((prev) => prev.map((n, i) => (i === index ? { ...n, imprimirEnOT: e.target.checked } : n)))} className="accent-accent" />
                en OT
              </label>
              <button type="button" aria-label="Quitar nota" onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))} className="text-ink-dim hover:text-danger"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input aria-label="Nueva nota" value={texto} maxLength={MAX_NOTE_LENGTH} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder='Ej. "Usar inserto X"' disabled={busy} className="rounded-none border-2 border-line bg-surface-2 h-9 text-[12px] font-mono" />
            <Button type="button" variant="outline" onClick={add} disabled={busy} className="rounded-none border-2 border-line h-9 text-[10px] font-black uppercase">Agregar</Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="rounded-none border-2 border-line h-9 text-[10px] font-black uppercase">Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={busy} className="rounded-none bg-accent text-bg h-9 text-[10px] font-black uppercase flex items-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin" />} Guardar notas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Panel de la Biblioteca — cargar notas, ícono y menú**

En `ToolcribLibraryPanel.tsx` agrega imports:

```tsx
import { listPartNotes } from '../lib/firebase/partNotes';
import type { PartNote } from '../lib/partNotes';
import { ToolcribNotesModal } from './ToolcribNotesModal';
```

Estado y carga (junto al estado de juegos):

```tsx
  const [partNotes, setPartNotes] = useState<ReadonlyMap<string, PartNote[]>>(new Map());
  const [notesTarget, setNotesTarget] = useState<string | null>(null);

  const loadPartNotes = useCallback(async () => {
    const res = await listPartNotes();
    if (res.ok === false) {
      log.warn('[toolcrib] listPartNotes falló — sin notas permanentes', res.reason);
      return;
    }
    setPartNotes(res.value);
  }, []);

  useEffect(() => {
    void loadPartNotes();
  }, [loadPartNotes]);
```

Props nuevas en `PartGroupRowProps`: `noteCount: number; onNotes: (partNumber: string) => void;`. En el `map` de filas: `noteCount={partNotes.get(setPartKey(group.partNumber))?.length ?? 0}` y `onNotes={setNotesTarget}`. Junto a la insignia de juego (Task 5), agrega:

```tsx
            {noteCount > 0 && (
              <button type="button" onClick={() => onNotes(group.partNumber)} title={`${noteCount} nota(s) permanente(s)`} aria-label={`Ver notas de ${group.partNumber}`} className="border-2 border-warn/50 text-warn text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-none hover:bg-warn/10">
                📝 {noteCount}
              </button>
            )}
```

En el menú de la fila, después de "Vincular como juego":

```tsx
              <DropdownMenuItem
                onClick={() => onNotes(group.partNumber)}
                className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5"
              >
                <Tag size={12} className="mr-1.5" />
                {noteCount > 0 ? 'Editar notas' : 'Agregar notas'}
              </DropdownMenuItem>
```

Modal al final del JSX:

```tsx
      <ToolcribNotesModal
        partNumber={notesTarget}
        notes={notesTarget ? partNotes.get(setPartKey(notesTarget)) ?? [] : []}
        onClose={() => setNotesTarget(null)}
        onSaved={() => void loadPartNotes()}
      />
```

- [ ] **Step 3: Modal de impresión — notas permanentes y chips**

En `ToolcribPrintModal.tsx` agrega imports:

```tsx
import { listPartNotes } from '../lib/firebase/partNotes';
import { composeOtNotes, QUICK_NOTE_CHIPS, type PartNote } from '../lib/partNotes';
import { setPartKey } from '../lib/toolcribSets';
```

Estado:

```tsx
  const [allNotes, setAllNotes] = useState<ReadonlyMap<string, PartNote[]>>(new Map());
  const [enabledNoteIds, setEnabledNoteIds] = useState<ReadonlySet<string>>(new Set());
```

Efecto al abrir:

```tsx
  useEffect(() => {
    if (!drawing) return;
    let cancelled = false;
    void listPartNotes().then((res) => {
      if (cancelled || res.ok === false) return;
      setAllNotes(res.value);
      const own = res.value.get(setPartKey(drawing.partNumber)) ?? [];
      setEnabledNoteIds(new Set(own.filter((n) => n.imprimirEnOT).map((n) => n.id)));
    });
    return () => { cancelled = true; };
  }, [drawing]);
```

Deriva las notas de la pieza base y el texto compuesto:

```tsx
  const ownNotes = drawing ? allNotes.get(setPartKey(drawing.partNumber)) ?? [] : [];
  const ownNoteTexts = () => ownNotes.filter((n) => enabledNoteIds.has(n.id)).map((n) => n.texto);
```

En `baseStamp` cambia `notas: notas.trim(),` por `notas: composeOtNotes(ownNoteTexts(), notas.trim()),`.

En la construcción de `pieces` (Task 7 Step 3) reemplaza `permanentNotes: [],` por:

```tsx
          permanentNotes:
            index === 0
              ? ownNoteTexts()
              : (allNotes.get(setPartKey(item.partNumber)) ?? []).filter((n) => n.imprimirEnOT).map((n) => n.texto),
```

En el JSX, encima del campo "Notas Adicionales", agrega las casillas y los chips:

```tsx
          {ownNotes.length > 0 && (
            <div className="space-y-1 border-2 border-warn/40 bg-warn/10 p-2" role="group" aria-label="Notas permanentes de la pieza">
              <p className="text-[10px] font-black uppercase tracking-widest text-ink-dim">Notas permanentes</p>
              {ownNotes.map((note) => (
                <label key={note.id} className="flex items-start gap-2 text-[11px] font-mono cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledNoteIds.has(note.id)}
                    onChange={(e) => setEnabledNoteIds((prev) => { const next = new Set(prev); if (e.target.checked) next.add(note.id); else next.delete(note.id); return next; })}
                    disabled={isProcessing}
                    className="mt-0.5 accent-accent"
                  />
                  <span>{note.texto}</span>
                </label>
              ))}
            </div>
          )}
```

Y debajo del `<Input id="print-notes" …/>`:

```tsx
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {QUICK_NOTE_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setNotas((prev) => (prev.trim() ? `${prev.trim()} · ${chip}` : chip))}
                  className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider border-2 border-line bg-surface text-ink-dim hover:border-accent hover:text-accent transition-colors"
                >
                  + {chip}
                </button>
              ))}
            </div>
```

- [ ] **Step 4: Verificar**

Run: `npm run lint` → sin errores. Run: `npm test` → verde.
Verificación visual con `preview_start`: en Biblioteca, "Agregar notas" en una pieza, guardar → aparece 📝 1; imprimir esa pieza → la casilla de nota permanente aparece marcada, los chips agregan texto, y la vista previa muestra la nota en el sello.

- [ ] **Step 5: Commit (solo con autorización)**

```bash
git add src/components/ToolcribNotesModal.tsx src/components/ToolcribLibraryPanel.tsx src/components/ToolcribPrintModal.tsx
git commit -m "feat(biblioteca): notas permanentes por pieza y chips de notas rapidas"
```

---

### Task 10: Presets de impresión

**Files:**
- Create: `src/lib/printPresets.ts`
- Test: `src/lib/__tests__/printPresets.test.ts`
- Modify: `src/components/ToolcribPrintModal.tsx`

**Interfaces:**
- Consumes: `PlanoOtPrintMode`, `PlanoOtHeaderStyle` de `./planoOt` (solo tipos).
- Produces (`src/lib/printPresets.ts`):
  - `type SetPrintMode = 'separadas' | 'unificado'`
  - `interface PrintPreset { id: string; nombre: string; modo: PlanoOtPrintMode; headerStyle: PlanoOtHeaderStyle; incluirNotasPermanentes: boolean; juego: SetPrintMode; builtin?: boolean }`
  - `const PRESETS_STORAGE_KEY = 'smv.printPresets.v1'`, `const BUILTIN_PRESETS: readonly PrintPreset[]`
  - `type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>`
  - `loadPresets(storage?: PresetStorage | null): PrintPreset[]`
  - `savePreset(input: Omit<PrintPreset, 'id' | 'builtin'>, storage?: PresetStorage | null): PrintPreset[]`
  - `deletePreset(id: string, storage?: PresetStorage | null): PrintPreset[]`

- [ ] **Step 1: Escribir la prueba que falla**

```ts
import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, deletePreset, loadPresets, PRESETS_STORAGE_KEY, savePreset, type PresetStorage } from '../printPresets';

function memoryStorage(initial: Record<string, string> = {}): PresetStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
  };
}

const input = { nombre: 'Mi preset', modo: 'blueprint' as const, headerStyle: 'classic' as const, incluirNotasPermanentes: false, juego: 'unificado' as const };

describe('printPresets', () => {
  it('sin storage o vacío devuelve los 3 de fábrica', () => {
    expect(loadPresets(null).map((p) => p.nombre)).toEqual(['OT estándar', 'Solo pizarrón', 'Plano limpio']);
    expect(loadPresets(memoryStorage())).toHaveLength(BUILTIN_PRESETS.length);
  });

  it('el defecto de juego es una impresión por pieza', () => {
    expect(BUILTIN_PRESETS.every((p) => p.juego === 'separadas')).toBe(true);
  });

  it('guarda un preset propio y lo vuelve a cargar', () => {
    const storage = memoryStorage();
    const after = savePreset(input, storage);
    expect(after.at(-1)?.nombre).toBe('Mi preset');
    expect(loadPresets(storage).at(-1)?.juego).toBe('unificado');
  });

  it('guardar con el mismo nombre reemplaza en vez de duplicar', () => {
    const storage = memoryStorage();
    savePreset(input, storage);
    const after = savePreset({ ...input, nombre: 'mi PRESET', modo: 'both' }, storage);
    expect(after.filter((p) => !p.builtin)).toHaveLength(1);
    expect(after.at(-1)?.modo).toBe('both');
  });

  it('borra propios pero nunca los de fábrica', () => {
    const storage = memoryStorage();
    const saved = savePreset(input, storage).at(-1);
    expect(deletePreset(saved.id, storage).some((p) => p.id === saved.id)).toBe(false);
    expect(deletePreset(BUILTIN_PRESETS[0].id, storage)).toHaveLength(BUILTIN_PRESETS.length);
  });

  it('JSON corrupto o entradas inválidas caen a los de fábrica', () => {
    expect(loadPresets(memoryStorage({ [PRESETS_STORAGE_KEY]: '{no es json' }))).toHaveLength(BUILTIN_PRESETS.length);
    const bad = memoryStorage({ [PRESETS_STORAGE_KEY]: JSON.stringify([{ id: 'x', nombre: '', modo: 'raro' }, 7]) });
    expect(loadPresets(bad)).toHaveLength(BUILTIN_PRESETS.length);
  });

  it('un storage que lanza no rompe nada', () => {
    const throwing: PresetStorage = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    expect(loadPresets(throwing)).toHaveLength(BUILTIN_PRESETS.length);
    expect(() => savePreset(input, throwing)).not.toThrow();
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/lib/__tests__/printPresets.test.ts`
Expected: FAIL (`Cannot find module '../printPresets'`).

- [ ] **Step 3: Implementar `src/lib/printPresets.ts`**

```ts
/** Presets de impresión de OT guardados en localStorage (por navegador). */

import type { PlanoOtHeaderStyle, PlanoOtPrintMode } from './planoOt';

export type SetPrintMode = 'separadas' | 'unificado';

export interface PrintPreset {
  id: string;
  nombre: string;
  modo: PlanoOtPrintMode;
  headerStyle: PlanoOtHeaderStyle;
  incluirNotasPermanentes: boolean;
  juego: SetPrintMode;
  builtin?: boolean;
}

export const PRESETS_STORAGE_KEY = 'smv.printPresets.v1';
export type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const BUILTIN_PRESETS: readonly PrintPreset[] = [
  { id: 'builtin-estandar', nombre: 'OT estándar', modo: 'both', headerStyle: 'slim', incluirNotasPermanentes: true, juego: 'separadas', builtin: true },
  { id: 'builtin-pizarron', nombre: 'Solo pizarrón', modo: 'board_ticket', headerStyle: 'slim', incluirNotasPermanentes: true, juego: 'separadas', builtin: true },
  { id: 'builtin-limpio', nombre: 'Plano limpio', modo: 'blueprint', headerStyle: 'slim', incluirNotasPermanentes: false, juego: 'separadas', builtin: true },
];

const MODES: readonly PlanoOtPrintMode[] = ['blueprint', 'board_ticket', 'both'];
const HEADERS: readonly PlanoOtHeaderStyle[] = ['slim', 'classic'];
const SET_MODES: readonly SetPrintMode[] = ['separadas', 'unificado'];

function defaultStorage(): PresetStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function parseCustom(storage: PresetStorage | null): PrintPreset[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: PrintPreset[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const p = item as Record<string, unknown>;
      const nombre = typeof p.nombre === 'string' ? p.nombre.trim().slice(0, 40) : '';
      if (!nombre || typeof p.id !== 'string' || !p.id) continue;
      if (!MODES.includes(p.modo as PlanoOtPrintMode) || !HEADERS.includes(p.headerStyle as PlanoOtHeaderStyle) || !SET_MODES.includes(p.juego as SetPrintMode)) continue;
      out.push({
        id: p.id,
        nombre,
        modo: p.modo as PlanoOtPrintMode,
        headerStyle: p.headerStyle as PlanoOtHeaderStyle,
        incluirNotasPermanentes: p.incluirNotasPermanentes !== false,
        juego: p.juego as SetPrintMode,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function persist(custom: PrintPreset[], storage: PresetStorage | null): void {
  if (!storage) return;
  try {
    storage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(custom));
  } catch {
    /* storage bloqueado: el preset vive solo esta sesión */
  }
}

export function loadPresets(storage: PresetStorage | null = defaultStorage()): PrintPreset[] {
  return [...BUILTIN_PRESETS, ...parseCustom(storage)];
}

export function savePreset(input: Omit<PrintPreset, 'id' | 'builtin'>, storage: PresetStorage | null = defaultStorage()): PrintPreset[] {
  const nombre = input.nombre.trim().slice(0, 40);
  const custom = parseCustom(storage).filter((p) => p.nombre.toLowerCase() !== nombre.toLowerCase());
  custom.push({ ...input, nombre, id: `custom-${Date.now().toString(36)}` });
  persist(custom, storage);
  return [...BUILTIN_PRESETS, ...custom];
}

export function deletePreset(id: string, storage: PresetStorage | null = defaultStorage()): PrintPreset[] {
  const custom = parseCustom(storage).filter((p) => p.id !== id);
  persist(custom, storage);
  return [...BUILTIN_PRESETS, ...custom];
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run src/lib/__tests__/printPresets.test.ts` → PASS. Si `saved.id` da error de tipos por `undefined` en la prueba, no importa: el proyecto no usa `strictNullChecks`.

- [ ] **Step 5: Selector de presets en el modal**

En `ToolcribPrintModal.tsx` agrega imports:

```tsx
import { deletePreset, loadPresets, savePreset, type PrintPreset } from '../lib/printPresets';
```

Estado (junto a los demás):

```tsx
  const [presets, setPresets] = useState<PrintPreset[]>(() => loadPresets());
  const [presetId, setPresetId] = useState('builtin-estandar');
  const [incluirNotasPermanentes, setIncluirNotasPermanentes] = useState(true);
  const [presetName, setPresetName] = useState('');
```

Aplicar un preset:

```tsx
  const applyPreset = (id: string) => {
    setPresetId(id);
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setPrintMode(preset.modo);
    setHeaderStyle(preset.headerStyle);
    setJuegoMode(preset.juego);
    setIncluirNotasPermanentes(preset.incluirNotasPermanentes);
    // Las notas permanentes marcadas por defecto siguen al preset.
    setEnabledNoteIds(new Set(preset.incluirNotasPermanentes ? ownNotes.filter((n) => n.imprimirEnOT).map((n) => n.id) : []));
  };

  const handleSavePreset = () => {
    const nombre = presetName.trim();
    if (!nombre) return;
    const next = savePreset({ nombre, modo: printMode, headerStyle, incluirNotasPermanentes, juego: juegoMode });
    setPresets(next);
    setPresetId(next.at(-1)?.id ?? presetId);
    setPresetName('');
  };

  const handleDeletePreset = () => {
    const current = presets.find((p) => p.id === presetId);
    if (!current || current.builtin) return;
    setPresets(deletePreset(current.id));
    applyPreset('builtin-estandar');
  };
```

JSX, al inicio del bloque de campos (justo antes de las sugerencias de Odoo, dentro de la rama `: <> …`):

```tsx
          <div className="space-y-1.5 border-2 border-line bg-surface-2 p-2" role="group" aria-label="Presets de impresión">
            <div className="flex items-center gap-2">
              <label htmlFor="print-preset" className="text-[10px] font-black uppercase tracking-widest text-ink-dim">Preset</label>
              <select id="print-preset" value={presetId} onChange={(e) => applyPreset(e.target.value)} disabled={isProcessing} className="flex-1 h-8 border-2 border-line bg-surface text-[11px] font-mono px-2 rounded-none">
                {presets.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              {!presets.find((p) => p.id === presetId)?.builtin && (
                <button type="button" onClick={handleDeletePreset} className="text-[9px] font-mono text-danger hover:underline uppercase">Borrar</button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label="Nombre del nuevo preset" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Guardar la configuración actual como…" disabled={isProcessing} className="rounded-none border-2 border-line bg-surface h-8 text-[11px] font-mono" />
              <button type="button" onClick={handleSavePreset} disabled={!presetName.trim() || isProcessing} className="px-2 h-8 border-2 border-line text-[10px] font-black uppercase hover:border-accent hover:text-accent disabled:opacity-40">Guardar</button>
            </div>
            {companions.length > 0 && (
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="font-black uppercase tracking-widest text-ink-dim">Juego</span>
                {(['separadas', 'unificado'] as const).map((mode) => (
                  <button key={mode} type="button" aria-pressed={juegoMode === mode} onClick={() => setJuegoMode(mode)} disabled={isProcessing} className={`px-2 py-0.5 border-2 uppercase font-bold ${juegoMode === mode ? 'border-accent bg-accent/10 text-accent' : 'border-line text-ink-dim'}`}>
                    {mode === 'separadas' ? 'Una OT por pieza' : 'Un solo PDF'}
                  </button>
                ))}
              </div>
            )}
          </div>
```

Al abrir el modal, aplica el preset seleccionado: en el efecto que reinicia estado al abrir (línea ~94, cuando `drawing` es no nulo), no reinicies el preset elegido (persiste mientras el componente vive). En el efecto de notas de Task 9, cambia la línea que arma `enabledNoteIds` para respetar el preset:

```tsx
      setEnabledNoteIds(new Set(incluirNotasPermanentes ? own.filter((n) => n.imprimirEnOT).map((n) => n.id) : []));
```

- [ ] **Step 6: Verificar**

Run: `npm run lint` → sin errores. Run: `npm test` → verde.
Verificación visual con `preview_start`: en el modal cambia a "Solo pizarrón" → el formato de impresión cambia a "Solo Ficha Pizarrón"; escribe un nombre, "Guardar", recarga la página, y el preset propio sigue en la lista; "Borrar" lo quita. Sin errores en `read_console_messages`.

- [ ] **Step 7: Commit (solo con autorización)**

```bash
git add src/lib/printPresets.ts src/lib/__tests__/printPresets.test.ts src/components/ToolcribPrintModal.tsx
git commit -m "feat(ot): presets de impresion guardados en el navegador"
```

---

### Task 11: Documentación, verificación final y deploy de reglas

**Files:**
- Modify: `CLAUDE.md`, `AGENTS.md`

- [ ] **Step 1: Documentar las colecciones nuevas**

En la tabla "Firestore collections" de `CLAUDE.md` agrega dos filas:

```
| `toolcribSets` | Juegos (pares/hojas/complementos) guardados por el operador (`nombre`, `tipo`, `miembros[{partNumber, rol, orden, cantidadPorJuego}]`); ganan sobre `KNOWN_RULES` de `companionDrawings.ts` |
| `toolcribPartNotes` | Notas permanentes por pieza (`partNumber`, `notas[{id, texto, imprimirEnOT}]`) |
```

Y en la sección de la Biblioteca/impresión agrega una línea: "Impresión de juegos: por defecto una OT por pieza (`buildSeparatePrintJobs` en `src/lib/setPrintJobs.ts`); presets en localStorage (`src/lib/printPresets.ts`)." Repite el cambio en `AGENTS.md` si ahí existe la misma tabla (búscala con Grep por `partAliases` o `analysisRuns`).

- [ ] **Step 2: Verificación completa**

Run: `npm test` → todo verde.
Run: `npm run lint` → sin errores.
Run: `npm run build` → build correcto.
Run: `npm run test:rules` → verde (requiere Java).

- [ ] **Step 3: Recorrido manual en el navegador**

Con `preview_start`: (1) Biblioteca muestra insignias y filtro; (2) vincular un par nuevo y ver la insignia `PAR 1/2`; (3) agregar una nota permanente y verla precargada al imprimir; (4) imprimir un juego con "Una OT por pieza" y confirmar cantidades y sellos por pieza; (5) guardar un preset y recargar. Reporta a Emiliano qué se verificó y qué no.

- [ ] **Step 4: Deploy de reglas (solo con autorización de Emiliano)**

```bash
firebase deploy --only firestore:rules --project smv-brain
```

Verifica en la salida que diga `released rules firestore.rules to cloud.firestore` y que **no** se desplieguen functions. Sin este paso las colecciones nuevas dan "permission denied" en producción y la app degrada a las reglas fijas.

- [ ] **Step 5: Commit (solo con autorización)**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: colecciones de juegos y notas permanentes"
```

---

## Self-Review

**Cobertura del spec:** §1 juegos → Tasks 1-5 (datos, lógica, reglas, insignia, filtro, vincular, sugerencias, cantidad por juego); §2 notas → Tasks 8-9 (colección, límites, ícono, casillas en modal, chips); §3 presets → Task 10 (fábrica, guardar, borrar, storage roto); §4 impresión separada → Tasks 6-7 (una OT por pieza, lista con botón por pieza como respaldo del bloqueo de pestañas, `unificado` conservado, lote respeta juegos vía almacén en memoria); §5 reglas y pruebas de emulador → Task 3; §6 degradación → `ensureActiveSets` no lanza, `resolve` cae a reglas fijas, notas vacías si falla; §7 pruebas → cada Task de lógica trae las suyas; §8 fases → orden de Tasks. Desviación consciente del spec: el validador de juegos vive en `src/lib/toolcribSets.ts` (`normalizeSet`) y no en un archivo aparte en `firebase/`, para que sea puro y testeable sin Firebase; el de notas en `src/lib/partNotes.ts` por la misma razón.

**Placeholders:** ninguno; los cambios al panel grande usan anclas de línea reales y código completo. Las líneas exactas pueden desplazarse unas posiciones tras los primeros cambios: usar Grep por el texto ancla.

**Consistencia de tipos:** `ToolcribSet`/`ToolcribSetMember` (Task 1) se usan igual en Tasks 2-5; `CompanionInfo.cantidadPorJuego` (Task 1) lo consume el modal (Task 7); `SetPrintPiece.permanentNotes: string[]` (Task 6) se llena en Task 9; `composeOtNotes(texts, corrida)` (Task 8) coincide con la unión local `joinNotes` de Task 6; `PrintPreset.juego` usa `SetPrintMode` que coincide con `juegoMode` de Task 7.
