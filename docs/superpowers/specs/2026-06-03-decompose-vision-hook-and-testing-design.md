# Design: Descomposición de useVisionAnalysis + Suite de Tests

**Fecha:** 2026-06-03
**Estado:** Aprobado

## Contexto

`useVisionAnalysis.ts` tiene 1552 líneas y mezcla cuatro responsabilidades distintas: ingesta de archivos, el pipeline de análisis con Gemini, modo de edición del reporte, y visualización/filtros. No existe ningún test runner en el proyecto; la única validación es `tsc --noEmit`.

El objetivo es mejorar la mantenibilidad y la cobertura de tests en tres fases encadenadas, sin romper la interfaz pública que consume `App.tsx`.

---

## Fase 1 — Extracción de helpers puros a `src/lib/`

Las ~400 líneas de funciones puras en la parte alta de `useVisionAnalysis.ts` se mueven a módulos enfocados. El hook en sí solo pierde las definiciones (los imports las reemplazan) y las nuevas funciones quedan listas para testear.

### Nuevos módulos

**`src/lib/gemini.ts`**
Utilidades de bajo nivel para la API de Gemini:
- `callWithRetry<T>(fn, maxAttempts = 3)` — reintentos con backoff exponencial (1 s / 2 s)
- `preparePdfPart(dataUrl: string)` — construye el objeto `inlineData` para PDFs
- `prepareImagePart(dataUrl: string)` — ídem para imágenes JPEG

**`src/lib/blueprintParsers.ts`**
Parseo y validación de respuestas de Gemini Vision:
- `parseBoundingBox(value: unknown): BoundingBox | null`
- `parseBlueprintResponse(text: string): BlueprintSpec[]`
- `isRecord(value: unknown): value is Record<string, unknown>` (internal)
- `asString(value: unknown): string` (internal)

**`src/lib/imageProcessing.ts`**
Manipulación de imágenes (canvas del browser):
- `isValidBoundingBox(box?: number[]): box is number[]` — valida área mínima, área máxima y ratio de aspecto *(pura, testeable en Node)*
- `cropIsometricView(base64: string, box: number[]): Promise<string>` — recorta y cuadra la vista isométrica *(DOM)*
- `cropToBoxRaw(base64: string, box: number[]): Promise<string>` — recorte sin normalización para el segundo pase *(DOM)*

**`src/lib/fileUtils.ts`**
Utilidades de archivos del browser:
- `isPdfFile(file: File): boolean` — detecta por MIME type y extensión *(pura, testeable)*
- `readFileAsDataUrl(file: File): Promise<string>` — FileReader → dataURL *(DOM)*

**`src/lib/metricsBaseline.ts`**
Baseline de métricas de análisis (localStorage):
- `readBaselineMetrics(): AnalysisMetrics | null`
- `calculateMetricsComparison(latest: AnalysisMetrics): MetricsComparison`

### Impacto en useVisionAnalysis.ts

Las definiciones de las funciones se reemplazan por imports. El hook baja de ~1552 a ~1100 líneas. No cambia ningún comportamiento ni la interfaz pública.

---

## Fase 2 — Configuración de Vitest + tests para funciones puras

### Setup

- Instalar `vitest` como devDependency (no requiere `@testing-library/react`)
- Configurar dentro de `vite.config.ts` añadiendo el bloque `test:` — sin archivo separado
- Ambiente: `node` (sin jsdom); todas las funciones cubiertas son puras o mockeables sin DOM
- Scripts en `package.json`:
  - `"test": "vitest run"` — una pasada (CI)
  - `"test:watch": "vitest"` — modo watch (desarrollo)
- `npm run lint` sigue siendo `tsc --noEmit`; los tests corren con `npm test`

### Módulos y casos representativos

| Archivo de test | Módulo | Casos clave |
|---|---|---|
| `matching.test.ts` | `matching.ts` | identifier match exacto, veto por mismatch, Jaccard ≥0.6 y ≥0.5, score por debajo del umbral, ISO vs CAD |
| `dedupe.test.ts` | `workOrders/dedupe.ts` | dedup key `SO::parte`, `mergeUpsert` preserva estado de entrega, fallback a `PO::` |
| `metrics.test.ts` | `workOrders/metrics.ts` | `getDueDateSeverity` (overdue, critical, warning, ok, done, unknown), `calcMetrics` sin entregadas, con entregadas a tiempo/tarde |
| `reportFormat.test.ts` | `reportFormat.ts` | limpieza de nombre de pieza, colapso de duplicados, due labels, `dueSeverity` |
| `orderMerge.test.ts` | `orderMerge.ts` | merge de órdenes agrupadas, multi-hoja PO, `validateOrderPdfName` |
| `age.test.ts` | `age.ts` | `parseDateToISO`, `addDaysToISODate`, `daysUntilISODate` positivo/negativo/hoy |
| `hotStamp.test.ts` | `hotStamp.ts` | `isHotStampPiece` positivo y negativo, consolidación de punzones con mismo die |
| `gemini.test.ts` | `gemini.ts` *(nuevo)* | `preparePdfPart`/`prepareImagePart` separan base64 correctamente; `callWithRetry` éxito en primer intento, éxito en segundo reintento, lanza al agotar intentos |
| `blueprintParsers.test.ts` | `blueprintParsers.ts` *(nuevo)* | `parseBoundingBox` válido/inválido/NaN/array corto; `parseBlueprintResponse` array correcto, con objetos malformados, texto no-JSON |
| `imageProcessing.test.ts` | `imageProcessing.ts` *(nuevo)* | `isValidBoundingBox`: área < 5%, sliver (ratio < 0.25), área > 56%, box válido |
| `fileUtils.test.ts` | `fileUtils.ts` *(nuevo)* | `isPdfFile` por MIME `application/pdf`, por extensión `.pdf`, archivo no-PDF |
| `metricsBaseline.test.ts` | `metricsBaseline.ts` *(nuevo)* | primera corrida sin baseline (se establece), delta positivo, delta negativo |

