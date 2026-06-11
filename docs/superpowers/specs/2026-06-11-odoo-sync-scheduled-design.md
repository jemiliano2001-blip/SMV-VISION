# Sync Odoo programado y único — Design Spec

**Date:** 2026-06-11
**Status:** Approved
**Supersedes:** parte del spec `2026-06-08-odoo-sync-status-design.md` (la Cloud Function que ahí se describe fue retirada; el shape de `syncMeta/odoo` y el chip del frontend se conservan sin cambios).

## Context

Existían dos syncs de Odoo compitiendo:

1. `scripts/syncOdoo.ts` — el sync completo (líneas, traslados, OTs con dedup y archivado), pero manual (`npm run sync:odoo`). Las OTs que creaba quedaban sin `dueDate` y sin plano matcheado.
2. La Cloud Function `syncSuprajitOrders` (cada 30 min) — primitiva: escribía encabezados crudos de `sale.order` directo en `workOrders` con doc ID = nombre de orden. Los nombres con `/` (p. ej. "2026/S00288") hacían que la escritura lanzara antes del commit del batch, por lo que **nunca llegó a escribir docs** (verificado: 0 docs basura en 1336). Era además quien escribía `syncMeta/odoo`, así que el chip de estado reflejaba a la función primitiva, no al sync real.

Decisión: consolidar en el script local, programado con Windows Task Scheduler, y retirar la Cloud Function. Usuario único; la PC de trabajo está encendida en horario hábil.

## Design

### 1. `scripts/syncOdoo.ts` es la única fuente de verdad

- Escribe `syncMeta/odoo` al final de cada corrida con el shape que ya lee `src/lib/firebase/syncMeta.ts` (sin cambios en frontend): `{ lastSyncAt, ordersProcessed, status: 'ok'|'error', errorMessage? }` + extras informativos `otsCreated`, `otsUpdated`, `otsArchived`, `otsMatched`.
- Firebase Admin se inicializa **antes** de llamar a Odoo: un fallo de autenticación/red con Odoo también queda registrado (`failSync()` escribe el error y sale con código 1).
- Fallo parcial (upserts fallidos u OTs con error) ⇒ `status: 'error'` con mensaje.
- En `--dry-run` no se escribe `syncMeta`.

### 2. OTs de Odoo nacen completas

- `dueDate = addDaysToISODate(otDate, 14)` (reuso de `src/lib/age.ts`; mismo ciclo default que el upsert de la app en `src/lib/firebase/workOrders.ts`). Solo OTs nuevas.
- Matching de planos sin Gemini: `fetchToolcribLibrary()` (espejo Admin-SDK de `listActiveDrawingViews`: parts SUPRAJIT + drawings activos, join por `partId`) + `selectLibraryDrawingMatch()` — helper puro nuevo en `src/lib/matching.ts` extraído de `useVisionAnalysis` (que ahora lo reutiliza), con regla ISO-first y umbral 80. Hot stamp se resuelve por keyword (`isHotStampPiece` + `isHotStampCatalogEntry`) con score nominal 80.
- `matchedPartId` / `matchedDrawingId` / `matchScore` se pueblan solo en OTs nuevas; sin match quedan en null como antes.

### 3. Programación (Windows Task Scheduler)

- `scripts/runOdooSync.ps1` — wrapper: ejecuta el sync desde la raíz del repo y anexa salida a `logs/syncOdoo.log` (truncado a 1 MB; `*.log` ya está gitignored).
- `scripts/installSyncTask.ps1` (`npm run sync:odoo:install-task`) — registra/reemplaza la tarea **SMV Odoo Sync**: cada hora de 7:00 a 19:00, L–V, ventana oculta, `-StartWhenAvailable`.
- Visibilidad de fallos: el chip muestra `ERROR SYNC` si una corrida falla; si la PC estuvo apagada, el "hace Nh" envejece.

### 4. Retiro de la Cloud Function

- `syncSuprajitOrders` eliminada del proyecto `smv-brain` (`firebase functions:delete`). Carpeta `functions/` eliminada del repo (también desbloquea `npm run lint`, que fallaba por ese archivo).
- `scripts/cleanupOdooFunctionDocs.ts` (dry-run default, `--execute` borra) detecta docs con shape de la función (sin `status`/`archived`, con `amount_total`/`state`/`name`). Ejecutado: 0 encontrados.

## Out of Scope

- Cola de revisión de matches en zona gris (60–79) con aliases persistentes.
- QR en el plano stampeado para cierre de OT por el tornero.
- Notificaciones push/email en fallo de sync.
