# Plan de refactor grande SMV-VISION — 2026-08-27

**Para el agente ejecutor (Antigravity / Gemini):** este documento es la fuente de verdad
de esta tarea. Es la continuación de un barrido de 64 bugs (6 fases, ~34 archivos) que
se hizo en la sesión anterior — ese trabajo **ya está terminado y verificado**, pero
**todavía no está commiteado**. Los dos refactores de este plan son deliberadamente
grandes y de mayor riesgo, así que se dejaron para una sesión aparte con más cuidado.

**Antes de tocar nada de este plan:**
```bash
git status --short   # deberías ver ~34-36 archivos modificados/borrados, nada más
npm run lint          # tsc --noEmit — debe salir limpio
npx vitest run        # deben pasar 191 tests
npm run build         # debe compilar sin error
```
Si los cuatro comandos salen limpios, **commitea ese estado primero** (un solo commit,
mensaje tipo "fix: barrido de 64 huecos funcionales — ver docs/ para detalle") antes de
empezar cualquier refactor de este plan. Así tienes un punto de retorno limpio si algo
sale mal, y el diff del refactor no se mezcla con 34 archivos de bugfixes no relacionados.

---

## Regla de oro: esto es un *move*, no un *rewrite*

Ambos refactores son puramente estructurales: mover código de un archivo a otro,
extraer closures a hooks/funciones con nombre. **No cambies lógica, no "mejores de
paso" nada, no renombres variables salvo que este plan lo pida explícitamente.** Si en
medio del refactor ves algo que parece un bug, anótalo aparte — no lo arregles en el
mismo diff. Un refactor que también cambia comportamiento es imposible de revisar y
de revertir si algo sale mal.

**Verifica después de CADA extracción, no solo al final.** Cada paso de cada fase abajo
tiene su propio checkpoint. Si `npm run lint` o `npx vitest run` truenan después de un
paso, arregla ese paso antes de seguir al siguiente — nunca acumules 5 extracciones sin
verificar entre ellas.

## Gotcha crítico de este proyecto: no hay `strictNullChecks`

`tsconfig.json` **no tiene `"strict": true`** ni `"strictNullChecks": true`. Esto importa
muchísimo si vas a mover código que revisa resultados tipo `{ok:true,...} | {ok:false,
reason}` (el patrón "result type" de todo `src/lib/firebase/*.ts`):

```ts
// ESTO NO ESTRECHA EL TIPO en este proyecto (sí lo haría con strictNullChecks):
if (!result.ok) {
  result.reason; // ERROR TS2339 — TypeScript no lo reconoce como el miembro ok:false
}

// ESTO SÍ FUNCIONA — usa comparación explícita o el operador `in`:
if (result.ok === false) {
  result.reason; // OK
}
```

Se confirmó con una reproducción aislada durante la sesión anterior — no es un capricho,
es una limitación real de este `tsconfig.json`. El código existente en el repo ya sigue
este patrón (`if (!result.ok && 'reason' in result)` en varios lados, o `=== false`). Si
al mover código `tsc` empieza a quejarse de una propiedad "que no existe", **este es
probablemente el motivo** — no le pongas `as any` ni `@ts-ignore`, cambia la condición a
`=== false` / `=== true`.

## Prohibido en este plan

- Agregar dependencias nuevas.
- `// @ts-ignore`, `as any`, o silenciar un error de TypeScript de cualquier forma.
- Cambiar el comportamiento de algo mientras lo mueves (si ves un bug, anótalo, no lo
  toques en el mismo diff).
- Tocar `src/lib/firebase/*.ts`, `functions/`, `firestore.rules` — no forman parte de
  este refactor.
- `git push --force`, reescritura de historia, o borrar el commit de bugfixes previo.

---

## Contexto: qué se hizo antes y por qué estos dos archivos siguen