### Estructura de archivos

```
src/lib/__tests__/
  matching.test.ts
  blueprintParsers.test.ts
  imageProcessing.test.ts
  fileUtils.test.ts
  metricsBaseline.test.ts
  gemini.test.ts
  reportFormat.test.ts
  orderMerge.test.ts
  age.test.ts
  hotStamp.test.ts
src/lib/workOrders/__tests__/
  dedupe.test.ts
  metrics.test.ts
```

Los tests viven junto al código que prueban, no en una carpeta raíz `tests/`.

---

## Fase 3 — División de `useVisionAnalysis` en sub-hooks

`useVisionAnalysis.ts` se convierte en un orquestador delgado (~100 líneas) que compone cuatro sub-hooks. **La interfaz pública `VisionAnalysisHook` no cambia** — `App.tsx` no se modifica.

### Sub-hooks

**`src/hooks/useFileIngestion.ts`** (~250 líneas)
Responsabilidad única: estado y handlers de archivos PDF.

Estado: `orderPdf`, `orderPdfName`, `orderPdfWarning`, `workshopPdfs`, `orderLoadingState`, `workshopLoadingStates`, `toolcribPdfToDrawing`, `attachedToolcribDrawingIds`, `draggingZone`, `orderFileInputRef`

Handlers: `ingestOrderFile`, `ingestWorkshopFiles`, `handleOrderInputUpload`, `handleAttachToolcribDrawing`, `removeFile`, `buildDropHandlers`, `setDraggingZone`

---

**`src/hooks/useAnalysisPipeline.ts`** (~700 líneas)
Responsabilidad única: el pipeline `extractInfo()` y su estado asociado.

Recibe como parámetro el `fileState` retornado por `useFileIngestion` — no duplica el estado de archivos.

Estado: `isExtracting`, `extractingStep`, `error`, `results`, `analysisSummary`, `metricsComparison`, `copying`

Expone: `extractInfo()`, `setResults()`, `setError()`, `downloadPdf()`, `downloadCsv()`, `downloadJson()`, `downloadSingleOrderPdf()`, `copyResults()`

Las acciones de exportación se colocan aquí porque operan directamente sobre `results` y `analysisSummary`. No tienen estado propio excepto `copying` (booleano para el badge "Copiado").

---

**`src/hooks/useEditMode.ts`** (~180 líneas)
Responsabilidad única: edición inline del reporte (cantidades, exclusiones, restauración).

Recibe `results` y `setResults` de `useAnalysisPipeline`, y `findWorkOrderId` / `onDataChanged` de las opciones del hook raíz.

Estado: `editMode`, `originalResults`, `excludedOrders`, `auditedCount`

Handlers: `snapshotOriginalOnce`, `handleEditCantidad`, `handleExcludeOrder`, `handleRestoreOrder`, `handleRestoreAll`, `setEditMode`

---

**`src/hooks/useResultsDisplay.ts`** (~80 líneas)
Responsabilidad única: filtros y derivados de visualización.

Recibe `results` de `useAnalysisPipeline`.

Estado: `resultsFilter`, `filterUrgentOnly`, `filterMissingOnly`, `previewOrder`

Derivado: `filteredResults` como `useMemo` sobre `results` + filtros activos

Setters: `setResultsFilter`, `setFilterUrgentOnly`, `setFilterMissingOnly`, `setPreviewOrder`

---

### useVisionAnalysis.ts resultante

```ts
export function useVisionAnalysis(options: UseVisionAnalysisOptions): VisionAnalysisHook {
  const fileState = useFileIngestion();
  const pipeline  = useAnalysisPipeline(fileState, options);
  const editMode  = useEditMode(pipeline.results, pipeline.setResults, options);
  const display   = useResultsDisplay(pipeline.results);

  return { ...fileState, ...pipeline, ...editMode, ...display };
}
```

`VisionAnalysisHook` se exporta sin cambios; `App.tsx` no requiere ninguna modificación.

---

## Resumen del impacto

| Archivo | Antes | Después |
|---|---|---|
| `useVisionAnalysis.ts` | 1552 líneas | ~100 líneas |
| `useFileIngestion.ts` | — | ~250 líneas |
| `useAnalysisPipeline.ts` | — | ~700 líneas |
| `useEditMode.ts` | — | ~180 líneas |
| `useResultsDisplay.ts` | — | ~80 líneas |
| `src/lib/gemini.ts` | — | ~40 líneas |
| `src/lib/blueprintParsers.ts` | — | ~50 líneas |
| `src/lib/imageProcessing.ts` | — | ~70 líneas |
| `src/lib/fileUtils.ts` | — | ~25 líneas |
| `src/lib/metricsBaseline.ts` | — | ~30 líneas |
| Tests | 0 archivos | 12 archivos, ~400 aserciones |

## Restricciones y riesgos

- **Interfaz pública congelada:** `VisionAnalysisHook` y `UseVisionAnalysisOptions` no cambian. Cualquier adición va en un PR separado.
- **Sin tests de hooks con React:** los sub-hooks nuevos no tienen tests unitarios en este ciclo; se cubren indirectamente a través de los tests de las libs que usan.
- **Canvas/FileReader quedan sin tests:** `cropIsometricView`, `cropToBoxRaw` y `readFileAsDataUrl` dependen del DOM y no se cubren con el ambiente `node`. Se documenta como deuda técnica explícita.
- **Orden de las fases es fija:** Fase 2 (tests) no empieza hasta que Fase 1 (extracción) esté completa — los tests verifican los módulos extraídos.
