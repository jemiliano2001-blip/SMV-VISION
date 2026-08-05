# Plan de limpieza SMV-VISION — 2026-08-05

**Para el agente ejecutor (Antigravity / Gemini):** este documento es la fuente de verdad
de esta tarea. Ejecuta las fases **en orden**. Cada fase termina con un comando de
verificación que debe pasar antes de seguir a la siguiente. Si un comando de verificación
falla, **detente y reporta** — no improvises un arreglo.

**Regla global:** este plan **borra** código. No agregues features, no crees abstracciones
nuevas, no "mejores de paso" archivos que no están listados. Si un archivo no aparece por
ruta exacta en este plan, no lo toques.

**Prohibido en este plan:**
- `git filter-branch`, `git filter-repo`, `bfg` o cualquier reescritura de historia.
- `npm install` de dependencias nuevas.
- Renombrar archivos o carpetas que no estén listados.
- Silenciar errores de TypeScript con `// @ts-ignore`, `_var`, `void x` o `any`. Si
  TypeScript se queja de algo no listado aquí, **detente y reporta**.

---

## Contexto: por qué existe este plan

La app tiene ~12,500 LOC en `src/` y ~4,300 LOC en `scripts/` + `functions/`. El
problema no es que falten features: es que **hay dos implementaciones del sync de Odoo
que llevan meses divergiendo en silencio**, y `CLAUDE.md` afirma que comparten lógica
(no la comparten). Los ~14 scripts de debug en `scripts/` existen precisamente porque
alguien estuvo persiguiendo diferencias entre las dos.

El resultado de este plan es **~2,200 LOC menos, ~240 MB menos en el repo, y una sola
ruta de sincronización**. No hay features nuevas.

---

## FASE 0 — Corregir `CLAUDE.md` (hacer esto PRIMERO)

**Por qué primero:** `CLAUDE.md` son las instrucciones que lee el agente antes de tocar
código. Hoy describe un pipeline que ya no existe. Si no se corrige primero, el agente
va a defender (o re-agregar) exactamente el código muerto que este plan borra.

Archivo: `CLAUDE.md` (raíz del proyecto).

### 0.1 — Corregir el paso 1 del pipeline

En la sección `### Analysis pipeline (src/hooks/useVisionAnalysis.ts)`, el punto **1.
Order extraction** dice hoy que `gemini-3.5-flash` lee un PDF de reporte de órdenes.
**Eso es falso.** Reemplázalo por:

> 1. **Order extraction** — Las órdenes vienen de Firestore (`odooSaleOrders`) vía
>    `listOrdersToInvoice()`. No hay PDF de órdenes ni llamada a Gemini en este paso.
>    Cada línea de orden con `qty_pending_from_pickings > 0` se mapea a un
>    `ExtractedOrder`. La constante `ORDER_PROMPT_VERSION` sobrevive **solo** como
>    etiqueta en el log de auditoría `analysisRuns`.

### 0.2 — Corregir el umbral de refinamiento

Buscar `REFINEMENT_SKIP_AREA_THRESHOLD = 200_000` (aparece en el punto 4 del pipeline).
El valor real en `src/hooks/useVisionAnalysis.ts:66` es `400_000`. Corregir el número y
la descripción a: `400_000` (~632×632 px).

### 0.3 — Corregir la afirmación falsa sobre el sync

En la sección `**Odoo sync**`, la frase que dice que la Cloud Function *"reutiliza la
misma lógica y credenciales"* que `scripts/syncOdoo.ts` es **falsa**: son dos
implementaciones independientes con dos clientes XML-RPC distintos. Reemplazar esa
sección completa por:

> **Odoo sync** — La Cloud Function V2 es la **única** ruta de sincronización.
> Fuente: `functions/src/index.ts`. Exporta `syncSuprajitOrders` (schedule cada 30 min)
> y `triggerOdooSync` (callable, requiere `request.auth`; la usa el botón REFRESCAR de
> `OdooOrdersPanel`). Ambas llaman a `runSync()`. Escribe `odooSaleOrders`, `workOrders`
> y `syncMeta/odoo`.

### 0.4 — Documentar los módulos que faltan

En `### Component tree` y `### Firebase layer`, agregar los que hoy no aparecen:

- `src/components/EntregasSinOCPanel.tsx` — vista "Entregas sin OC": órdenes de SUPRAJIT
  con remisión entregada pero sin número de OC del cliente. Depende de
  `listEntregasSinOC()` y del campo `state` del documento de Odoo.
- `src/components/InvoiceRequestPanel.tsx` — se renderiza **dentro** de
  `OdooOrdersPanel`, no es una vista del NavRail.
- `src/lib/invoiceEmail.ts` — plantillas de correo de solicitud de factura.
- `src/lib/planoOt.ts` — usado por `ToolcribPrintModal`.
- `src/hooks/useSyncMeta.ts` — suscripción al doc `syncMeta/odoo` (chip de estado).
- `src/lib/firebase/syncOdoo.ts` — wrapper cliente de `httpsCallable('triggerOdooSync')`.
- `src/lib/firebase/authValidators.ts` — normalización de forma para el usuario de Auth.

### 0.5 — Actualizar la lista de comandos

En el bloque `## Commands`, borrar estas líneas (los scripts se eliminan en la Fase 2):

```
npm run sync:odoo
npm run sync:odoo:dry
npm run sync:odoo:install-task
npm run sync:server
npm run sync:server:install-task
```

Y agregar una nota: *"El sync corre en la nube (Cloud Function). No hay sync local."*

### ✅ Verificación Fase 0

```bash
grep -c "reutiliza la misma lógica" CLAUDE.md    # debe imprimir 0
grep -c "200_000" CLAUDE.md                      # debe imprimir 0
grep -c "sync:odoo" CLAUDE.md                    # debe imprimir 0
grep -c "EntregasSinOCPanel" CLAUDE.md           # debe imprimir 1 o más
```

Commit: `docs(claude): corregir pipeline de órdenes, umbral y ruta de sync`

---

## FASE 1 — Sacar los PDFs del control de versiones

**Problema:** hay **819 PDFs rastreados** en git (`TOOL CRIB/` = 573 archivos / 164 MB,
`TOOL CRIB - copia/` = 246 archivos / 80 MB). El `.git` pesa 98 MB. Estos PDFs ya viven
en Firebase Storage (campo `pdfUrl` de `toolcribDrawings`) — el repo es una copia.

**Importante — leer antes de ejecutar:**
- **NO reescribas la historia.** Los 98 MB de `.git` se quedan. El objetivo es *dejar de
  crecer*, no encoger. Reescribir historia en un repo con trabajo ya publicado es
  riesgoso y no vale la pena para 98 MB.
- **`TOOL CRIB/` se queda en el disco.** Los scripts `scripts/toolcribBootstrap.ts` y
  `scripts/toolcribUploadPdfs.ts` la escanean. Solo deja de estar *rastreada*.
- **`TOOL CRIB - copia/` sí se borra del disco.** Es una copia literal duplicada.

### 1.1 — Agregar al `.gitignore`

Agregar al final de `.gitignore`:

```
TOOL CRIB/
TOOL CRIB - copia/
firestore-debug.log
```

### 1.2 — Dejar de rastrear (sin borrar del disco)

```bash
git rm -r --cached "TOOL CRIB" "TOOL CRIB - copia"
git rm --cached firestore-debug.log
```

### 1.3 — Borrar la carpeta duplicada del disco

```bash
rm -rf "TOOL CRIB - copia"
```

### ✅ Verificación Fase 1

```bash
git ls-files | grep -c "TOOL CRIB"      # debe imprimir 0
test -d "TOOL CRIB" && echo "OK: TOOL CRIB sigue en disco"
test -d "TOOL CRIB - copia" || echo "OK: copia eliminada"
```

Commit: `chore(repo): dejar de rastrear PDFs de TOOL CRIB (viven en Storage)`

---

## FASE 2 — Borrar los scripts de debug de un solo uso

Estos 14 archivos son sondas de depuración que se escribieron para perseguir
discrepancias entre los dos syncs. Ninguno está referenciado en `package.json` ni
importado por nadie. Git los conserva en la historia si algún día hacen falta.

**Borra exactamente estas rutas:**

```
scripts/checkFb.ts
scripts/checkInvoiceStatus.ts
scripts/checkLines.ts
scripts/checkLogic.ts
scripts/checkSpecificSOs.ts
scripts/cleanupOdooFunctionDocs.ts
scripts/diagnoseMissingOrders.ts
scripts/dumpOdoo.ts
scripts/dumpWOs662.ts
scripts/fixToInvoiceField.ts
scripts/listLines.ts
scripts/testFields.ts
scripts/testOdoo.ts
scripts/testOrder781.ts
```

