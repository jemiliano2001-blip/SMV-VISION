# useVisionAnalysis Decomposition + Vitest Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraer helpers puros de `useVisionAnalysis.ts` a módulos de lib, cubrir todas las funciones puras con Vitest, y dividir el hook en cuatro sub-hooks enfocados, sin cambiar la interfaz pública `VisionAnalysisHook`.

**Architecture:** Bottom-up: Fase 1 extrae helpers → Fase 2 configura Vitest y escribe tests → Fase 3 divide el hook en sub-hooks que usan las libs ya testeadas. `App.tsx` no se toca en ninguna fase.

**Tech Stack:** React 19, TypeScript 5.8, Vitest 3, Vite 6, `@google/genai`, Firebase, `idb-keyval`

---

## Mapa de archivos

### Fase 1 — Nuevos módulos lib
| Acción | Ruta |
|--------|------|
| Crear | `src/lib/gemini.ts` |
| Crear | `src/lib/blueprintParsers.ts` |
| Crear | `src/lib/imageProcessing.ts` |
| Crear | `src/lib/fileUtils.ts` |
| Crear | `src/lib/metricsBaseline.ts` |
| Modificar | `src/hooks/useVisionAnalysis.ts` |

### Fase 2 — Tests
| Acción | Ruta |
|--------|------|
| Modificar | `vite.config.ts` |
| Modificar | `package.json` |
| Crear | `src/lib/__tests__/age.test.ts` |
| Crear | `src/lib/__tests__/fileUtils.test.ts` |
| Crear | `src/lib/__tests__/gemini.test.ts` |
| Crear | `src/lib/__tests__/blueprintParsers.test.ts` |
| Crear | `src/lib/__tests__/imageProcessing.test.ts` |
| Crear | `src/lib/__tests__/metricsBaseline.test.ts` |
| Crear | `src/lib/__tests__/hotStamp.test.ts` |
| Crear | `src/lib/__tests__/orderMerge.test.ts` |
| Crear | `src/lib/__tests__/reportFormat.test.ts` |
| Crear | `src/lib/workOrders/__tests__/dedupe.test.ts` |
| Crear | `src/lib/workOrders/__tests__/metrics.test.ts` |
| Crear | `src/lib/__tests__/matching.test.ts` |

### Fase 3 — Sub-hooks
| Acción | Ruta |
|--------|------|
| Crear | `src/hooks/useFileIngestion.ts` |
| Crear | `src/hooks/useResultsDisplay.ts` |
| Crear | `src/hooks/useEditMode.ts` |
| Crear | `src/hooks/useAnalysisPipeline.ts` |
| Reemplazar | `src/hooks/useVisionAnalysis.ts` |

---

## FASE 1 — Extracción de helpers puros

---

### Task 1: Configurar Vitest

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json`

- [ ] **Instalar Vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Agregar referencia de tipos y bloque `test` a `vite.config.ts`**

Añadir `/// <reference types="vitest" />` en la primera línea del archivo y el bloque `test:` dentro del objeto retornado:

```ts
/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite';
// ... resto de imports sin cambio ...

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: { /* sin cambio */ },
    resolve: { /* sin cambio */ },
    server: { /* sin cambio */ },
    build: { /* sin cambio */ },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
```

- [ ] **Agregar scripts de test a `package.json`**

```json
"scripts": {
  "dev": "vite --port=3000 --host=0.0.0.0",
  "build": "vite build",
  "preview": "vite preview",
  "clean": "rm -rf dist",
  "lint": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "toolcrib:bootstrap": "tsx scripts/toolcribBootstrap.ts"
}
```

- [ ] **Verificar que Vitest arranca (sin tests aún)**

```bash
npm test
```

Salida esperada: `No test files found` o 0 tests pasados sin errores.

- [ ] **Commit**

```bash
git add vite.config.ts package.json package-lock.json
git commit -m "chore: add Vitest to project"
```

---

### Task 2: Extraer `src/lib/gemini.ts`

**Files:**
- Create: `src/lib/gemini.ts`
- Modify: `src/hooks/useVisionAnalysis.ts`

- [ ] **Crear `src/lib/gemini.ts`** con las tres funciones que estaban al inicio de `useVisionAnalysis.ts`:

```ts
/**
 * Utilidades de bajo nivel para la API de Gemini.
 *
 * callWithRetry: reintentos con backoff exponencial (1 s / 2 s).
 * preparePdfPart / prepareImagePart: construyen el objeto inlineData
 *   que espera @google/genai para PDFs e imágenes JPEG.
 */

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts - 1) {
        await new Promise<void>((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export function preparePdfPart(dataUrl: string): {
  inlineData: { mimeType: string; data: string };
} {
  const base64Data = dataUrl.split(';base64,')[1];
  return { inlineData: { mimeType: 'application/pdf', data: base64Data } };
}

export function prepareImagePart(dataUrl: string): {
  inlineData: { mimeType: string; data: string };
} {
  const base64Data = dataUrl.split(';base64,')[1];
  return { inlineData: { mimeType: 'image/jpeg', data: base64Data } };
}
```

- [ ] **Actualizar `useVisionAnalysis.ts`**: eliminar las tres funciones del archivo y agregar el import:

```ts
import { callWithRetry, preparePdfPart, prepareImagePart } from '../lib/gemini';
```

- [ ] **Verificar que TypeScript no reporta errores**

```bash
npm run lint
```

Salida esperada: sin errores.

- [ ] **Commit**

```bash
git add src/lib/gemini.ts src/hooks/useVisionAnalysis.ts
git commit -m "refactor: extract callWithRetry and Gemini part helpers to lib/gemini.ts"
```

---

### Task 3: Extraer `src/lib/blueprintParsers.ts`

**Files:**
- Create: `src/lib/blueprintParsers.ts`
- Modify: `src/hooks/useVisionAnalysis.ts`

- [ ] **Crear `src/lib/blueprintParsers.ts`**:

```ts
/**
 * Parseo y validación de respuestas de Gemini Vision para blueprints.
 *
 * parseBoundingBox: convierte un array desconocido a BoundingBox tipada.
 * parseBlueprintResponse: parsea el JSON de Gemini a BlueprintSpec[].
 */

import type { BlueprintSpec, BoundingBox } from '../types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseBoundingBox(value: unknown): BoundingBox | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }
  const nums = value.map((entry) =>
    typeof entry === 'number' ? entry : Number.NaN,
  );
  if (nums.some((n) => Number.isNaN(n))) {
    return null;
  }
  return [nums[0], nums[1], nums[2], nums[3]];
}

export function parseBlueprintResponse(text: string): BlueprintSpec[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter(isRecord)
    .map((item) => {
      const piece = asString(item.pieza_detectada);
      const box = parseBoundingBox(item.isometricBoundingBox);
      if (!piece || !box) return null;
      return { pieza_detectada: piece, isometricBoundingBox: box } satisfies BlueprintSpec;
    })
    .filter((item): item is BlueprintSpec => item !== null);
}
```

- [ ] **Actualizar `useVisionAnalysis.ts`**: eliminar `isRecord`, `asString`, `parseBoundingBox`, `parseBlueprintResponse` y agregar el import:

```ts
import {
  isRecord,
  asString,
  parseBoundingBox,
  parseBlueprintResponse,
} from '../lib/blueprintParsers';
```

> Nota: `isRecord` y `asString` también existen en `orderMerge.ts` como funciones privadas — son copias independientes. No consolidar ahora.

- [ ] **Verificar**

```bash
npm run lint
```

- [ ] **Commit**

```bash
git add src/lib/blueprintParsers.ts src/hooks/useVisionAnalysis.ts
git commit -m "refactor: extract blueprint response parsers to lib/blueprintParsers.ts"
```

---

### Task 4: Extraer `src/lib/imageProcessing.ts`

**Files:**
- Create: `src/lib/imageProcessing.ts`
- Modify: `src/hooks/useVisionAnalysis.ts`

- [ ] **Crear `src/lib/imageProcessing.ts`**:

```ts
/**
 * Manipulación de imágenes para el pipeline de blueprints.
 *
 * isValidBoundingBox: validación pura (testeable en Node).
 * cropIsometricView / cropToBoxRaw: requieren Canvas del browser (no testeables
 *   en Node sin jsdom — deuda técnica documentada).
 */

export function isValidBoundingBox(box?: number[]): box is number[] {
  if (!box || box.length !== 4) return false;
  const [ymin, xmin, ymax, xmax] = box;
  if (![ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) return false;
  const width = xmax - xmin;
  const height = ymax - ymin;
  if (width <= 50 || height <= 50) return false;   // < 5% of the 0-1000 grid
  if (width * height > 750 * 750) return false;    // > ~56% area
  if (Math.min(width, height) / Math.max(width, height) < 0.25) return false; // sliver
  return true;
}

export function cropIsometricView(base64: string, box: number[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const padding = 12;
      const [ymin, xmin, ymax, xmax] = box;
      const x = Math.max(0, (xmin / 1000) * img.width - padding);
      const y = Math.max(0, (ymin / 1000) * img.height - padding);
      const width = Math.min(img.width - x, ((xmax - xmin) / 1000) * img.width + padding * 2);
      const height = Math.min(img.height - y, ((ymax - ymin) / 1000) * img.height + padding * 2);

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = width;
      cropCanvas.height = height;
      const cropCtx = cropCanvas.getContext('2d')!;
      cropCtx.fillStyle = '#FFFFFF';
      cropCtx.fillRect(0, 0, width, height);
      cropCtx.drawImage(img, x, y, width, height, 0, 0, width, height);

      const side = Math.ceil(Math.max(width, height));
      const squareCanvas = document.createElement('canvas');
      squareCanvas.width = side;
      squareCanvas.height = side;
      const squareCtx = squareCanvas.getContext('2d')!;
      squareCtx.fillStyle = '#FFFFFF';
      squareCtx.fillRect(0, 0, side, side);
      squareCtx.drawImage(
        cropCanvas,
        0, 0, width, height,
        Math.floor((side - width) / 2), Math.floor((side - height) / 2), width, height,
      );
      resolve(squareCanvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () =>
      reject(new Error('No se pudo cargar la imagen para recortar la vista isométrica.'));
    img.src = base64;
  });
}

export function cropToBoxRaw(base64: string, box: number[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [ymin, xmin, ymax, xmax] = box;
      const x = Math.max(0, (xmin / 1000) * img.width);
      const y = Math.max(0, (ymin / 1000) * img.height);
      const width = Math.min(img.width - x, ((xmax - xmin) / 1000) * img.width);
      const height = Math.min(img.height - y, ((ymax - ymin) / 1000) * img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(width));
      canvas.height = Math.max(1, Math.floor(height));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, x, y, width, height, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () =>
      reject(new Error('No se pudo cargar la imagen para el refinamiento del bounding box.'));
    img.src = base64;
  });
}
```

- [ ] **Actualizar `useVisionAnalysis.ts`**: eliminar las tres funciones y agregar:

```ts
import {
  isValidBoundingBox,
  cropIsometricView,
  cropToBoxRaw,
} from '../lib/imageProcessing';
```

- [ ] **Verificar**

```bash
npm run lint
```