La sesión anterior cerró 14/14 hallazgos de prioridad alta y prácticamente todos los de
prioridad media de una auditoría funcional completa (ver el historial de chat / el
artifact publicado si está disponible). Dos refactors de reestructuración quedaron fuera
a propósito porque **ninguno de los dos archivos tiene tests de componente** — solo hay
tests de lógica pura en `src/lib/__tests__/` — y partir el archivo más grande y más
crítico del pipeline sin esa red de seguridad es justo el tipo de cambio que merece su
propia sesión enfocada, no un extra al final de un barrido de bugs.

Los dos archivos:

| Archivo | Líneas (2026-08-27) | Qué hace |
|---|---|---|
| `src/components/OdooOrdersPanel.tsx` | 1245 | Selector de compañía, filtros/búsqueda, tarjeta de orden con acciones por línea, selección múltiple + impresión en lote |
| `src/hooks/useVisionAnalysis.ts` | 1543 | Todo el estado y el pipeline de auditoría de planos: extracción de Odoo, auto-matching de catálogo, análisis con Gemini, merge progresivo, edición de resultados, exportación |

**Las líneas citadas en este documento son del 2026-08-27 — vuelve a verificarlas
(`grep -n` o abre el archivo) antes de editar, sobre todo si ya avanzaste alguna fase de
este mismo plan y las líneas se recorrieron.**

---

## Refactor 1 — `OdooOrdersPanel.tsx` (hacer este primero: menos riesgo, menos líneas)

### Mapa estructural actual

```
L92-118   Estado: orders, productionMap, loading, error, sync, modales, selección de líneas,
          partner seleccionado, filtros (viewMode/searchTerm/selectedRequisitor/collapsed)
L125-252  Acciones de línea: catalogErrorMessage, ensureCatalogViews, resolveLineLink,
          handlePrintLinePlano, handleSendLineToReport, handleOpenBibliotecaForLine
L253-361  Selección de lote: toggleSelectLine, toggleSelectAllInOrder, handleBatchPrintOts
L362-436  Carga de datos: fetchOrders, selectPartner
L416-523  Sync: startSyncTimer, handleRefresh + efectos de sincronización
L470-523  Filtros/agrupación: uniqueRequisitores, searchMatchedOrders, filteredOrders,
          groupedByRequisitor, toggleGroupCollapse
L531-840  renderOrderCard — la tarjeta completa de una orden con su tabla de líneas
          (~310 líneas, es el bloque más grande del archivo)
L841+     JSX del componente: header, banner de sync, selector de compañía, subheader de
          filtros, main (llama renderOrderCard), y los modales (InvoiceRequestPanel,
          ToolcribPrintModal)
```

### Extracciones propuestas, en este orden

**1. `OrderCard` como componente propio** (el movimiento de mayor payoff, menor riesgo)

Archivo nuevo: `src/components/odoo-orders/OrderCard.tsx`.

Extrae el closure `renderOrderCard` (L531-840) a un componente `function OrderCard(props)`.
Props necesarias — léelas del cuerpo actual del closure, pero como referencia rápida:
`order`, `productionMap`, `bridge`, `selectedLines`, `lineBusyKey`, `sendingKey`, y los
callbacks `onToggleSelectLine`, `onToggleSelectAllInOrder`, `onPrintLine`, `onSendLineToReport`,
`onQuickPurchase`, `onOpenBiblioteca`, `onExportDeliverySlip`.

**Cuidado específico:** este closure fue el lugar exacto donde se arregló el bug del
checkbox "seleccionar todo" (P1-07 de la auditoría anterior) — el bug era que el estado
visual del checkbox se calculaba con el índice del arreglo **filtrado** mientras las
llaves reales usaban el índice del arreglo **original**. Al mover este código a un
componente aparte, **no vuelvas a introducir un `.filter().map((_, idx) => ...)` separado
del `.map().filter()` que genera las llaves reales** — el patrón correcto ya vive en el
código (busca el comentario que lo explica) y debe sobrevivir la extracción intacto.

Checkpoint:
```bash
npm run lint && npx vitest run
```

**2. `useBatchPrintOts` — hook de selección múltiple + impresión en lote**

Archivo nuevo: `src/hooks/useBatchPrintOts.ts`.