**NO borres** (están referenciados en `package.json` o son utilidades vigentes):
`scripts/toolcribBootstrap.ts`, `scripts/toolcribDedupeDrawings.ts`,
`scripts/toolcribUploadPdfs.ts`, `scripts/toolcribMergeDuplicates.ts`.
`scripts/syncOdoo.ts` y `scripts/syncServer.ts` se borran en la **Fase 5**, no aquí.

### ✅ Verificación Fase 2

```bash
ls scripts/*.ts | wc -l          # debe imprimir 6
npx tsc --noEmit                 # debe salir con código 0
```

Commit: `chore(scripts): borrar 14 sondas de debug de un solo uso`

---

## FASE 3 — Borrar el código muerto en `src/`

Restos del flujo viejo donde las órdenes salían de un PDF. Hoy salen de Odoo, pero los
imports siguen ahí. `tsc` no los detecta porque `tsconfig.json` no tiene `noUnusedLocals`.

### 3.1 — Imports muertos en `src/hooks/useVisionAnalysis.ts`

Borra estos bindings de import (algunos son el import completo, otros solo parte de él —
lee cada línea antes de editar):

| Línea aprox. | Binding a borrar | Nota |
|---|---|---|
| 13 | `WorkOrder` | del `import type {...}` — deja los demás |
| 22 | `formatAgeDays`, `getOrderAgeDays` | **borra el import completo** de `'../lib/age'` |
| 32 | `mergeGroupedOrders`, `parseOrdersResponse`, `validateOrderPdfName` | **borra el import completo** de `'../lib/orderMerge'` |
| 33 | `consolidateHotStamps` | deja `isHotStampCatalogEntry`, `isHotStampPiece` (sí se usan) |
| 34-38 | `cleanPieceName`, `withPartNumber`, `collapseDuplicateOrders` | **borra el import completo** de `'../lib/reportFormat'` |
| 45-50 | `isRecord`, `asString` | deja `parseBoundingBox`, `parseBlueprintResponse` |

⚠️ **Cuidado:** `orderMerge.ts`, `hotStamp.ts` y `reportFormat.ts` **NO** son archivos
muertos — `src/lib/pdfGenerator.ts` usa `consolidateHotStamps`, `cleanPieceName`,
`withPartNumber` y `collapseDuplicateOrders`, y `hotStamp.ts`/`reportFormat.ts` importan
`parseCantidadNumber`/`extractCantidadUnit` de `orderMerge.ts`. **No borres esos tres
archivos.** Solo quita los imports muertos del hook.

### 3.2 — Constante muerta

Borrar la línea `const GEMINI_ORDER_MODEL = 'gemini-3.5-flash';` en
`src/hooks/useVisionAnalysis.ts` (~línea 67). No se usa. Deja `GEMINI_BLUEPRINT_MODEL`.

### 3.3 — Exports muertos en `src/lib/orderMerge.ts`

Con los imports de 3.1 borrados, estas tres funciones exportadas quedan sin ningún
consumidor. Bórralas del archivo (y cualquier helper privado que quede huérfano):

- `mergeGroupedOrders`
- `parseOrdersResponse`
- `validateOrderPdfName`

**Conserva** `parseCantidadNumber` y `extractCantidadUnit` — las usan `hotStamp.ts` y
`reportFormat.ts`.

### 3.4 — Archivos huérfanos (cero importadores)

Borra:

```
src/hooks/useResultsDisplay.ts
```

### 3.5 — Opciones fantasma del hook

En `src/App.tsx:81`:

```ts
const vision = useVisionAnalysis({ findWorkOrderId: () => null, onDataChanged: () => {} });
```

`UseVisionAnalysisOptions` es una interfaz **vacía** — esas dos props se descartan en
silencio. Cámbialo por:

```ts
const vision = useVisionAnalysis();
```

### 3.6 — Locales muertas en `handleRestoreAll`

En `src/hooks/useVisionAnalysis.ts` (~línea 1158), `handleRestoreAll` declara
`const current = ...` y `const excluded = ...` que nunca se usan. Bórralas. Además el
array de dependencias del `useCallback` queda como `[originalResults]`, que es correcto
una vez borradas.