- [ ] **Commit**

```bash
git add src/lib/imageProcessing.ts src/hooks/useVisionAnalysis.ts
git commit -m "refactor: extract image processing helpers to lib/imageProcessing.ts"
```

---

### Task 5: Extraer `src/lib/fileUtils.ts`

**Files:**
- Create: `src/lib/fileUtils.ts`
- Modify: `src/hooks/useVisionAnalysis.ts`

- [ ] **Crear `src/lib/fileUtils.ts`**:

```ts
/**
 * Utilidades de archivos del browser.
 *
 * isPdfFile: pura, testeable en Node.
 * readFileAsDataUrl: usa FileReader (DOM), no testeable sin jsdom.
 */

export function isPdfFile(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  if (mimeType === 'application/pdf') return true;
  return file.name.toLowerCase().endsWith('.pdf');
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error(`No fue posible leer ${file.name}.`));
    };
    reader.onerror = () =>
      reject(new Error(`No fue posible leer ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
```

- [ ] **Actualizar `useVisionAnalysis.ts`**: eliminar ambas funciones y agregar:

```ts
import { isPdfFile, readFileAsDataUrl } from '../lib/fileUtils';
```

- [ ] **Verificar**

```bash
npm run lint
```

- [ ] **Commit**

```bash
git add src/lib/fileUtils.ts src/hooks/useVisionAnalysis.ts
git commit -m "refactor: extract file utilities to lib/fileUtils.ts"
```

---

### Task 6: Extraer `src/lib/metricsBaseline.ts`

**Files:**
- Create: `src/lib/metricsBaseline.ts`
- Modify: `src/hooks/useVisionAnalysis.ts`

- [ ] **Crear `src/lib/metricsBaseline.ts`**:

```ts
/**
 * Baseline de métricas de análisis, persistido en localStorage.
 *
 * La primera corrida establece la baseline. Las siguientes calculan el delta
 * porcentual respecto a ella. Permite mostrar "mejoró X%" en la UI.
 */

import type { AnalysisMetrics } from '../types';

export interface MetricsComparison {
  baseline: AnalysisMetrics;
  latest: AnalysisMetrics;
  totalImprovementPct: number;
}

const METRICS_BASELINE_KEY = 'smvVisionMetricsBaselineV2';

export function readBaselineMetrics(): AnalysisMetrics | null {
  const raw = localStorage.getItem(METRICS_BASELINE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnalysisMetrics;
  } catch {
    localStorage.removeItem(METRICS_BASELINE_KEY);
    return null;
  }
}

export function calculateMetricsComparison(
  latest: AnalysisMetrics,
): MetricsComparison {
  const baseline = readBaselineMetrics();
  if (!baseline) {
    localStorage.setItem(METRICS_BASELINE_KEY, JSON.stringify(latest));
    return { baseline: latest, latest, totalImprovementPct: 0 };
  }
  const improvement =
    baseline.totalMs > 0
      ? ((baseline.totalMs - latest.totalMs) / baseline.totalMs) * 100
      : 0;
  return { baseline, latest, totalImprovementPct: improvement };
}
```

- [ ] **Actualizar `useVisionAnalysis.ts`**: eliminar la interfaz `MetricsComparison`, la constante `METRICS_BASELINE_KEY`, y ambas funciones. Agregar:

```ts
import {
  type MetricsComparison,
  readBaselineMetrics,
  calculateMetricsComparison,
} from '../lib/metricsBaseline';
```

- [ ] **Verificar**

```bash
npm run lint
```

- [ ] **Commit**

```bash
git add src/lib/metricsBaseline.ts src/hooks/useVisionAnalysis.ts
git commit -m "refactor: extract metrics baseline helpers to lib/metricsBaseline.ts"
```

---

## FASE 2 — Tests

---

### Task 7: Tests para `age.ts`

**Files:**
- Create: `src/lib/__tests__/age.test.ts`

- [ ] **Crear `src/lib/__tests__/age.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { parseDateToISO, addDaysToISODate, daysUntilISODate, formatAgeDays } from '../age';

describe('parseDateToISO', () => {
  it('parsea DD/MM/YYYY', () => {
    expect(parseDateToISO('15/06/2025')).toBe('2025-06-15');
  });
  it('parsea DD-MM-YYYY', () => {
    expect(parseDateToISO('01-03-2024')).toBe('2024-03-01');
  });
  it('acepta formato ISO YYYY-MM-DD sin cambio', () => {
    expect(parseDateToISO('2025-12-31')).toBe('2025-12-31');
  });
  it('devuelve null para formato desconocido', () => {
    expect(parseDateToISO('2025/06/15')).toBeNull();
    expect(parseDateToISO('')).toBeNull();
    expect(parseDateToISO('no-es-fecha')).toBeNull();
  });
  it('devuelve null para fecha con overflow (31/02)', () => {
    expect(parseDateToISO('31/02/2025')).toBeNull();
  });
  it('normaliza d/m/yyyy de un dígito', () => {
    expect(parseDateToISO('1/3/2024')).toBe('2024-03-01');
  });
});

describe('addDaysToISODate', () => {
  it('suma días positivos', () => {
    expect(addDaysToISODate('2025-06-01', 14)).toBe('2025-06-15');
  });
  it('cruza fin de mes', () => {
    expect(addDaysToISODate('2025-01-28', 5)).toBe('2025-02-02');
  });
  it('suma días negativos (retrocede)', () => {
    expect(addDaysToISODate('2025-06-15', -5)).toBe('2025-06-10');
  });
  it('devuelve null para formato inválido', () => {
    expect(addDaysToISODate('15/06/2025', 5)).toBeNull();
    expect(addDaysToISODate('', 5)).toBeNull();
  });
});

describe('daysUntilISODate', () => {
  it('devuelve 0 para hoy', () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(daysUntilISODate(iso)).toBe(0);
  });
  it('devuelve positivo para fecha futura', () => {
    const future = addDaysToISODate(
      new Date().toISOString().split('T')[0],
      7,
    )!;
    expect(daysUntilISODate(future)).toBe(7);
  });
  it('devuelve negativo para fecha pasada', () => {
    expect(daysUntilISODate('2020-01-01')).toBeLessThan(0);
  });
  it('devuelve null para formato inválido', () => {
    expect(daysUntilISODate('15/06/2025')).toBeNull();
    expect(daysUntilISODate('')).toBeNull();
  });
});

describe('formatAgeDays', () => {
  it('formatea 0 como "Hoy"', () => {
    expect(formatAgeDays(0)).toBe('Hoy');
  });
  it('formatea 1 como "1 día"', () => {
    expect(formatAgeDays(1)).toBe('1 día');
  });
  it('formatea N>1 como "N días"', () => {
    expect(formatAgeDays(5)).toBe('5 días');
  });
});
```

- [ ] **Ejecutar y verificar que pasan**

```bash
npm test -- src/lib/__tests__/age.test.ts
```

Salida esperada: todos los tests en verde.

- [ ] **Commit**

```bash
git add src/lib/__tests__/age.test.ts
git commit -m "test: add unit tests for lib/age.ts"
```

---

### Task 8: Tests para `fileUtils.ts`

**Files:**
- Create: `src/lib/__tests__/fileUtils.test.ts`

- [ ] **Crear `src/lib/__tests__/fileUtils.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { isPdfFile } from '../fileUtils';

// readFileAsDataUrl usa FileReader (DOM) — no se prueba en ambiente node.

function makeFile(name: string, type: string): File {
  return { name, type } as unknown as File;
}