Mueve `selectedLines`/`batchPrinting`/`batchPrintStatus` (L107-109) y
`toggleSelectLine`/`toggleSelectAllInOrder`/`handleBatchPrintOts` (L253-361) a un hook
que reciba `orders` y `bridge` como parámetros y devuelva
`{ selectedLines, batchPrinting, batchPrintStatus, toggleSelectLine, toggleSelectAllInOrder, handleBatchPrintOts }`.

**Cuidado específico:** este es también el lugar donde se arregló que cambiar de
compañía no limpiaba `selectedLines` (P2-01). Si `selectPartner` sigue en el componente
padre y `setSelectedLines` se mueve al hook, vas a necesitar que el hook exponga un
`clearSelection()` (o que el padre reciba el setter) para que `selectPartner` lo pueda
seguir limpiando. No pierdas esa línea en la extracción.

Checkpoint: `npm run lint && npx vitest run`

**3. `useOdooLineActions` — acciones por línea (imprimir/enviar a reporte/biblioteca)**

Archivo nuevo: `src/hooks/useOdooLineActions.ts`.

Mueve `catalogErrorMessage`, `ensureCatalogViews`, `resolveLineLink`,
`handlePrintLinePlano`, `handleSendLineToReport`, `handleOpenBibliotecaForLine` (L125-252)
más el estado que consumen (`lineBusyKey`, `lineActionError`, `sendingKey`,
`printDrawing`, `printSoNumber`, `printCantidad`). Recibe `catalog`, `bridge`,
`onSendToReport`, `onOpenBiblioteca` como parámetros.

Checkpoint: `npm run lint && npx vitest run`

**4. `useOdooOrdersFilters` — búsqueda, filtro de requisitor, agrupación**

Archivo nuevo: `src/hooks/useOdooOrdersFilters.ts`.

Mueve `uniqueRequisitores`, `searchMatchedOrders`, `filteredOrders`,
`groupedByRequisitor`, `toggleGroupCollapse` (L470-523) más `viewMode`, `searchTerm`,
`selectedRequisitor`, `collapsedRequisitores`. Recibe `orders` como parámetro.

**Cuidado específico:** este es el cluster donde se arregló que los contadores del
selector de requisitor ("TODOS (N)", cada opción) usaran `orders` sin filtrar en vez de
`searchMatchedOrders` (P2-02) — hay una razón por la que existen DOS memos encadenados
(`searchMatchedOrders` antes del filtro de requisitor, `filteredOrders` después): los
contadores del propio selector de requisitor no pueden auto-filtrarse por la opción que
están a punto de ofrecer. No colapses los dos memos en uno solo.

Checkpoint: `npm run lint && npx vitest run`

**5. Lo que se queda en `OdooOrdersPanel.tsx`**

Después de las 4 extracciones, el archivo debería quedar con: estado de
compañía/sync (`orders`, `productionMap`, `loading`, `error`, `selectedPartnerKey`,
`syncingOdoo`), `fetchOrders`/`selectPartner`/`startSyncTimer`/`handleRefresh`, el JSX
del header/banner/selector de compañía, y la orquestación de los 4 hooks/componente de
arriba. Debería quedar en algo como 350-450 líneas.

### Verificación final del Refactor 1

```bash
npm run lint
npx vitest run
npm run build
```

Luego, prueba manual con `npm run dev` (usa el botón "Omitir Login" en modo debug):
1. Entra a **Órdenes**, elige una compañía, confirma que la lista carga.
2. En una orden con al menos 2 líneas donde una ya esté entregada, prueba el checkbox
   "seleccionar todo" — debe reflejar el estado real (P1-07 no debe regresar).
3. Selecciona un par de líneas, cambia de compañía — la selección debe limpiarse sola
   (P2-01 no debe regresar).
4. Escribe algo en el buscador y confirma que el contador de "TODOS (N)" en el selector
   de requisitor refleja el resultado filtrado, no el total (P2-02 no debe regresar).
5. Imprime una OT individual y en lote — ambos flujos deben completar sin error.

---