### 3.7 — Activar el detector (hacer esto AL FINAL de la fase)

**El orden importa:** activa el flag *después* de borrar todo lo anterior, no antes. Si
lo activas primero, TypeScript va a escupir errores en los 14 scripts que la Fase 2 ya
eliminó y en código que estás por borrar.

En `tsconfig.json`, dentro de `compilerOptions`, agregar **solo esta línea**:

```json
"noUnusedLocals": true
```

⚠️ **No agregues `noUnusedParameters`.** Ese flag marca parámetros sin usar en todo
`src/` (callbacks de React con el arg de evento sin usar, bindings de `catch`, `.map((x, i))`
donde `i` no se usa). No hay evidencia de que el código esté limpio en ese eje y no es lo
que estamos cazando aquí. `noUnusedLocals` solo ya atrapa toda la clase de import muerto
que este plan encontró.

Corre `npx tsc --noEmit`. Si aparece un error en un archivo **no listado en este plan**,
**detente y reporta** — no lo arregles por tu cuenta.

### ✅ Verificación Fase 3

```bash
npx tsc --noEmit    # debe salir con código 0
npm test            # debe pasar
npm run build       # debe completar
```

Commit: `refactor(vision): borrar restos del flujo de órdenes por PDF + activar noUnusedLocals`

---

## FASE 4 — Corregir el texto de UI que miente

La vista "Generar Reporte" todavía le dice al operador que suba un PDF de órdenes. Las
órdenes llegan solas desde Odoo desde hace tiempo. Esto confunde a quien la usa en el
taller.

En `src/App.tsx`:

| Línea aprox. | Texto actual | Reemplazar por |
|---|---|---|
| 258 | `Carga el reporte de pedidos y selecciona planos para iniciar` | `Presiona "Ejecutar Auditoría" — las órdenes se leen de Odoo automáticamente` |
| 261 | `['01', 'Carga el PDF de órdenes generado por Google Sheets.']` | `['01', 'Las órdenes pendientes se leen de Odoo automáticamente.']` |

### ✅ Verificación Fase 4

```bash
grep -c "Google Sheets" src/App.tsx    # debe imprimir 0
npm run build                          # debe completar
```

Commit: `fix(ui): el texto de Generar Reporte ya no pide un PDF de órdenes`

---

## FASE 5 — Consolidar el sync de Odoo en la Cloud Function

⚠️ **Esta es la única fase que puede romper producción.** Todo lo anterior es inerte.
No la empieces si alguna verificación previa falló.

### El problema

Hay **dos** implementaciones completas del mismo sync:

| | `scripts/syncOdoo.ts` | `functions/src/index.ts` |
|---|---|---|
| LOC | 1,002 | 866 |
| Cliente XML-RPC | escrito a mano (~300 LOC de parseo XML) | librería `odoo-xmlrpc` |
| Cómo corre | tarea de Windows en la PC de Emiliano | Cloud Function, cada 30 min |
| Escribe `odooSaleOrders` | ✅ | ✅ |
| Escribe `workOrders` | ❌ | ✅ |
| Escribe `syncMeta` | ✅ | ✅ |

**Ya verificado — no lo re-verifiques:**
- Mismo doc ID: ambos usan `order.name.replace(/\//g, '_')` → **no hay documentos
  duplicados en Firestore**.
- Mismo campo de cantidad: ambos escriben `qty_pending_from_pickings` (el que lee
  `useVisionAnalysis.ts:592`).
- Odoo está en `https://system.maquinadosvazquez.com` — **HTTPS público**, así que la
  Cloud Function lo alcanza sin problema. No hace falta la PC local.

### 5.1 — El hueco que hay que tapar ANTES de borrar nada

**La Cloud Function no escribe el campo `state`. El script sí.**

`src/lib/firebase/odooOrders.ts:256` filtra con `if (normalized.state !== 'draft') return;`
dentro de `listEntregasSinOC()`. Si borras el script sin tapar esto, los documentos
nuevos llegan sin `state`, `normalizeOdooOrder` los normaliza a `'unknown'`, y la vista
**"Entregas sin OC" se queda vacía para siempre**. No truena — se vacía en silencio, que
es peor.

