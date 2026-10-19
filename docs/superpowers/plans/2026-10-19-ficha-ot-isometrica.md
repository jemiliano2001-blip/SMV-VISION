# Ficha OT isométrica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quitar la ruta de fabricación de la ficha OT y poner una foto grande (ISO, STL en blanco y negro, o dibujo de línea por IA).

**Architecture:** `chooseFichaPhotoKind` decide el origen. `resolveFichaPhoto` descarga o genera antes de sellar. `stampPlanoOt` solo dibuja. La segunda hoja sigue siendo el plano CAD.

**Tech Stack:** TypeScript, pdf-lib, Vitest, Gemini vía `generateIsometricImageFromDrawing`, Three.js para STL.

## Global Constraints

- Orden de la foto: ISO, luego STL, luego IA, luego "Sin isométrica".
- Resolución solo en modo `board_ticket` o `both`.
- `stampPlanoOt` no lee Firestore ni llama a Gemini.
- Impresión en negro y blanco. La cantidad de la ficha va en negro.
- `ISOMETRIC_GEN_PROMPT_VERSION` = `iso-gen-v3`.
- El render STL de factura y correo no cambia de default.
- `printDrawingForGroup` sigue devolviendo el CAD.
- Un fallo de foto no aborta la OT.

---

### Task 1: Decisión pura de la foto

**Files:**
- Create: `src/lib/fichaOtPhoto.ts`
- Test: `src/lib/__tests__/fichaOtPhoto.test.ts`

**Interfaces:**
- Produces: `chooseFichaPhotoKind({ isoPdfUrl, stlUrl, cadPdfAvailable }) => 'iso' | 'stl' | 'ai' | 'none'`
- Produces: `photoSourcesForPart(partNumber, views) => { isoPdfUrl, stlUrl }`
- Produces: `resolveFichaPhoto` y `attachFichaPhoto` (Task 2)

- [ ] Test: ISO gana; sin ISO gana STL; sin ambos y con CAD es `ai`; sin nada es `none`.
- [ ] Implementar `chooseFichaPhotoKind` y `photoSourcesForPart` con `groupDrawingViews`.

### Task 2: Resolución con fallback

**Interfaces:**
- Consumes: `chooseFichaPhotoKind`
- Produces: `PlanoOtFichaPhoto { kind, pdfDataUrl?, imageDataUrl? }`
- Produces: `attachFichaPhoto(stamp, sources)` que no hace nada si `mode` es `blueprint`

- [ ] Test: fetch ISO falla y hay STL → imagen STL. STL falla y la IA devuelve null → `none`. La IA no se llama si hay ISO.
- [ ] Implementar `resolveFichaPhoto` con deps inyectables. El default rasteriza el CAD, usa caché `iso-gen` y `generateIsometricImageFromDrawing`.

### Task 3: Prompt de línea

**Files:**
- Modify: `src/lib/generateIsometricImage.ts`
- Test: `src/lib/__tests__/generateIsometricImage.test.ts`

- [ ] Exportar el prompt. Versión `iso-gen-v3`. Pedir fondo blanco, línea negra, sin cotas, sin cajetín, sin estudio.
- [ ] Test sin red: la versión es `iso-gen-v3` y el prompt contiene esas reglas.

### Task 4: STL de impresión

**Files:**
- Modify: `src/lib/stlImageRenderer.ts`

- [ ] Añadir `tone?: 'color' | 'print'`. Default `color` igual que hoy.
- [ ] `print`: fondo blanco, material gris oscuro mate, luces blancas.

### Task 5: Ficha en blanco y negro

**Files:**
- Modify: `src/lib/planoOt.ts`
- Test: `src/lib/__tests__/planoOt.test.ts`

- [ ] `PlanoOtStamp.fichaPhoto` opcional.
- [ ] Quitar la tabla de ruta. Encabezado negro, texto blanco, cantidad en negro, foto grande.
- [ ] Leyenda "Isométrica generada" o "Sin isométrica".
- [ ] Notas de la segunda hoja en negro.
- [ ] Test: el PDF de `board_ticket` no contiene "RUTA DE FABRICACION" y sí la leyenda de foto vacía.

### Task 6: Callers

**Files:**
- Modify: `src/components/ToolcribPrintModal.tsx`
- Modify: `src/components/ToolcribBatchPrintModal.tsx`
- Modify: `src/components/ToolcribLibraryPanel.tsx`
- Modify: `src/hooks/useBatchPrintOts.ts`

- [ ] Antes de abrir la OT, `attachFichaPhoto` con el hermano ISO/STL del catálogo ya cargado.
- [ ] En juegos separados, cada pieza resuelve la suya. En el PDF unificado, la ficha es la de la pieza base (los complementos siguen en modo `blueprint`).

### Task 7: Cierre

- [ ] `npm test`, `npm run lint`, `npm run build`.