## Refactor 2 — `useVisionAnalysis.ts` (hacerlo DESPUÉS del Refactor 1, con más cuidado)

Este es el núcleo del pipeline de auditoría: llamadas reales a Gemini, caché en
IndexedDB, generación de PDF de producción. Es más grande, más entrelazado, y sin red de
tests de componente. Dale su propia sesión — no lo empalmes con el Refactor 1 en el
mismo lote de commits.

### Mapa estructural actual

```
L209-291  ~25 useState (workshopPdfs, results, error, seedWarning, toolcribPdfToDrawing,
          seededBridgeLinks, filtros de vista, editMode, excludedOrders, etc.)
L593-1373 extractInfo() — UNA función de ~780 líneas. Tiene 5 pasos marcados por el
          propio autor con comentarios:
            L623  Paso 1+1.5: leer órdenes de Odoo + biblioteca Tool Crib (concurrente),
                  auto-matching de catálogo contra las órdenes
            L903  Paso 2: render progresivo de resultados iniciales (solo texto,
                  sin planos aún)
            L1044 Paso 3: análisis de planos con Gemini (dos pasadas, refinamiento,
                  merge progresivo conforme cada plano termina) — el paso más grande
            L1198 Paso 3b: fallback de imagen 3D generada por IA cuando no hay
                  ISO/eDrawing real
            L1271 Paso 4: resumen final (analysisSummary)
L1374-1486 Cluster de edición: snapshotOriginalOnce, handleEditCantidad, handleExcludeOrder,
          handleRestoreOrder, handleRestoreAll, handleUpdateOrderCrop
L1386-1444 generateAiIsometricForOrder + orderAiKey (generación de vista 3D IA bajo demanda)
L1508+    return { ...todo el objeto público del hook }
```

### El patrón de refs que DEBE sobrevivir cualquier extracción

`workshopPdfsRef`, `toolcribPdfToDrawingRef`, `seededBridgeLinksRef` son refs espejo de
sus respectivos `useState`, sincronizados vía `useEffect`. **No son decorativos.**

El motivo: la auto-auditoría disparada desde Órdenes hace `seedFromBridgeLinks()`
(que llama `setWorkshopPdfs`/`setToolcribPdfToDrawing`) e inmediatamente después llama
`extractInfo()`, de forma síncrona, antes de que React comitee el re-render. Si
`extractInfo` (o el código en que lo partas) lee `workshopPdfs`/`toolcribPdfToDrawing`
directo del closure en vez de `.current` del ref, agarra la copia vieja — eso causaba
que el mismo plano se descargara y analizara dos veces (era el bug P2-14 de la auditoría
anterior). Si partes `extractInfo` en funciones separadas, esas funciones **deben
seguir recibiendo el valor vía ref** (pásalo como parámetro leyendo `.current` en el
call site, o pasa el ref mismo) — no vuelvas a leer el `useState` a secas en ese punto
del flujo.

### Extracciones propuestas, en este orden (de menor a mayor riesgo)

**1. `useEditableResults` — edición de resultados en modo edición**

Archivo nuevo: `src/hooks/useEditableResults.ts`.

Mueve `snapshotOriginalOnce`, `handleEditCantidad`, `handleExcludeOrder`,
`handleRestoreOrder`, `handleRestoreAll`, `handleUpdateOrderCrop` (L1374-1486) más
`originalResults`/`excludedOrders`/`editMode`. Recibe `results`/`setResults` como
parámetros (o los mantiene si decides que este hook posee `results` — evalúalo, pero
recuerda que `extractInfo` también escribe `results`, así que probablemente `results`
se queda en el hook padre y este nuevo hook solo recibe `results`+`setResults`).

Es el cluster más aislado y de menor riesgo — buen primer paso para validar el patrón
antes de tocar `extractInfo`.

Checkpoint: `npm run lint && npx vitest run`

**2. `useAiIsometricGeneration` — generación de vista 3D IA bajo demanda**

Archivo nuevo: `src/hooks/useAiIsometricGeneration.ts`.