**Arreglo:** en `functions/src/index.ts`, en `upsertSaleOrders()` (~línea 455), agregar
`state` al payload, justo después de `invoice_status`:

```ts
invoice_status: order.invoice_status,
state: order.state,
toInvoice: isActiveOrder,
```

Para que exista, `state` debe venir de Odoo y estar en el tipo:

1. En `interface SaleOrder` (~línea 98), agregar: `state: string;`
2. En `fetchSaleOrders()` (~línea 255), agregar `"state"` a la lista de campos que se
   piden a Odoo (donde ya se piden `name`, `date_order`, `partner_id`, etc.).
3. Al construir el objeto `SaleOrder`, mapear: `state: strOf(row.state),`

### 5.2 — Desplegar y verificar UN ciclo antes de borrar

```bash
npm --prefix functions run build
firebase deploy --only functions
```

Luego, **desde la app** (no desde la terminal): abre la vista Órdenes Odoo y presiona
**REFRESCAR**. Espera a que el chip de estado diga OK.

**Tres verificaciones obligatorias antes de continuar. Si cualquiera falla, detente y
reporta — no borres nada.**

**(a) El campo `state` llega.** Abre la vista **"Entregas sin OC"**. Debe mostrar las
mismas órdenes que mostraba antes del deploy. Si sale vacía, `state` no se está
escribiendo.

**(b) El schedule de la nube realmente funciona.** Esto es lo más importante de la fase.
`CLAUDE.md` degradaba a `syncSuprajitOrders` a *"legacy… kept for parity"* y decía que el
sync de verdad era la tarea de Windows. Si el schedule lleva meses fallando en silencio
mientras la tarea de Windows cargaba el trabajo, esta fase estaría borrando el que
funciona y quedándose con el roto.

```bash
firebase functions:log --only syncSuprajitOrders --limit 20
```

Debe mostrar corridas recientes exitosas, **no** `❌ Error crítico` repetido. El botón
REFRESCAR del paso anterior solo prueba el *callable* (`triggerOdooSync`), no el
*schedule* — son dos triggers distintos sobre el mismo `runSync`.

**(c) Las cuatro variables de Odoo resuelven en la función desplegada.** Solo
`ODOO_API_KEY` está declarada como `defineSecret`; `ODOO_URL`, `ODOO_DB` y `ODOO_USER`
se leen de `process.env`. Si nunca se configuraron como variables de entorno de la
función, el schedule truena con *"Faltan variables de entorno de Odoo"* aunque el
callable funcione. Confírmalo con:

```bash
firebase functions:config:get
firebase functions:secrets:access ODOO_API_KEY
```

Si (b) o (c) fallan: el `runSync` está sano (lo probó el botón REFRESCAR), el problema es
la configuración del schedule. Arregla eso primero. **No** vuelvas a la ruta local.

### 5.3 — Solo si 5.2 pasó: borrar la ruta local

Borra estas rutas:

```
scripts/syncOdoo.ts
scripts/syncServer.ts
scripts/installSyncTask.ps1
scripts/installSyncServerTask.ps1
scripts/runOdooSync.ps1
scripts/runSyncServer.ps1
```

En `package.json`, borra estos scripts:

```
"sync:odoo"
"sync:odoo:dry"
"sync:odoo:install-task"
"sync:server"
"sync:server:install-task"
```

En `package.json` → `devDependencies`, borra `express` y `@types/express` (solo los usaba
`syncServer.ts`). Luego corre `npm install` **sin argumentos**, únicamente para que el
lockfile refleje las dos remociones. No instala nada nuevo — no contradice la regla
global de "no agregar dependencias".

### 5.4 — Quitar el fallback a `localhost:3031`

En `src/components/OdooOrdersPanel.tsx`, la función `handleRefresh` (~líneas 297-328)
intenta `fetch('http://localhost:3031/sync')` cuando la Cloud Function falla. Ese
servidor ya no va a existir. Además el fallback tiene un defecto: en la rama de éxito
(`if (res.ok) return;`) nunca limpia el spinner ni recarga las órdenes — solo la rama
`catch` hace limpieza.

Reemplaza el cuerpo completo de `handleRefresh` por:

```ts
const handleRefresh = useCallback(async () => {
  startSyncTimer();

  const result = await triggerOdooSync();
  if (result.ok) return;   // el watcher de syncMeta limpia el spinner y recarga

  clearInterval(syncTimeoutRef.current!);
  setSyncingOdoo(false);
  setError(
    result.reason === 'not-authenticated'
      ? 'Debes iniciar sesión para sincronizar.'
      : `No se pudo sincronizar con Odoo: ${result.reason}`,
  );
}, [startSyncTimer]);
```

Nota: el `useEffect` que observa `meta.lastSyncAt` (~línea 265) es el que limpia el
spinner y llama a `fetchOrders()` en el camino feliz, y el timer tiene un tope de 120 s.
Por eso la rama de éxito solo hace `return`. **No** agregues un `fetchOrders()` ahí —
duplicaría la lectura.

### 5.5 — Desactivar las tareas de Windows (esto lo hace Emiliano, no el agente)

Las dos tareas programadas siguen registradas en Windows y van a fallar cada hora
buscando un script que ya no existe. **No las borres desde el agente** — deja esta nota
en el reporte final para que Emiliano corra a mano, en PowerShell como administrador:

```powershell
Unregister-ScheduledTask -TaskName "SMV Odoo Sync" -Confirm:$false
Unregister-ScheduledTask -TaskName "SMV Sync Server" -Confirm:$false
```

### ✅ Verificación Fase 5

```bash
npx tsc --noEmit                      # código 0
npm --prefix functions run build      # código 0
npm test                              # pasa
npm run build                         # completa
ls scripts/*.ts | wc -l                             # debe imprimir 4
ls scripts/*.ps1 2>/dev/null | wc -l                # debe imprimir 0
grep -c "3031" src/components/OdooOrdersPanel.tsx   # debe imprimir 0
```

Y en la app desplegada: botón REFRESCAR funciona, "Entregas sin OC" tiene datos.

Commit: `refactor(sync): una sola ruta de sync (Cloud Function); borrar el sync local`

---

## Resumen del impacto

| Fase | Qué se va | LOC | Riesgo |
|---|---|---|---|
| 0 | Documentación falsa en `CLAUDE.md` | — | Ninguno |
| 1 | 819 PDFs rastreados + carpeta duplicada | — (~240 MB) | Ninguno |
| 2 | 14 scripts de debug | ~1,090 | Ninguno |
| 3 | Imports/exports/archivos muertos en `src/` | ~120 | Bajo |
| 4 | Texto de UI que miente | ~2 | Ninguno |
| 5 | Sync de Odoo duplicado | ~1,120 | **Medio** |
| | **Total** | **~2,330 LOC** | |

Cero features nuevas. Cero dependencias nuevas. Una dependencia menos (`express`).

---

## Lo que este plan NO hace, a propósito

- **No reescribe la historia de git.** Los 98 MB se quedan. Encogerlos no vale el riesgo.
- **No agrega tests.** La lógica frágil (`matching.ts`) ya tiene el suyo, y agregarle
  tests a código que estamos borrando es trabajo tirado.
- **No refactoriza `useVisionAnalysis.ts` (1,210 LOC) ni `OdooOrdersPanel.tsx` (782 LOC).**
  Son grandes, pero funcionan y nadie se está quejando de ellos. Partirlos es un cambio
  de riesgo medio sin beneficio medible hoy. Si en el futuro cuesta trabajo editarlos,
  ese es el momento — no antes.
- **No toca el pipeline de Gemini ni los prompts.** Están afinados y en producción.
- **No unifica los dos clientes XML-RPC "para reutilizar".** Se borra uno. Un cliente no
  necesita abstracción.

## Decisión pendiente para Emiliano (no la tome el agente)

`src/lib/metricsBaseline.ts` (92 LOC) no lo importa nadie en producción — `useVisionAnalysis`
reimplementa esa misma lógica en línea (`readBaselineMetrics` / `calculateMetricsComparison`).
Además, el panel "Métricas de rendimiento" que sale al pie del reporte (`App.tsx:574-592`)
le muestra milisegundos y un "Delta baseline" a un operador de taller.

Dos opciones, ninguna urgente:
- **(a)** Borrar `metricsBaseline.ts`, su test, el estado `metricsComparison` y el panel
  de la UI. −150 LOC aprox.
- **(b)** Dejarlo como está.

Este plan **no** ejecuta ninguna de las dos. Decidir aparte.