describe('isPdfFile', () => {
  it('detecta por MIME application/pdf', () => {
    expect(isPdfFile(makeFile('doc.pdf', 'application/pdf'))).toBe(true);
  });
  it('detecta por extensión .pdf aunque MIME sea vacío', () => {
    expect(isPdfFile(makeFile('plano.pdf', ''))).toBe(true);
  });
  it('es insensible a mayúsculas en el MIME', () => {
    expect(isPdfFile(makeFile('x.pdf', 'APPLICATION/PDF'))).toBe(true);
  });
  it('rechaza archivos que no son PDF', () => {
    expect(isPdfFile(makeFile('imagen.png', 'image/png'))).toBe(false);
    expect(isPdfFile(makeFile('datos.xlsx', 'application/vnd.openxmlformats'))).toBe(false);
  });
  it('rechaza archivo sin extensión PDF y sin MIME', () => {
    expect(isPdfFile(makeFile('archivo', ''))).toBe(false);
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/__tests__/fileUtils.test.ts
```

- [ ] **Commit**

```bash
git add src/lib/__tests__/fileUtils.test.ts
git commit -m "test: add unit tests for lib/fileUtils.ts"
```

---

### Task 9: Tests para `gemini.ts`

**Files:**
- Create: `src/lib/__tests__/gemini.test.ts`

- [ ] **Crear `src/lib/__tests__/gemini.test.ts`**:

```ts
import { describe, it, expect, vi } from 'vitest';
import { callWithRetry, preparePdfPart, prepareImagePart } from '../gemini';

describe('preparePdfPart', () => {
  it('extrae el base64 del dataURL y establece mimeType pdf', () => {
    const dataUrl = 'data:application/pdf;base64,JVBERi0xLjQ=';
    const part = preparePdfPart(dataUrl);
    expect(part.inlineData.mimeType).toBe('application/pdf');
    expect(part.inlineData.data).toBe('JVBERi0xLjQ=');
  });
});

describe('prepareImagePart', () => {
  it('extrae el base64 del dataURL y establece mimeType jpeg', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const part = prepareImagePart(dataUrl);
    expect(part.inlineData.mimeType).toBe('image/jpeg');
    expect(part.inlineData.data).toBe('/9j/4AAQSkZJRg==');
  });
});

describe('callWithRetry', () => {
  it('devuelve el resultado en el primer intento sin reintentos', async () => {
    const fn = vi.fn().mockResolvedValueOnce('ok');
    const result = await callWithRetry(fn, 3);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reintenta si el primer intento falla y tiene éxito en el segundo', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('recovered');

    const promise = callWithRetry(fn, 3);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('lanza el último error después de agotar todos los intentos', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('API down'));

    const promise = callWithRetry(fn, 3);
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('API down');
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/__tests__/gemini.test.ts
```

- [ ] **Commit**

```bash
git add src/lib/__tests__/gemini.test.ts
git commit -m "test: add unit tests for lib/gemini.ts"
```

---

### Task 10: Tests para `blueprintParsers.ts`

**Files:**
- Create: `src/lib/__tests__/blueprintParsers.test.ts`

- [ ] **Crear `src/lib/__tests__/blueprintParsers.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { parseBoundingBox, parseBlueprintResponse } from '../blueprintParsers';

describe('parseBoundingBox', () => {
  it('parsea un array válido de 4 números', () => {
    expect(parseBoundingBox([100, 200, 800, 900])).toEqual([100, 200, 800, 900]);
  });
  it('devuelve null si no es array', () => {
    expect(parseBoundingBox('100,200,800,900')).toBeNull();
    expect(parseBoundingBox(null)).toBeNull();
  });
  it('devuelve null si el array tiene longitud distinta de 4', () => {
    expect(parseBoundingBox([100, 200, 800])).toBeNull();
    expect(parseBoundingBox([100, 200, 800, 900, 1000])).toBeNull();
  });
  it('devuelve null si algún elemento no es número', () => {
    expect(parseBoundingBox([100, '200', 800, 900])).toBeNull();
    expect(parseBoundingBox([100, null, 800, 900])).toBeNull();
  });
  it('devuelve null si algún elemento es NaN', () => {
    expect(parseBoundingBox([100, NaN, 800, 900])).toBeNull();
  });
});

describe('parseBlueprintResponse', () => {
  it('parsea un array válido con una spec', () => {
    const json = JSON.stringify([
      { pieza_detectada: 'HEX SWAGE BLOCK 7/32', isometricBoundingBox: [100, 200, 800, 900] },
    ]);
    const result = parseBlueprintResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0].pieza_detectada).toBe('HEX SWAGE BLOCK 7/32');
    expect(result[0].isometricBoundingBox).toEqual([100, 200, 800, 900]);
  });
  it('parsea múltiples specs', () => {
    const json = JSON.stringify([
      { pieza_detectada: 'PIEZA A', isometricBoundingBox: [0, 0, 500, 500] },
      { pieza_detectada: 'PIEZA B', isometricBoundingBox: [500, 0, 1000, 500] },
    ]);
    expect(parseBlueprintResponse(json)).toHaveLength(2);
  });
  it('filtra objetos con pieza_detectada vacía', () => {
    const json = JSON.stringify([
      { pieza_detectada: '', isometricBoundingBox: [100, 200, 800, 900] },
    ]);
    expect(parseBlueprintResponse(json)).toHaveLength(0);
  });
  it('filtra objetos con bounding box inválido', () => {
    const json = JSON.stringify([
      { pieza_detectada: 'PIEZA A', isometricBoundingBox: [100, 200] },
    ]);
    expect(parseBlueprintResponse(json)).toHaveLength(0);
  });
  it('devuelve [] si el texto no es un array JSON', () => {
    expect(parseBlueprintResponse(JSON.stringify({ error: true }))).toEqual([]);
  });
  it('lanza SyntaxError si el texto no es JSON válido', () => {
    expect(() => parseBlueprintResponse('no-json')).toThrow(SyntaxError);
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/__tests__/blueprintParsers.test.ts
```

- [ ] **Commit**

```bash
git add src/lib/__tests__/blueprintParsers.test.ts
git commit -m "test: add unit tests for lib/blueprintParsers.ts"
```

---

### Task 11: Tests para `imageProcessing.ts` (solo `isValidBoundingBox`)

**Files:**
- Create: `src/lib/__tests__/imageProcessing.test.ts`

> `cropIsometricView` y `cropToBoxRaw` usan Canvas/Image del browser y no se prueban en Node. Se documenta como deuda técnica.

- [ ] **Crear `src/lib/__tests__/imageProcessing.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { isValidBoundingBox } from '../imageProcessing';

// cropIsometricView y cropToBoxRaw requieren Canvas del browser (DOM).
// Deuda técnica: cubrirlos con Playwright o jsdom si se agrega.

describe('isValidBoundingBox', () => {
  it('acepta un box normal válido', () => {
    // 400×400 = área 160_000, ratio 1.0
    expect(isValidBoundingBox([100, 100, 500, 500])).toBe(true);
  });
  it('rechaza undefined o array vacío', () => {
    expect(isValidBoundingBox(undefined)).toBe(false);
    expect(isValidBoundingBox([])).toBe(false);
  });
  it('rechaza array con longitud distinta de 4', () => {
    expect(isValidBoundingBox([100, 100, 500])).toBe(false);
  });
  it('rechaza si algún valor no es finito', () => {
    expect(isValidBoundingBox([100, NaN, 500, 500])).toBe(false);
    expect(isValidBoundingBox([100, Infinity, 500, 500])).toBe(false);
  });
  it('rechaza width ≤ 50 (área < 5% del grid 0-1000)', () => {
    // width = 30
    expect(isValidBoundingBox([100, 100, 500, 130])).toBe(false);
  });
  it('rechaza height ≤ 50', () => {
    // height = 30
    expect(isValidBoundingBox([100, 100, 130, 500])).toBe(false);
  });
  it('rechaza área > 750×750 (~56% del grid)', () => {
    // 800×800 = 640_000 > 562_500
    expect(isValidBoundingBox([0, 0, 800, 800])).toBe(false);
  });
  it('rechaza sliver: lado corto < 25% del lado largo', () => {
    // width=600, height=100 → ratio 100/600 = 0.16 < 0.25
    expect(isValidBoundingBox([100, 100, 200, 700])).toBe(false);
  });
  it('acepta box cuadrado grande (750×750 exacto queda rechazado)', () => {
    // 750×750 = 562_500 que NO es > 562_500, así que pasa
    expect(isValidBoundingBox([0, 0, 750, 750])).toBe(false); // 750*750 = 562500 = límite, >, falso
  });
  it('acepta box rectangular con ratio > 0.25', () => {
    // 300×100 = ratio 100/300 ≈ 0.33 ✓
    expect(isValidBoundingBox([100, 100, 200, 400])).toBe(true);
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/__tests__/imageProcessing.test.ts
```

- [ ] **Commit**

```bash
git add src/lib/__tests__/imageProcessing.test.ts
git commit -m "test: add unit tests for lib/imageProcessing.ts (isValidBoundingBox)"
```

---

### Task 12: Tests para `metricsBaseline.ts`

**Files:**
- Create: `src/lib/__tests__/metricsBaseline.test.ts`

- [ ] **Crear `src/lib/__tests__/metricsBaseline.test.ts`**:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readBaselineMetrics, calculateMetricsComparison } from '../metricsBaseline';
import type { AnalysisMetrics } from '../../types';

// localStorage no existe en ambiente node — se stubea con vi.stubGlobal.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem:    (key: string) => store[key] ?? null,
    setItem:    (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear:      () => { store = {}; },
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

const BASELINE_KEY = 'smvVisionMetricsBaselineV2';

const sample: AnalysisMetrics = {
  totalMs: 10_000,
  pdfRasterMs: 2_000,
  aiOrderMs: 3_000,
  aiBlueprintMs: 4_000,
  mergeMs: 1_000,
};

beforeEach(() => {
  localStorage.clear();
});

describe('readBaselineMetrics', () => {
  it('devuelve null cuando no hay baseline', () => {
    expect(readBaselineMetrics()).toBeNull();
  });
  it('devuelve el objeto parseado cuando existe', () => {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(sample));
    expect(readBaselineMetrics()).toEqual(sample);
  });
  it('limpia la clave y devuelve null si el JSON está corrupto', () => {
    localStorage.setItem(BASELINE_KEY, 'no-es-json{');
    expect(readBaselineMetrics()).toBeNull();
    expect(localStorage.getItem(BASELINE_KEY)).toBeNull();
  });
});

describe('calculateMetricsComparison', () => {
  it('establece baseline en la primera corrida y devuelve delta 0', () => {
    const result = calculateMetricsComparison(sample);
    expect(result.totalImprovementPct).toBe(0);
    expect(result.baseline).toEqual(sample);
    expect(result.latest).toEqual(sample);
    expect(localStorage.getItem(BASELINE_KEY)).not.toBeNull();
  });
  it('calcula mejora positiva cuando latest es más rápido', () => {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(sample));
    const faster: AnalysisMetrics = { ...sample, totalMs: 8_000 };
    const result = calculateMetricsComparison(faster);
    expect(result.totalImprovementPct).toBeCloseTo(20); // (10000-8000)/10000 * 100
  });
  it('calcula mejora negativa cuando latest es más lento', () => {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(sample));
    const slower: AnalysisMetrics = { ...sample, totalMs: 12_000 };
    const result = calculateMetricsComparison(slower);
    expect(result.totalImprovementPct).toBeCloseTo(-20);
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/__tests__/metricsBaseline.test.ts
```

- [ ] **Commit**

```bash
git add src/lib/__tests__/metricsBaseline.test.ts
git commit -m "test: add unit tests for lib/metricsBaseline.ts"
```

---

### Task 13: Tests para `hotStamp.ts`

**Files:**
- Create: `src/lib/__tests__/hotStamp.test.ts`

- [ ] **Crear `src/lib/__tests__/hotStamp.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import {
  isHotStampPiece,
  extractHotStampId,
  isHotStampCatalogEntry,
  consolidateHotStamps,
} from '../hotStamp';
import type { Order } from '../../types';

describe('isHotStampPiece', () => {
  it('detecta "HOT STAMP" en la descripción', () => {
    expect(isHotStampPiece('LETTER M, HOT STAMP')).toBe(true);
    expect(isHotStampPiece('HOT STAMP LETRA X')).toBe(true);
  });
  it('detecta ESTAMPAD + identificador extraíble', () => {
    expect(isHotStampPiece('NUMEROS P/ESTAMPADO # 2')).toBe(true);
  });
  it('no detecta ESTAMPAD sin identificador (descripción genérica)', () => {
    expect(isHotStampPiece('Fabricación de guarda para estampadora')).toBe(false);
  });
  it('no detecta piezas normales', () => {
    expect(isHotStampPiece('HEX SWAGE BLOCK 7/32')).toBe(false);
    expect(isHotStampPiece('SQUARE SWAGE BLOCK')).toBe(false);
  });
});

describe('extractHotStampId', () => {
  it('extrae letra de "LETTER M, HOT STAMP"', () => {
    expect(extractHotStampId('LETTER M, HOT STAMP')).toBe('M');
  });
  it('extrae número de "NUMEROS P/ESTAMPADO # 2 HOT STAMP"', () => {
    expect(extractHotStampId('NUMEROS P/ESTAMPADO # 2 HOT STAMP')).toBe('2');
  });
  it('devuelve null si no encuentra identificador', () => {
    expect(extractHotStampId('HOT STAMP GENERICO')).toBeNull();
  });
});

describe('isHotStampCatalogEntry', () => {
  it('detecta PUNZON en partNumber', () => {
    expect(isHotStampCatalogEntry({ partNumber: 'PUNZON-ISO', sourcePath: null, description: '' })).toBe(true);
  });
  it('detecta HOT-STAMP en sourcePath', () => {
    expect(isHotStampCatalogEntry({ partNumber: 'WCD-001', sourcePath: 'planos/HOT-STAMP.iso', description: '' })).toBe(true);
  });
  it('no detecta entrada normal', () => {
    expect(isHotStampCatalogEntry({ partNumber: 'WCD-001', sourcePath: null, description: 'HEX SWAGE' })).toBe(false);
  });
});

function makeOrder(pieza: string, orden = 'SO-001', cantidad = '2\nPieza'): Order {
  return { pieza, orden, cantidad, fecha: '01/06/2025', prioridad: 'Normal' };
}

describe('consolidateHotStamps', () => {
  it('devuelve la lista intacta si hay menos de 2 hot stamps', () => {
    const orders = [makeOrder('LETTER M, HOT STAMP'), makeOrder('HEX SWAGE BLOCK')];
    expect(consolidateHotStamps(orders)).toHaveLength(2);
  });

  it('colapsa múltiples hot stamps en un solo renglón sintético', () => {
    const orders = [
      makeOrder('LETTER M, HOT STAMP'),
      makeOrder('LETTER X, HOT STAMP'),
      makeOrder('NUMEROS P/ESTAMPADO # 2 HOT STAMP'),
      makeOrder('HEX SWAGE BLOCK'), // pieza normal: debe permanecer
    ];
    const result = consolidateHotStamps(orders);
    // 1 renglón sintético + 1 pieza normal
    expect(result).toHaveLength(2);
    const synthetic = result.find((o) => o.pieza.includes('HOT STAMP'))!;
    expect(synthetic).toBeDefined();
    expect(synthetic.pieza).toContain('3 punzones');
  });

  it('incluye isometricView si se pasa refImage', () => {
    const orders = [makeOrder('LETTER A, HOT STAMP'), makeOrder('LETTER B, HOT STAMP')];
    const result = consolidateHotStamps(orders, 'data:image/jpeg;base64,abc');
    const synthetic = result[0];
    expect(synthetic.isometricView).toBe('data:image/jpeg;base64,abc');
    expect(synthetic.haSidoAuditada).toBe(true);
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/__tests__/hotStamp.test.ts
```

- [ ] **Commit**

```bash
git add src/lib/__tests__/hotStamp.test.ts
git commit -m "test: add unit tests for lib/hotStamp.ts"
```

---

### Task 14: Tests para `orderMerge.ts`

**Files:**
- Create: `src/lib/__tests__/orderMerge.test.ts`

- [ ] **Crear `src/lib/__tests__/orderMerge.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import {
  validateOrderPdfName,
  extractCantidadUnit,
  parseCantidadNumber,
  mergeGroupedOrders,
  parseOrdersResponse,
  SUGGESTED_ORDER_REPORT_NAME,
} from '../orderMerge';
import type { ExtractedOrder } from '../../types';

describe('validateOrderPdfName', () => {
  it('devuelve null para el nombre exacto esperado', () => {
    expect(validateOrderPdfName(SUGGESTED_ORDER_REPORT_NAME)).toBeNull();
  });
  it('devuelve un mensaje de warning para otro nombre', () => {
    expect(validateOrderPdfName('reporte.pdf')).toContain('reporte.pdf');
  });
});

describe('extractCantidadUnit', () => {
  it('extrae "Pieza" de "2.00\\nPieza"', () => {
    expect(extractCantidadUnit('2.00\nPieza')).toBe('Pieza');
  });
  it('extrae "Set" de "10 Set"', () => {
    expect(extractCantidadUnit('10 Set')).toBe('Set');
  });
  it('devuelve "" si no hay unidad', () => {
    expect(extractCantidadUnit('10')).toBe('');
    expect(extractCantidadUnit('')).toBe('');
  });
});

describe('parseCantidadNumber', () => {
  it('parsea entero simple', () => {
    expect(parseCantidadNumber('5')).toBe(5);
  });
  it('parsea decimal con punto', () => {
    expect(parseCantidadNumber('2.50')).toBe(2.5);
  });
  it('parsea cantidad con unidad', () => {
    expect(parseCantidadNumber('3\nPieza')).toBe(3);
  });
  it('devuelve null para texto sin número', () => {
    expect(parseCantidadNumber('N/A')).toBeNull();
    expect(parseCantidadNumber('—')).toBeNull();
  });
});

function makeExtracted(overrides: Partial<ExtractedOrder> = {}): ExtractedOrder {
  return {
    pieza: 'HEX SWAGE BLOCK',
    numero_parte: 'WCD01-1824',
    cantidad: '2\nPieza',
    orden: 'SO-001',
    fecha: '01/06/2025',
    prioridad: 'Normal',
    poNumber: 'PO-100',
    ...overrides,
  };
}

describe('mergeGroupedOrders', () => {
  it('mantiene una sola orden si el part-number no se repite', () => {
    const orders = [makeExtracted()];
    expect(mergeGroupedOrders(orders)).toHaveLength(1);
  });

  it('consolida dos sub-líneas con el mismo número de parte', () => {
    const orders = [
      makeExtracted({ pieza: 'HEX SWAGE BLOCK 7/32', orden: 'SO-001' }),
      makeExtracted({ pieza: 'HEX SWAGE BLOCK 9/32', orden: 'SO-002' }),
    ];
    const result = mergeGroupedOrders(orders);
    expect(result).toHaveLength(1);
    expect(result[0].cantidad).toContain('4'); // 2+2
    expect(result[0].orden).toContain('SO-001');
    expect(result[0].orden).toContain('SO-002');
  });

  it('elimina duplicados exactos', () => {
    const order = makeExtracted();
    const result = mergeGroupedOrders([order, order]);
    expect(result).toHaveLength(1);
  });

  it('mantiene como individuales las órdenes sin part-number fiable', () => {
    const a = makeExtracted({ numero_parte: '' });
    const b = makeExtracted({ numero_parte: '', pieza: 'OTRA PIEZA' });
    const result = mergeGroupedOrders([a, b]);
    expect(result).toHaveLength(2);
  });
});

describe('parseOrdersResponse', () => {
  it('parsea un JSON array válido', () => {
    const json = JSON.stringify([
      {
        pieza: 'HEX SWAGE BLOCK 7/32',
        numero_parte: 'WCD01-1824',
        cantidad: '2\nPieza',
        orden: 'SO-001',
        fecha: '01/06/2025',
        prioridad: 'Normal',
        poNumber: 'PO-100',
      },
    ]);
    const result = parseOrdersResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0].pieza).toBe('HEX SWAGE BLOCK 7/32');
  });

  it('filtra filas de resumen', () => {
    const json = JSON.stringify([
      { pieza: 'Piezas Requeridas', numero_parte: '', cantidad: '10', orden: '', fecha: '', prioridad: 'Normal', poNumber: '' },
      { pieza: 'HEX SWAGE BLOCK', numero_parte: 'WCD-001', cantidad: '2', orden: 'SO-001', fecha: '01/06/2025', prioridad: 'Normal', poNumber: '' },
    ]);
    const result = parseOrdersResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0].pieza).toBe('HEX SWAGE BLOCK');
  });

  it('devuelve [] si el texto no es array', () => {
    expect(parseOrdersResponse(JSON.stringify({}))).toEqual([]);
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/__tests__/orderMerge.test.ts
```

- [ ] **Commit**

```bash
git add src/lib/__tests__/orderMerge.test.ts
git commit -m "test: add unit tests for lib/orderMerge.ts"
```

---

### Task 15: Tests para `reportFormat.ts`

**Files:**
- Create: `src/lib/__tests__/reportFormat.test.ts`

- [ ] **Crear `src/lib/__tests__/reportFormat.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import {
  cleanPieceName,
  withPartNumber,
  computeDueDate,
  dueSeverity,
  dueLabel,
  fmtISOToDisplay,
  collapseDuplicateOrders,
} from '../reportFormat';
import { addDaysToISODate } from '../age';
import type { Order } from '../../types';

const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

describe('cleanPieceName', () => {
  it('elimina prefijo (WESCON) al inicio', () => {
    expect(cleanPieceName('(WESCON) SQUARE SWAGE BLOCK')).toBe('SQUARE SWAGE BLOCK');
  });
  it('conserva menciones a media frase', () => {
    expect(cleanPieceName('BLOQUE (wescon) ESPECIAL')).toBe('BLOQUE (wescon) ESPECIAL');
  });
  it('devuelve la cadena sin cambios si no hay prefijo', () => {
    expect(cleanPieceName('HEX SWAGE BLOCK')).toBe('HEX SWAGE BLOCK');
  });
});

describe('withPartNumber', () => {
  it('agrega el número de parte si no está en el nombre', () => {
    const result = withPartNumber('HEX SWAGE BLOCK', 'WCD01-1824');
    expect(result).toContain('WCD01-1824');
  });
  it('no duplica si el número ya está en el nombre', () => {
    const result = withPartNumber('HEX SWAGE BLOCK WCD01-1824', 'WCD01-1824');
    expect(result).toBe('HEX SWAGE BLOCK WCD01-1824');
  });
  it('devuelve el nombre sin cambio si no hay número de parte', () => {
    expect(withPartNumber('HEX SWAGE BLOCK', '')).toBe('HEX SWAGE BLOCK');
  });
});

describe('computeDueDate', () => {
  it('suma 14 días a la fecha de la orden', () => {
    const order: Order = { pieza: 'X', orden: 'SO-1', cantidad: '1', fecha: '01/06/2025', prioridad: 'Normal' };
    expect(computeDueDate(order)).toBe('2025-06-15');
  });
  it('usa la fecha más vieja en órdenes multi-línea', () => {
    const order: Order = { pieza: 'X', orden: 'SO-1', cantidad: '1', fecha: '10/06/2025\n01/06/2025', prioridad: 'Normal' };
    expect(computeDueDate(order)).toBe('2025-06-15'); // más vieja: 01/06 + 14 días
  });
  it('devuelve null si la fecha no es parseable', () => {
    const order: Order = { pieza: 'X', orden: 'SO-1', cantidad: '1', fecha: 'N/A', prioridad: 'Normal' };
    expect(computeDueDate(order)).toBeNull();
  });
});

describe('dueSeverity', () => {
  it('devuelve "unknown" para null', () => {
    expect(dueSeverity(null)).toBe('unknown');
  });
  it('devuelve "overdue" para fecha pasada', () => {
    expect(dueSeverity('2020-01-01')).toBe('overdue');
  });
  it('devuelve "critical" para 1-3 días restantes', () => {
    expect(dueSeverity(addDaysToISODate(today, 2)!)).toBe('critical');
  });
  it('devuelve "warning" para 4-7 días restantes', () => {
    expect(dueSeverity(addDaysToISODate(today, 5)!)).toBe('warning');
  });
  it('devuelve "ok" para más de 7 días restantes', () => {
    expect(dueSeverity(addDaysToISODate(today, 14)!)).toBe('ok');
  });
});

describe('dueLabel', () => {
  it('devuelve "" para null', () => {
    expect(dueLabel(null)).toBe('');
  });
  it('devuelve "Vence hoy" para hoy', () => {
    expect(dueLabel(today)).toBe('Vence hoy');
  });
  it('incluye días para fechas futuras', () => {
    expect(dueLabel(addDaysToISODate(today, 5)!)).toBe('Vence en 5d');
  });
  it('incluye días vencida para fechas pasadas', () => {
    const past = addDaysToISODate(today, -3)!;
    expect(dueLabel(past)).toBe('Vencida 3d');
  });
});

describe('fmtISOToDisplay', () => {
  it('convierte YYYY-MM-DD a DD/MM/YYYY', () => {
    expect(fmtISOToDisplay('2025-06-15')).toBe('15/06/2025');
  });
  it('devuelve el string original si no coincide el formato', () => {
    expect(fmtISOToDisplay('15/06/2025')).toBe('15/06/2025');
  });
});

function makeOrder(pieza: string, extras: Partial<Order> = {}): Order {
  return { pieza, orden: 'SO-001', cantidad: '2\nPieza', fecha: '01/06/2025', prioridad: 'Normal', ...extras };
}

describe('collapseDuplicateOrders', () => {
  it('devuelve lista sin cambios si no hay duplicados', () => {
    const orders = [makeOrder('PIEZA A'), makeOrder('PIEZA B')];
    expect(collapseDuplicateOrders(orders)).toHaveLength(2);
  });
  it('colapsa renglones idénticos en uno con ×N y suma de cantidades', () => {
    const order = makeOrder('Fabricación de pieza');
    const result = collapseDuplicateOrders([order, order, order]);
    expect(result).toHaveLength(1);
    expect(result[0].pieza).toContain('×3');
    expect(result[0].cantidad).toContain('6'); // 2+2+2
  });
  it('no colapsa si el numero_parte difiere', () => {
    const a = makeOrder('Fabricación de pieza', { numero_parte: 'WCD-01' });
    const b = makeOrder('Fabricación de pieza', { numero_parte: 'WCD-02' });
    expect(collapseDuplicateOrders([a, b])).toHaveLength(2);
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/__tests__/reportFormat.test.ts
```

- [ ] **Commit**

```bash
git add src/lib/__tests__/reportFormat.test.ts
git commit -m "test: add unit tests for lib/reportFormat.ts"
```

---

### Task 16: Tests para `dedupe.ts`

**Files:**
- Create: `src/lib/workOrders/__tests__/dedupe.test.ts`

- [ ] **Crear `src/lib/workOrders/__tests__/dedupe.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { buildDedupeKey, mergeUpsert } from '../dedupe';
import type { UpsertMutableFields } from '../dedupe';

describe('buildDedupeKey', () => {
  it('genera clave SO::parte cuando hay SO y número de parte', () => {
    const key = buildDedupeKey({ soNumber: 'SO-001', poNumber: 'PO-100', numeroParte: 'WCD01-1824', pieza: 'HEX SWAGE BLOCK' });
    expect(key).toMatch(/SO-001/i);
    expect(key).toMatch(/WCD01-1824/i);
  });
  it('usa la pieza como fallback si no hay número de parte', () => {
    const key = buildDedupeKey({ soNumber: 'SO-001', poNumber: '', numeroParte: '', pieza: 'HEX SWAGE BLOCK' });
    expect(key).toContain('HEX SWAGE BLOCK');
  });
  it('usa PO como fallback si no hay SO', () => {
    const key = buildDedupeKey({ soNumber: '', poNumber: 'PO-100', numeroParte: 'WCD-001', pieza: 'PIEZA' });
    expect(key).toMatch(/PO-100/i);
  });
  it('toma solo la primera línea de SO multi-línea', () => {
    const key = buildDedupeKey({ soNumber: 'SO-001\nSO-002', poNumber: '', numeroParte: 'WCD-001', pieza: '' });
    expect(key).not.toContain('SO-002');
  });
  it('genera la misma clave para el mismo input (idempotente)', () => {
    const input = { soNumber: 'SO-001', poNumber: 'PO-100', numeroParte: 'WCD-001', pieza: 'HEX' };
    expect(buildDedupeKey(input)).toBe(buildDedupeKey(input));
  });
});

const fields: UpsertMutableFields = {
  cantidad: '5\nPieza',
  prioridad: 'Normal',
  matchedDrawingId: 'draw-1',
  matchedPartId: 'part-1',
  matchScore: 95,
  otDate: '2025-06-01',
  poNumber: 'PO-100',
  soNumber: 'SO-001',
};

describe('mergeUpsert', () => {
  it('identifica nuevas llaves como toCreate', () => {
    const result = mergeUpsert(new Map(), [{ key: 'SO-001::WCD-001', fields }]);
    expect(result.toCreate).toContain('SO-001::WCD-001');
    expect(result.toUpdate).toHaveLength(0);
  });
  it('identifica llaves existentes como toUpdate con su id', () => {
    const existing = new Map([['SO-001::WCD-001', { id: 'doc-abc' }]]);
    const result = mergeUpsert(existing, [{ key: 'SO-001::WCD-001', fields }]);
    expect(result.toCreate).toHaveLength(0);
    expect(result.toUpdate[0].id).toBe('doc-abc');
    expect(result.toUpdate[0].fields).toEqual(fields);
  });
  it('colapsa duplicados dentro del mismo lote (misma key dos veces)', () => {
    const result = mergeUpsert(new Map(), [
      { key: 'SO-001::WCD-001', fields },
      { key: 'SO-001::WCD-001', fields },
    ]);
    expect(result.toCreate).toHaveLength(1);
  });
  it('nunca marca nada para eliminar', () => {
    const existing = new Map([['SO-001::WCD-001', { id: 'doc-abc' }]]);
    const result = mergeUpsert(existing, []); // sin incoming
    expect(result.toCreate).toHaveLength(0);
    expect(result.toUpdate).toHaveLength(0);
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/workOrders/__tests__/dedupe.test.ts
```

- [ ] **Commit**

```bash
git add src/lib/workOrders/__tests__/dedupe.test.ts
git commit -m "test: add unit tests for lib/workOrders/dedupe.ts"
```

---

### Task 17: Tests para `metrics.ts` (workOrders)

**Files:**
- Create: `src/lib/workOrders/__tests__/metrics.test.ts`

- [ ] **Crear `src/lib/workOrders/__tests__/metrics.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { getDueDateSeverity, dueDaysLabel, calcMetrics } from '../metrics';
import type { WorkOrder } from '../../../types';
import { addDaysToISODate } from '../../age';

const today = new Date().toISOString().split('T')[0];

describe('getDueDateSeverity', () => {
  it('devuelve "done" para estado "entregada" sin importar la fecha', () => {
    expect(getDueDateSeverity('2020-01-01', 'entregada')).toBe('done');
  });
  it('devuelve "unknown" si no hay dueDate', () => {
    expect(getDueDateSeverity(null, 'pendiente')).toBe('unknown');
  });
  it('devuelve "overdue" para fecha pasada', () => {
    expect(getDueDateSeverity('2020-01-01', 'pendiente')).toBe('overdue');
  });
  it('devuelve "critical" para 0-3 días', () => {
    expect(getDueDateSeverity(addDaysToISODate(today, 2)!, 'en_proceso')).toBe('critical');
  });
  it('devuelve "warning" para 4-7 días', () => {
    expect(getDueDateSeverity(addDaysToISODate(today, 6)!, 'en_proceso')).toBe('warning');
  });
  it('devuelve "ok" para más de 7 días', () => {
    expect(getDueDateSeverity(addDaysToISODate(today, 10)!, 'pendiente')).toBe('ok');
  });
});

describe('dueDaysLabel', () => {
  it('devuelve "" para null', () => {
    expect(dueDaysLabel(null)).toBe('');
  });
  it('devuelve "Vence hoy" para hoy', () => {
    expect(dueDaysLabel(today)).toBe('Vence hoy');
  });
  it('devuelve "Vence mañana" para mañana', () => {
    expect(dueDaysLabel(addDaysToISODate(today, 1)!)).toBe('Vence mañana');
  });
  it('incluye días para fechas futuras', () => {
    expect(dueDaysLabel(addDaysToISODate(today, 5)!)).toContain('5');
  });
});

function makeWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'wo-1',
    poNumber: 'PO-100', soNumber: 'SO-001', otDate: '2025-06-01',
    customer: 'SUPRAJIT', pieza: 'HEX SWAGE BLOCK', numeroParte: 'WCD-001',
    cantidad: '2', prioridad: 'Normal', status: 'pendiente',
    matchedPartId: null, matchedDrawingId: null, matchScore: null,
    deliveredToTornero: null, deliveredAtUTC: null, deliveredByUid: null,
    dueDate: null, assignedToTornero: null, assignedAtUTC: null,
    finishedAtUTC: null, notes: '', sourcePdfName: '', archived: false,
    createdAtUTC: '2025-06-01T00:00:00Z', updatedAtUTC: null,
    ...overrides,
  };
}

describe('calcMetrics', () => {
  it('devuelve nulls si no hay órdenes entregadas', () => {
    const metrics = calcMetrics([makeWorkOrder({ status: 'pendiente' })]);
    expect(metrics.avgCycleDays).toBeNull();
    expect(metrics.onTimePct).toBeNull();
  });
  it('calcula avgCycleDays con una entrega', () => {
    const wo = makeWorkOrder({
      status: 'entregada',
      createdAtUTC: '2025-06-01T00:00:00Z',
      deliveredAtUTC: '2025-06-08T00:00:00Z',
    });
    const metrics = calcMetrics([wo]);
    expect(metrics.avgCycleDays).toBe(7);
  });
  it('calcula onTimePct 100% si entregada antes del dueDate', () => {
    const wo = makeWorkOrder({
      status: 'entregada',
      dueDate: '2025-06-10',
      createdAtUTC: '2025-06-01T00:00:00Z',
      deliveredAtUTC: '2025-06-08T00:00:00Z',
    });
    const metrics = calcMetrics([wo]);
    expect(metrics.onTimePct).toBe(100);
    expect(metrics.latePct).toBe(0);
  });
  it('calcula onTimePct 0% si entregada después del dueDate', () => {
    const wo = makeWorkOrder({
      status: 'entregada',
      dueDate: '2025-06-05',
      createdAtUTC: '2025-06-01T00:00:00Z',
      deliveredAtUTC: '2025-06-08T00:00:00Z',
    });
    const metrics = calcMetrics([wo]);
    expect(metrics.onTimePct).toBe(0);
  });
  it('excluye órdenes archivadas del conteo', () => {
    const wo = makeWorkOrder({ archived: true, status: 'en_proceso' });
    const metrics = calcMetrics([wo]);
    expect(metrics.inProgressCount).toBe(0);
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/workOrders/__tests__/metrics.test.ts
```

- [ ] **Commit**

```bash
git add src/lib/workOrders/__tests__/metrics.test.ts
git commit -m "test: add unit tests for lib/workOrders/metrics.ts"
```

---

### Task 18: Tests para `matching.ts`

**Files:**
- Create: `src/lib/__tests__/matching.test.ts`

- [ ] **Crear `src/lib/__tests__/matching.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import {
  normalizePieceLabel,
  extractPartIdentifiers,
  scorePieceMatch,
  extractOrderSignals,
  extractLibrarySignals,
  MIN_BLUEPRINT_MATCH_SCORE,
} from '../matching';

describe('normalizePieceLabel', () => {
  it('pasa a mayúsculas y elimina acentos', () => {
    expect(normalizePieceLabel('piéza número uno')).toBe('PIEZA NUMERO UNO');
  });
  it('colapsa espacios múltiples', () => {
    expect(normalizePieceLabel('PIEZA   BLOQUE')).toBe('PIEZA BLOQUE');
  });
  it('elimina caracteres especiales excepto - / . y espacio', () => {
    expect(normalizePieceLabel('WCD01-1824/A.B')).toBe('WCD01-1824/A.B');
    expect(normalizePieceLabel('WCD01#1824')).toBe('WCD01 1824');
  });
});

describe('extractPartIdentifiers', () => {
  it('extrae número de parte segmentado con guión', () => {
    const ids = extractPartIdentifiers('90-1012-05');
    expect(ids.some((id) => id.includes('1012'))).toBe(true);
  });
  it('extrae número de parte compacto ≥5 chars con dígito', () => {
    const ids = extractPartIdentifiers('WCD01-1824');
    expect(ids.length).toBeGreaterThan(0);
  });
  it('devuelve array vacío para texto solo descriptivo', () => {
    const ids = extractPartIdentifiers('BLOQUE HEXAGONAL');
    expect(ids).toEqual([]);
  });
});

describe('scorePieceMatch', () => {
  it('score 95 para match exacto de identificador', () => {
    const order = extractOrderSignals('HEX SWAGE BLOCK', 'WCD01-1824');
    const lib   = extractLibrarySignals({ partNumber: 'WCD01-1824', sourcePath: 'planos/WCD01-1824.pdf', description: 'HEX SWAGE BLOCK' });
    expect(scorePieceMatch(order, lib)).toBe(95);
  });

  it('score 0 (veto) si ambos tienen identificadores distintos', () => {
    const order = extractOrderSignals('HEX SWAGE BLOCK', '90-1012-05');
    const lib   = extractLibrarySignals({ partNumber: '90-1012-06', sourcePath: '', description: 'HEX SWAGE BLOCK' });
    expect(scorePieceMatch(order, lib)).toBe(0);
  });

  it('score ≥ MIN_BLUEPRINT_MATCH_SCORE para descriptor overlap alto (Jaccard ≥ 0.6)', () => {
    const order = extractOrderSignals('SQUARE SWAGE BLOCK WESCON', '');
    const lib   = extractLibrarySignals({ partNumber: 'WSB-001', sourcePath: 'planos/SQUARE SWAGE BLOCK.pdf', description: 'SQUARE SWAGE BLOCK' });
    expect(scorePieceMatch(order, lib)).toBeGreaterThanOrEqual(MIN_BLUEPRINT_MATCH_SCORE);
  });

  it('score 0 para descripciones completamente distintas sin identificadores', () => {
    const order = extractOrderSignals('BLOQUE CUADRADO', '');
    const lib   = extractLibrarySignals({ partNumber: 'XYZ-999', sourcePath: 'planos/RESORTE ESPIRAL.pdf', description: 'RESORTE ESPIRAL' });
    expect(scorePieceMatch(order, lib)).toBe(0);
  });
});
```

- [ ] **Ejecutar**

```bash
npm test -- src/lib/__tests__/matching.test.ts
```

- [ ] **Ejecutar toda la suite y confirmar que todo pasa**

```bash
npm test
```

Salida esperada: todos los archivos de test en verde, sin failures.

- [ ] **Commit**

```bash
git add src/lib/__tests__/matching.test.ts
git commit -m "test: add unit tests for lib/matching.ts"
```

---

## FASE 3 — División del hook

---

### Task 19: Extraer `useFileIngestion.ts`

**Files:**
- Create: `src/hooks/useFileIngestion.ts`
- Modify: `src/hooks/useVisionAnalysis.ts`

- [ ] **Crear `src/hooks/useFileIngestion.ts`** con el estado y handlers de archivos:

```ts
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import type { WorkshopPdfUpload } from '../types';
import { isPdfFile, readFileAsDataUrl } from '../lib/fileUtils';
import { validateOrderPdfName } from '../lib/orderMerge';
import type { ToolcribAttachment } from '../components/ToolcribLibraryPanel';

export interface FileIngestionAPI {
  // Estado legible públicamente
  orderPdf: string | null;
  orderPdfName: string | null;
  orderPdfWarning: string | null;
  workshopPdfs: WorkshopPdfUpload[];
  orderLoadingState: 'idle' | 'loading' | 'done' | 'error';
  workshopLoadingStates: Record<string, 'idle' | 'loading' | 'done' | 'error'>;
  toolcribPdfToDrawing: Record<string, string>;
  attachedToolcribDrawingIds: Set<string>;
  draggingZone: 'order' | 'workshop' | null;
  orderFileInputRef: React.RefObject<HTMLInputElement>;
  // Setters internos expuestos para useAnalysisPipeline
  setOrderLoadingState: React.Dispatch<React.SetStateAction<'idle' | 'loading' | 'done' | 'error'>>;
  setWorkshopPdfs: React.Dispatch<React.SetStateAction<WorkshopPdfUpload[]>>;
  setToolcribPdfToDrawing: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  enqueueWorkshopStatusPatch: (patch: { fileId: string; status: 'done' | 'error' }) => void;
  flushWorkshopStatePatches: () => void;
  // Handlers públicos
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
  setDraggingZone: (zone: 'order' | 'workshop' | null) => void;
}

export function useFileIngestion(callbacks: {
  setError: (msg: string | null) => void;
}): FileIngestionAPI {
  const { setError } = callbacks;

  const [orderPdf, setOrderPdf] = useState<string | null>(null);
  const [orderPdfName, setOrderPdfName] = useState<string | null>(null);
  const [orderPdfWarning, setOrderPdfWarning] = useState<string | null>(null);
  const [workshopPdfs, setWorkshopPdfs] = useState<WorkshopPdfUpload[]>([]);
  const [orderLoadingState, setOrderLoadingState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [workshopLoadingStates, setWorkshopLoadingStates] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [toolcribPdfToDrawing, setToolcribPdfToDrawing] = useState<Record<string, string>>({});
  const [draggingZone, setDraggingZone] = useState<'order' | 'workshop' | null>(null);

  const orderFileInputRef = useRef<HTMLInputElement>(null);
  const workshopStatePatchQueueRef = useRef<Record<string, 'done' | 'error'>>({});
  const workshopStatePatchTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (workshopStatePatchTimerRef.current !== null) {
      window.clearTimeout(workshopStatePatchTimerRef.current);
      workshopStatePatchTimerRef.current = null;
    }
  }, []);

  const flushWorkshopStatePatches = useCallback(() => {
    const pending = workshopStatePatchQueueRef.current;
    workshopStatePatchQueueRef.current = {};
    workshopStatePatchTimerRef.current = null;
    const entries = Object.entries(pending);
    if (entries.length === 0) return;
    setWorkshopLoadingStates((prev) => {
      const merged = { ...prev };
      entries.forEach(([key, status]) => { merged[key] = status; });
      return merged;
    });
  }, []);

  const enqueueWorkshopStatusPatch = useCallback(
    (patch: { fileId: string; status: 'done' | 'error' }) => {
      workshopStatePatchQueueRef.current[patch.fileId] = patch.status;
      if (workshopStatePatchTimerRef.current !== null) return;
      workshopStatePatchTimerRef.current = window.setTimeout(flushWorkshopStatePatches, 100);
    },
    [flushWorkshopStatePatches],
  );

  const attachedToolcribDrawingIds = useMemo(
    () => new Set(Object.values(toolcribPdfToDrawing)),
    [toolcribPdfToDrawing],
  );

  const ingestOrderFile = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    const validFiles = fileArray.filter(isPdfFile);
    if (validFiles.length === 0) {
      setError('El archivo seleccionado no es un PDF válido.');
      return;
    }
    const file = validFiles[0];
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setOrderPdf(dataUrl);
      setOrderPdfName(file.name);
      setOrderPdfWarning(validateOrderPdfName(file.name));
      setOrderLoadingState('idle');
      setError(null);
    } catch {
      setError(`No fue posible leer ${file.name}.`);
      setOrderLoadingState('error');
    }
  }, [setError]);

  const handleOrderInputUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) await ingestOrderFile(files);
      e.target.value = '';
    },
    [ingestOrderFile],
  );

  const ingestWorkshopFiles = useCallback(async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(isPdfFile);
    if (pdfs.length === 0) {
      setError('Arrastra archivos PDF para agregarlos al workspace.');
      return;
    }
    const uploads = await Promise.all(
      pdfs.map(async (file): Promise<WorkshopPdfUpload> => {
        const dataUrl = await readFileAsDataUrl(file);
        return {
          id: `manual-${file.name}-${file.lastModified}-${file.size}-${crypto.randomUUID()}`,
          name: file.name,
          relativePath: file.webkitRelativePath || file.name,
          dataUrl,
        };
      }),
    );
    setWorkshopPdfs((prev) => [...prev, ...uploads]);
    setError(null);
  }, [setError]);

  const buildDropHandlers = (
    zone: 'order' | 'workshop',
    onFiles: (files: FileList) => void | Promise<void>,
  ) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (draggingZone !== zone) setDraggingZone(zone);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget === e.target) setDraggingZone(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDraggingZone(null);
      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) void onFiles(droppedFiles);
    },
  });

  const removeFile = useCallback((type: 'order' | 'workshop', fileId?: string) => {
    if (type === 'order') {
      setOrderPdf(null);
      setOrderPdfName(null);
      setOrderPdfWarning(null);
    } else {
      setWorkshopPdfs((prev) => prev.filter((pdf) => pdf.id !== fileId));
      if (fileId) {
        setWorkshopLoadingStates((prev) => {
          const next = { ...prev };
          delete next[fileId];
          return next;
        });
        setToolcribPdfToDrawing((prev) => {
          if (!(fileId in prev)) return prev;
          const next = { ...prev };
          delete next[fileId];
          return next;
        });
      }
    }
  }, []);

  const handleAttachToolcribDrawing = useCallback((attachment: ToolcribAttachment) => {
    if (attachedToolcribDrawingIds.has(attachment.drawingId)) return;
    const pdfId = `toolcrib-${attachment.drawingId}-${crypto.randomUUID()}`;
    const relativePath = attachment.sourcePath.length > 0
      ? attachment.sourcePath
      : attachment.displayName;
    setWorkshopPdfs((prev) => [...prev, {
      id: pdfId, name: attachment.displayName, relativePath, dataUrl: attachment.dataUrl,
    }]);
    setToolcribPdfToDrawing((prev) => ({ ...prev, [pdfId]: attachment.drawingId }));
    setError(null);
  }, [attachedToolcribDrawingIds, setError]);

  return {
    orderPdf, orderPdfName, orderPdfWarning, workshopPdfs,
    orderLoadingState, workshopLoadingStates,
    toolcribPdfToDrawing, attachedToolcribDrawingIds,
    draggingZone, orderFileInputRef,
    setOrderLoadingState, setWorkshopPdfs, setToolcribPdfToDrawing,
    enqueueWorkshopStatusPatch, flushWorkshopStatePatches,
    ingestOrderFile, ingestWorkshopFiles, handleOrderInputUpload,
    handleAttachToolcribDrawing, removeFile, buildDropHandlers,
    setDraggingZone,
  };
}
```

- [ ] **Verificar que TypeScript no reporta errores**

```bash
npm run lint
```

> En este paso NO eliminar el código de `useVisionAnalysis.ts` todavía — simplemente crear el archivo. La integración se hace en Task 23.

- [ ] **Commit**

```bash
git add src/hooks/useFileIngestion.ts
git commit -m "feat(hook): extract useFileIngestion sub-hook"
```

---

### Task 20: Extraer `useResultsDisplay.ts`

**Files:**
- Create: `src/hooks/useResultsDisplay.ts`

- [ ] **Crear `src/hooks/useResultsDisplay.ts`**:

```ts
import { useMemo, useState } from 'react';
import type { Order } from '../types';

export interface ResultsDisplayAPI {
  resultsFilter: string;
  filterUrgentOnly: boolean;
  filterMissingOnly: boolean;
  filteredResults: Order[] | null;
  previewOrder: Order | null;
  setResultsFilter: (v: string) => void;
  setFilterUrgentOnly: (v: boolean) => void;
  setFilterMissingOnly: (v: boolean) => void;
  setPreviewOrder: (order: Order | null) => void;
}

export function useResultsDisplay(results: Order[] | null): ResultsDisplayAPI {
  const [resultsFilter, setResultsFilter] = useState('');
  const [filterUrgentOnly, setFilterUrgentOnly] = useState(false);
  const [filterMissingOnly, setFilterMissingOnly] = useState(false);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);

  const filteredResults = useMemo(() => {
    if (!results) return null;
    const term = resultsFilter.trim().toLowerCase();
    return results.filter((order) => {
      if (filterUrgentOnly && order.prioridad !== 'URGENTE') return false;
      if (filterMissingOnly && order.isometricView) return false;
      if (term.length === 0) return true;
      return [order.pieza, order.numero_parte ?? '', order.orden, order.sourcePdfName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [results, resultsFilter, filterUrgentOnly, filterMissingOnly]);

  return {
    resultsFilter, filterUrgentOnly, filterMissingOnly,
    filteredResults, previewOrder,
    setResultsFilter, setFilterUrgentOnly, setFilterMissingOnly, setPreviewOrder,
  };
}
```

- [ ] **Verificar**

```bash
npm run lint
```

- [ ] **Commit**

```bash
git add src/hooks/useResultsDisplay.ts
git commit -m "feat(hook): extract useResultsDisplay sub-hook"
```

---

### Task 21: Extraer `useEditMode.ts`

**Files:**
- Create: `src/hooks/useEditMode.ts`

- [ ] **Crear `src/hooks/useEditMode.ts`**:

```ts
import React, { useCallback, useMemo, useState } from 'react';
import type { Order } from '../types';
import { updateCantidad, archiveWorkOrder } from '../lib/firebase/workOrders';
import { buildDedupeKey } from '../lib/workOrders/dedupe';

function dedupeKeyOfReportOrder(order: Order): string {
  return buildDedupeKey({
    soNumber: order.orden,
    poNumber: order.poNumber ?? '',
    numeroParte: order.numero_parte ?? '',
    pieza: order.pieza,
  });
}

export interface EditModeAPI {
  editMode: boolean;
  originalResults: Order[] | null;
  excludedOrders: Array<{ order: Order; workOrderId: string | null }>;
  auditedCount: number;
  snapshotOriginalOnce: () => void;
  handleEditCantidad: (order: Order, newValue: string) => void;
  handleExcludeOrder: (order: Order) => void;
  handleRestoreOrder: (entry: { order: Order; workOrderId: string | null }) => void;
  handleRestoreAll: () => void;
  setEditMode: (v: boolean) => void;
}

export function useEditMode(
  pipeline: {
    results: Order[] | null;
    setResults: React.Dispatch<React.SetStateAction<Order[] | null>>;
  },
  options: {
    findWorkOrderId: (order: Order) => string | null;
    onDataChanged: () => void;
  },
): EditModeAPI {
  const { results, setResults } = pipeline;
  const { findWorkOrderId, onDataChanged } = options;

  const [editMode, setEditMode] = useState(false);
  const [originalResults, setOriginalResults] = useState<Order[] | null>(null);
  const [excludedOrders, setExcludedOrders] = useState<
    Array<{ order: Order; workOrderId: string | null }>
  >([]);

  const snapshotOriginalOnce = useCallback(() => {
    setOriginalResults((prev) => prev ?? (results ? [...results] : null));
  }, [results]);

  const handleEditCantidad = useCallback(
    (order: Order, nuevaCantidad: string) => {
      const clean = nuevaCantidad.trim();
      if (!clean || clean === order.cantidad) return;
      snapshotOriginalOnce();
      setResults((prev) =>
        prev ? prev.map((o) => (o === order ? { ...o, cantidad: clean } : o)) : prev,
      );
      const woId = findWorkOrderId(order);
      if (woId) {
        void (async () => {
          const res = await updateCantidad(woId, clean);
          if (res.ok === false) console.warn('[smv-vision][report-edit] updateCantidad no aplicado:', res.reason);
          else onDataChanged();
        })();
      }
    },
    [snapshotOriginalOnce, setResults, findWorkOrderId, onDataChanged],
  );

  const handleExcludeOrder = useCallback(
    (order: Order) => {
      snapshotOriginalOnce();
      const woId = findWorkOrderId(order);
      setExcludedOrders((prev) => [...prev, { order, workOrderId: woId }]);
      setResults((prev) => (prev ? prev.filter((o) => o !== order) : prev));
      if (woId) {
        void (async () => {
          const res = await archiveWorkOrder(woId, true);
          if (res.ok === false) console.warn('[smv-vision][report-edit] archive no aplicado:', res.reason);
          else onDataChanged();
        })();
      }
    },
    [snapshotOriginalOnce, setResults, findWorkOrderId, onDataChanged],
  );

  const handleRestoreOrder = useCallback(
    (entry: { order: Order; workOrderId: string | null }) => {
      setExcludedOrders((prev) => prev.filter((e) => e !== entry));
      setResults((prev) => (prev ? [...prev, entry.order] : [entry.order]));
      if (entry.workOrderId) {
        void (async () => {
          const res = await archiveWorkOrder(entry.workOrderId!, false);
          if (res.ok) onDataChanged();
        })();
      }
    },
    [setResults, onDataChanged],
  );

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
            const woId = findWorkOrderId(o);
            if (woId) {
              await updateCantidad(woId, o.cantidad);
              touched = true;
            }
          }
        }
      }
      if (touched) onDataChanged();
    })();
  }, [originalResults, results, excludedOrders, setResults, findWorkOrderId, onDataChanged]);

  const auditedCount = useMemo(
    () => (results ? results.filter((r) => r.haSidoAuditada).length : 0),
    [results],
  );

  return {
    editMode, originalResults, excludedOrders, auditedCount,
    snapshotOriginalOnce, handleEditCantidad, handleExcludeOrder,
    handleRestoreOrder, handleRestoreAll, setEditMode,
  };
}
```

- [ ] **Verificar**

```bash
npm run lint
```

- [ ] **Commit**

```bash
git add src/hooks/useEditMode.ts
git commit -m "feat(hook): extract useEditMode sub-hook"
```

---

### Task 22: Extraer `useAnalysisPipeline.ts`

**Files:**
- Create: `src/hooks/useAnalysisPipeline.ts`

- [ ] **Crear `src/hooks/useAnalysisPipeline.ts`** con el estado y la función `extractInfo`. Copiar desde `useVisionAnalysis.ts` todo lo relacionado con el pipeline (estados `isExtracting`, `extractingStep`, `results`, `analysisSummary`, `metricsComparison`, `copying`; la función `extractInfo`; las acciones de exportación `downloadPdf`, `downloadCsv`, `downloadJson`, `downloadSingleOrderPdf`, `copyResults`; y el ref `hotStampRefImageRef` + `copyingResetTimerRef`):

```ts
import React, {
  useCallback, useRef, useState,
} from 'react'; // React necesario para tipos React.Dispatch en AnalysisPipelineAPI
import { GoogleGenAI, Type } from '@google/genai';
import type {
  AnalysisMetrics, AnalysisRunSummary,
  BlueprintAnalysis, BlueprintSpec,
  ExtractedOrder, Order, WorkOrder,
} from '../types';
import type { FileIngestionAPI } from './useFileIngestion';
import type { MetricsComparison } from '../lib/metricsBaseline';
import { calculateMetricsComparison } from '../lib/metricsBaseline';
import { createDocumentHash, readCachedValue, writeCachedValue } from '../lib/documentAnalysis/cache';
import { runWithConcurrencyLimit } from '../lib/documentAnalysis/concurrency';
import { rasterizeAndNormalizePdf } from '../lib/documentAnalysis/pdfWorkerClient';
import { recordAnalysisRunFireAndForget } from '../lib/firebase/analysisRuns';
import { log } from '../lib/log';
import { callWithRetry, preparePdfPart, prepareImagePart } from '../lib/gemini';
import { parseBlueprintResponse } from '../lib/blueprintParsers';
import { isValidBoundingBox, cropIsometricView, cropToBoxRaw } from '../lib/imageProcessing';
import {
  MIN_BLUEPRINT_MATCH_SCORE,
  extractBlueprintSignals, extractLibrarySignals, extractOrderSignals,
  scorePieceMatch, selectBestBlueprintMatch,
} from '../lib/matching';
import { mergeGroupedOrders, parseOrdersResponse } from '../lib/orderMerge';
import { consolidateHotStamps, isHotStampCatalogEntry, isHotStampPiece } from '../lib/hotStamp';
import { collapseDuplicateOrders, withPartNumber, cleanPieceName } from '../lib/reportFormat';
import { listActiveDrawingViews } from '../lib/firebase/toolcrib';
import { upsertWorkOrders, updateCantidad, archiveWorkOrder } from '../lib/firebase/workOrders';
import type { IncomingWorkOrder } from '../lib/firebase/workOrders';
import { buildDedupeKey } from '../lib/workOrders/dedupe';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { generateReportPdf, generateSingleOrderPdf } from '../lib/pdfGenerator';

// ── Constantes del pipeline ───────────────────────────────────────────────────
const ORDER_PROMPT_VERSION = 'orders-v7-po-multi-hoja';
const BLUEPRINT_PROMPT_VERSION = 'blueprints-v15-multi-piece-variants';
const SMV_VISION_APP_VERSION = `smv-vision@${__APP_VERSION__}`;
const MAX_BLUEPRINT_CONCURRENCY = 8;
const REFINEMENT_SKIP_AREA_THRESHOLD = 200_000;
const GEMINI_ORDER_MODEL = 'gemini-3.5-flash';
const GEMINI_BLUEPRINT_MODEL = 'gemini-3.5-flash';
export const FALLBACK_CENTER_BOX: number[] = [30, 30, 720, 970];

interface BlueprintTaskResult {
  index: number;
  fileId: string;
  fileLabel: string;
  analysis: BlueprintAnalysis;
  metrics: { pdfRasterMs: number; aiBlueprintMs: number };
}

function dedupeKeyOfReportOrder(order: Order): string {
  return buildDedupeKey({
    soNumber: order.orden,
    poNumber: order.poNumber ?? '',
    numeroParte: order.numero_parte ?? '',
    pieza: order.pieza,
  });
}

export interface AnalysisPipelineAPI {
  isExtracting: boolean;
  extractingStep: string;
  results: Order[] | null;
  analysisSummary: AnalysisRunSummary | null;
  metricsComparison: MetricsComparison | null;
  copying: boolean;
  extractInfo: () => Promise<void>;
  setResults: React.Dispatch<React.SetStateAction<Order[] | null>>;
  downloadPdf: () => void;
  downloadCsv: () => void;
  downloadJson: () => void;
  downloadSingleOrderPdf: (order: Order) => void;
  copyResults: () => Promise<void>;
}

export function useAnalysisPipeline(
  fileState: FileIngestionAPI,
  options: {
    setError: (msg: string | null) => void;
    findWorkOrderId: (order: Order) => string | null;
    onDataChanged: () => void;
  },
): AnalysisPipelineAPI {
  const { setError, onDataChanged } = options;

  const [isExtracting, setIsExtracting] = useState(false);
  const [extractingStep, setExtractingStep] = useState('');
  const [results, setResults] = useState<Order[] | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisRunSummary | null>(null);
  const [metricsComparison, setMetricsComparison] = useState<MetricsComparison | null>(null);
  const [copying, setCopying] = useState(false);

  const hotStampRefImageRef = useRef<string | null>(null);
  const copyingResetTimerRef = useRef<number | null>(null);

  // El cuerpo completo de extractInfo (con todas sus sub-funciones como
  // refineSpecBox y applyBlueprintToResults) se copia verbatim desde
  // useVisionAnalysis.ts, reemplazando las referencias directas al estado
  // local por las del fileState recibido como parámetro.
  //
  // Variables de fileState usadas dentro de extractInfo:
  //   fileState.orderPdf, fileState.orderPdfName, fileState.workshopPdfs,
  //   fileState.toolcribPdfToDrawing, fileState.setOrderLoadingState,
  //   fileState.setWorkshopPdfs, fileState.setToolcribPdfToDrawing,
  //   fileState.enqueueWorkshopStatusPatch, fileState.flushWorkshopStatePatches
  //
  // INSTRUCCIÓN PARA EL IMPLEMENTADOR: copiar el cuerpo completo de
  // extractInfo desde useVisionAnalysis.ts (desde `const extractInfo = async`
  // hasta el cierre de su `finally`), ajustando las referencias al estado:
  //
  //   orderPdf              → fileState.orderPdf
  //   orderPdfName          → fileState.orderPdfName
  //   workshopPdfs          → fileState.workshopPdfs  (leer)
  //   toolcribPdfToDrawing  → fileState.toolcribPdfToDrawing (leer)
  //   setOrderLoadingState  → fileState.setOrderLoadingState
  //   setWorkshopPdfs       → fileState.setWorkshopPdfs
  //   setToolcribPdfToDrawing → fileState.setToolcribPdfToDrawing
  //   enqueueWorkshopStatusPatch → fileState.enqueueWorkshopStatusPatch
  //   flushWorkshopStatePatches  → fileState.flushWorkshopStatePatches
  //
  // Las constantes ORDER_PROMPT_VERSION, BLUEPRINT_PROMPT_VERSION, etc. están
  // definidas en este mismo archivo arriba — no hace falta importarlas.

  const extractInfo = useCallback(async (): Promise<void> => {
    // === PEGAR AQUÍ EL CUERPO COMPLETO DE extractInfo DESDE useVisionAnalysis.ts ===
    // Ajustar referencias según el mapa de arriba.
  }, [fileState, setError, onDataChanged, setResults]);

  // ── Acciones de exportación ──────────────────────────────────────────────
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

  const downloadCsv = useCallback(() => {
    if (!results) return;
    const escapeCell = (raw: string | undefined): string => {
      const value = (raw ?? '').replace(/\r?\n/g, ' | ');
      if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
      return value;
    };
    const header = ['Pieza', 'Numero de parte', 'Cantidad', 'SO', 'Fecha', 'Prioridad', 'Plano', 'Score'];
    const rows = results.map((order) => [
      escapeCell(order.pieza), escapeCell(order.numero_parte),
      escapeCell(order.cantidad), escapeCell(order.orden),
      escapeCell(order.fecha), escapeCell(order.prioridad),
      escapeCell(order.sourcePdfName),
      escapeCell(typeof order.matchScore === 'number' ? String(order.matchScore) : ''),
    ].join(','));
    const csv = '﻿' + [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smv_vision_orders_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  const downloadJson = useCallback(() => {
    if (!results) return;
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smv_vision_orders_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  const copyResults = useCallback(async () => {
    if (!results) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(results, null, 2));
      setCopying(true);
      if (copyingResetTimerRef.current !== null) window.clearTimeout(copyingResetTimerRef.current);
      copyingResetTimerRef.current = window.setTimeout(() => {
        setCopying(false);
        copyingResetTimerRef.current = null;
      }, 2000);
    } catch (err) {
      console.warn('[smv-vision] clipboard write rechazado', err);
      setError('No fue posible copiar al portapapeles. Revisa los permisos del navegador.');
    }
  }, [results, setError]);

  return {
    isExtracting, extractingStep, results, analysisSummary, metricsComparison, copying,
    extractInfo, setResults,
    downloadPdf, downloadCsv, downloadJson, downloadSingleOrderPdf, copyResults,
  };
}
```

- [ ] **Copiar el cuerpo completo de `extractInfo` desde `useVisionAnalysis.ts`**: reemplazar el comentario `// === PEGAR AQUÍ ===` con el cuerpo real, ajustando las referencias al estado según el mapa indicado en los comentarios del archivo.

- [ ] **Verificar**

```bash
npm run lint
```

- [ ] **Commit**

```bash
git add src/hooks/useAnalysisPipeline.ts
git commit -m "feat(hook): extract useAnalysisPipeline sub-hook"
```

---

### Task 23: Reemplazar `useVisionAnalysis.ts` con el compositor

**Files:**
- Reemplazar: `src/hooks/useVisionAnalysis.ts`

- [ ] **Reemplazar el contenido de `useVisionAnalysis.ts`** con el compositor delgado:

```ts
/**
 * useVisionAnalysis — compositor delgado.
 *
 * Combina cuatro sub-hooks en la interfaz pública VisionAnalysisHook.
 * App.tsx no se modifica: la interfaz es idéntica a la versión monolítica.
 */

import React, { useState } from 'react'; // React necesario para tipos React.RefObject / React.ChangeEvent
import type { Order } from '../types';
import { buildDedupeKey } from '../lib/workOrders/dedupe';
import { useFileIngestion } from './useFileIngestion';
import { useAnalysisPipeline } from './useAnalysisPipeline';
import { useEditMode } from './useEditMode';
import { useResultsDisplay } from './useResultsDisplay';
import type { ToolcribAttachment } from '../components/ToolcribLibraryPanel';
import type { WorkshopPdfUpload, AnalysisRunSummary } from '../types';
import type { MetricsComparison } from '../lib/metricsBaseline';

// Re-export types that App.tsx or other consumers might import from this module.
export type { MetricsComparison };

export interface UseVisionAnalysisOptions {
  findWorkOrderId: (order: Order) => string | null;
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

export function useVisionAnalysis({
  findWorkOrderId,
  onDataChanged,
}: UseVisionAnalysisOptions): VisionAnalysisHook {
  const [error, setError] = useState<string | null>(null);

  const fileState  = useFileIngestion({ setError });
  const pipeline   = useAnalysisPipeline(fileState, { setError, findWorkOrderId, onDataChanged });
  const editMode   = useEditMode(
    { results: pipeline.results, setResults: pipeline.setResults },
    { findWorkOrderId, onDataChanged },
  );
  const display    = useResultsDisplay(pipeline.results);

  return {
    // File state
    orderPdf:                  fileState.orderPdf,
    orderPdfName:              fileState.orderPdfName,
    orderPdfWarning:           fileState.orderPdfWarning,
    workshopPdfs:              fileState.workshopPdfs,
    orderLoadingState:         fileState.orderLoadingState,
    workshopLoadingStates:     fileState.workshopLoadingStates,
    toolcribPdfToDrawing:      fileState.toolcribPdfToDrawing,
    attachedToolcribDrawingIds: fileState.attachedToolcribDrawingIds,
    orderFileInputRef:         fileState.orderFileInputRef,
    draggingZone:              fileState.draggingZone,
    ingestOrderFile:           fileState.ingestOrderFile,
    ingestWorkshopFiles:       fileState.ingestWorkshopFiles,
    handleOrderInputUpload:    fileState.handleOrderInputUpload,
    handleAttachToolcribDrawing: fileState.handleAttachToolcribDrawing,
    removeFile:                fileState.removeFile,
    buildDropHandlers:         fileState.buildDropHandlers,
    setDraggingZone:           fileState.setDraggingZone,
    // Analysis pipeline
    isExtracting:      pipeline.isExtracting,
    extractingStep:    pipeline.extractingStep,
    results:           pipeline.results,
    analysisSummary:   pipeline.analysisSummary,
    metricsComparison: pipeline.metricsComparison,
    copying:           pipeline.copying,
    extractInfo:       pipeline.extractInfo,
    downloadPdf:       pipeline.downloadPdf,
    downloadCsv:       pipeline.downloadCsv,
    downloadJson:      pipeline.downloadJson,
    downloadSingleOrderPdf: pipeline.downloadSingleOrderPdf,
    copyResults:       pipeline.copyResults,
    // Edit mode
    editMode:            editMode.editMode,
    originalResults:     editMode.originalResults,
    excludedOrders:      editMode.excludedOrders,
    auditedCount:        editMode.auditedCount,
    snapshotOriginalOnce: editMode.snapshotOriginalOnce,
    handleEditCantidad:  editMode.handleEditCantidad,
    handleExcludeOrder:  editMode.handleExcludeOrder,
    handleRestoreOrder:  editMode.handleRestoreOrder,
    handleRestoreAll:    editMode.handleRestoreAll,
    setEditMode:         editMode.setEditMode,
    // Display
    resultsFilter:     display.resultsFilter,
    filterUrgentOnly:  display.filterUrgentOnly,
    filterMissingOnly: display.filterMissingOnly,
    filteredResults:   display.filteredResults,
    previewOrder:      display.previewOrder,
    setResultsFilter:  display.setResultsFilter,
    setFilterUrgentOnly: display.setFilterUrgentOnly,
    setFilterMissingOnly: display.setFilterMissingOnly,
    setPreviewOrder:   display.setPreviewOrder,
    // Error — propiedad del compositor
    error,
    setError,
  };
}
```

- [ ] **Verificar que TypeScript compila sin errores**

```bash
npm run lint
```

- [ ] **Verificar que los tests siguen pasando**

```bash
npm test
```

- [ ] **Arrancar el servidor de desarrollo y verificar manualmente que la app carga y el flujo de análisis funciona**

```bash
npm run dev
```

Pasos mínimos de verificación:
1. La app carga sin errores de consola.
2. Se puede subir un PDF de pedidos.
3. Se puede iniciar el análisis (`Analizar`).
4. Los resultados aparecen en la tabla.

- [ ] **Commit final**

```bash
git add src/hooks/useVisionAnalysis.ts
git commit -m "refactor: replace useVisionAnalysis monolith with compositor of 4 sub-hooks"
```

---

## Verificación final

- [ ] **Ejecutar toda la suite de tests**

```bash
npm test
```

Salida esperada: 12 archivos de test, todos en verde.

- [ ] **Verificar que TypeScript compila limpio**

```bash
npm run lint
```

- [ ] **Ejecutar build de producción**

```bash
npm run build
```

Salida esperada: sin errores, bundles generados.