Mueve `generateAiIsometricForOrder`, `orderAiKey`, `isAiIsoGenerating`,
`aiIsoGeneratingKey` (L1386-1444 y su estado relacionado).

Checkpoint: `npm run lint && npx vitest run`

**3. `extractInfo` — el paso grande, hacerlo al final**

**No lo conviertas en hooks separados.** Los pasos 1-4 comparten estado mutable local de
UNA sola corrida (`bestMatchByOrder` Map, `orderEnrichmentByIdx` Map,
`matchedBlueprintFileIds` Set, contador `completedBlueprints`) — partirlos en hooks
independientes obligaría a pasar todo ese estado mutable entre hooks, lo cual es más
frágil que la función larga actual. La forma correcta de partir esto es en **funciones
async puras** dentro de `src/lib/visionPipeline/`, que `extractInfo` sigue orquestando
en secuencia:

- `src/lib/visionPipeline/fetchOrdersAndMatch.ts` — Paso 1+1.5. Recibe
  `currentWorkshopPdfs`, el ref de `toolcribPdfToDrawing`, `partnerKeyPrefix`; devuelve
  `{ ordersList, matchByOrder, currentWorkshopPdfs actualizado }`.
- `src/lib/visionPipeline/analyzeBlueprints.ts` — Paso 3 (el más grande y el más
  valioso de aislar: concurrencia, dos pasadas de Gemini, merge progresivo). Recibe la
  lista de planos + callbacks de progreso (`setResults`, `enqueueWorkshopStatusPatch`);
  devuelve el resumen final de matches.
- El fallback IA (paso 3b) puede quedarse como una función más en el mismo archivo o
  uno propio (`generateAiFallbackIso.ts`) si el paso 3 ya quedó razonablemente chico.

`extractInfo` en `useVisionAnalysis.ts` queda como el orquestador: arma el estado
inicial, llama a estas funciones en orden pasándoles refs/callbacks, y actualiza React
state con lo que devuelven. Esto es exactamente el patrón que ya usa el resto del
proyecto (`src/lib/` tiene funciones puras, `src/hooks/` orquesta con React state) —
no es una convención nueva.

**Antes de empezar este paso**, vuelve a leer las 5 marcas de comentario (`// 1 + 1.5:`,
`// 2.`, `// 3.`, `// 3b.`, `// 4.`) en el archivo actual — son los cortes naturales que
el propio autor ya dejó marcados.

Checkpoint después de CADA función extraída (no esperes a las 2-3 para verificar):
```bash
npm run lint && npx vitest run
```

### Verificación final del Refactor 2

```bash
npm run lint
npx vitest run
npm run build
```

Prueba manual con `npm run dev`, en **Generar Reporte**:
1. Pulsa "Ejecutar Auditoría" con al menos una orden que tenga plano en biblioteca —
   confirma que aparecen resultados progresivamente (no todo de golpe al final).
2. Confirma que al menos una pieza queda con su vista isométrica recortada.
3. Prueba "Editar reporte": cambia una cantidad, excluye una orden, restáurala.
4. Ajusta el Encuadre de una pieza con el filtro "Sin vista 3D" activo — debe aplicarse
   a la pieza correcta, no a otra (era el bug P1-05, arreglado por identidad de objeto
   no por índice — no lo rompas al mover `handleUpdateOrderCrop`).
5. Exporta CSV, JSON (si sigue existiendo) y PDF — los tres deben completar sin error.
6. Desde **Órdenes**, usa el botón "Reporte" de una línea para disparar la
   auto-auditoría — confirma en la pestaña Network/consola que el plano correspondiente
   **no se descarga dos veces** (era el bug P2-14; si vuelve, alguien rompió el ref).

---

## Orden recomendado de todo el plan

1. Confirmar baseline verde (los 4 comandos de arriba) y commitear el estado actual.
2. Refactor 1 completo, paso por paso con checkpoints, commit al terminar.
3. Refactor 2 completo, paso por paso con checkpoints — dale una sesión aparte.
4. Reportar de vuelta qué quedó, con conteo de líneas antes/después de cada archivo.
