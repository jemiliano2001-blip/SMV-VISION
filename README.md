<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/5f47ea43-a1be-4acc-8542-a27d77a0afd4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and fill in the `VITE_FIREBASE_*` values
   (Firebase project settings → Web App). The app needs Firebase configured
   locally: Gemini calls go through the `analyzeGemini` Cloud Function, not
   directly from the browser (see "Análisis vía Gemini" below), and the Cloud
   Functions emulator needs `firebase emulators:start` running with
   `GEMINI_API_KEY` set as a local secret override.
3. Run the app:
   `npm run dev`

## Análisis vía Gemini (Cloud Function)

El navegador **nunca** tiene la API key de Gemini. Todas las llamadas (análisis de plano, refinamiento de bounding box, generación de vista 3D IA) pasan por la Cloud Function callable `analyzeGemini` (`functions/src/gemini.ts`), que exige `request.auth` y lee la key desde Secret Manager.

Configurar el secreto (una sola vez por proyecto Firebase):

```
firebase functions:secrets:set GEMINI_API_KEY
```

Desplegar:

```
firebase deploy --only functions:analyzeGemini
```

Sin esto, el botón "Analizar" falla con "Firebase no está configurado — no es posible llamar a Gemini" (si falta `VITE_FIREBASE_*`) o con un error `unauthenticated`/`internal` de la función (si falta el secreto o no hay sesión iniciada).

## Audit trail en Firebase

Este workspace está vinculado al proyecto de Firebase **`smv-brain`** (ver `.firebaserc`). Cada corrida de análisis (éxito o error) se registra en la colección Firestore `analysisRuns` con `serverTimestamp()` en UTC, hashes SHA-256 de los PDFs, versiones de prompt y el `userUid` del usuario autenticado — cumpliendo la trazabilidad inquebrantable del sistema SMV.

El audit trail es **fire-and-forget**: si falta configuración o la escritura falla, la app sigue funcionando normalmente — nunca bloquea ni rompe el flujo de Gemini.

### Autenticación (obligatoria para escribir audit trail)

A partir de PR #2a la app exige iniciar sesión con Google antes de analizar. El componente `AuthGate` muestra una pantalla completa de login y sólo renderiza la app cuando hay un `User` activo. Las reglas de Firestore verifican que `request.auth.uid == userUid` en cada `create`.

- Para desarrollo local: usa cualquier cuenta Google con la que tu proyecto `smv-brain` tenga permitido el sign-in. En la Firebase Console → **Authentication → Sign-in method**, el proveedor Google debe estar habilitado (ya lo hace `firebase init auth`).
- Si las variables `VITE_FIREBASE_*` faltan, `AuthGate` muestra un banner de advertencia y deja pasar la app sin login (audit trail desactivado, no bloquea el análisis).

### App Check (recomendado en producción)

App Check protege los endpoints de Firebase con reCAPTCHA v3.

- **Producción**: registra tu dominio en [reCAPTCHA v3 admin](https://www.google.com/recaptcha/admin) y pega el *site key* en `VITE_RECAPTCHA_SITE_KEY`. El reCAPTCHA secret lo pegas en Firebase Console → App Check → Apps → comando_SMV.
- **Desarrollo**: deja `VITE_RECAPTCHA_SITE_KEY=""` y `VITE_APPCHECK_DEBUG="true"`. Al abrir la app, Firebase imprime en consola un **debug token**: cópialo y regístralo en Firebase Console → App Check → Manage debug tokens. Mientras no esté registrado, las requests fallarán con "App Check token missing/invalid" una vez que App Check esté **enforced** en la consola.
- Mientras App Check no esté enforced en la consola, la app funciona normalmente. Habilita enforce sólo cuando hayas validado que dev y prod tienen tokens funcionando.

### Activarlo en dev

Copia a `.env.local` las variables `VITE_FIREBASE_*` (ver `.env.example`). Los valores están en la consola de Firebase → Project settings → `comando_SMV` Web App.

### Desplegar las reglas e índices

```
npx firebase deploy --only firestore:rules,firestore:indexes
```

Las reglas (`firestore.rules`) hacen los documentos **inmutables** tras crear: no permiten update ni delete, validan el set exacto de campos y exigen `request.auth.uid == userUid`. Los índices compuestos están en `firestore.indexes.json`.

## Biblioteca Tool Crib (v1 read-only)

A partir de esta versión, los planos de Suprajit se consultan desde una **biblioteca persistente** en Firebase en lugar de tener que arrastrarlos a la app cada vez. El alcance v1 es **sólo lectura + impresión con audit trail**.

### Colecciones Firestore

- `toolcribParts` — catálogo maestro de partes (`partNumber`, `customer`, `description`, `status`, `createdAtUTC`, `updatedAtUTC`).
- `toolcribDrawings` — una revisión por documento (`partId`, `revision`, `isActive`, `sourceType` `network`/`storage`, `sourcePath`, `pdfUrl`, `checksumSha256`, `effectiveFromUTC`, `createdAtUTC`, `createdByUid`).
- `toolcribPrintLogs` — audit trail inmutable de impresiones (`drawingId`, `partId`, `copies`, `orderRef`, `origin`, `printedByUid`, `printedAtUTC`).

Reglas clave:

- Lectura autenticada en `toolcribParts` y `toolcribDrawings`; escritura bloqueada desde la app (se realiza vía bootstrap/Console).
- `toolcribPrintLogs` sólo admite `create` con `printedByUid == request.auth.uid`, `printedAtUTC == request.time` y el set exacto de campos; `update/delete` prohibidos.

### Flujo diario

1. Abre la app e inicia sesión.
2. En la columna izquierda, panel **Biblioteca Tool Crib (planos Suprajit)**:
   - Busca por número de parte, descripción o revisión.
   - Cada fila muestra la **revisión activa** con la ruta del PDF maestro.
   - Botón **Imprimir** abre el PDF (si hay `pdfUrl`) y registra la acción en `toolcribPrintLogs` con tu `uid` y UTC.
   - Botón **Análisis** descarga el PDF y lo adjunta al flujo de análisis existente (aparece en el bloque 2 junto con los PDFs manuales). Requiere `pdfUrl` accesible.
3. El flujo manual (drag & drop) sigue disponible como fallback cuando el PDF no esté en la biblioteca aún.

### Carga inicial / mantenimiento (bootstrap)

Para poblar por primera vez o actualizar metadatos, usa el script con **Admin SDK**:

1. Descarga la service account JSON desde Firebase Console → Project settings → Service accounts.
2. Guarda `inventory.json` siguiendo `scripts/toolcribBootstrap.example.json` (incluye `partNumber`, `description`, y para cada revisión: `revision`, `isActive`, `sourceType`, `sourcePath`, `pdfUrl`, `effectiveFromUTC`).
3. Primer paso: valida en seco:

```
npm run toolcrib:bootstrap -- --inventory=./inventory.json --credentials=./serviceAccount.json --dryRun
```

4. Si la salida es la esperada, elimina `--dryRun` para escribir a Firestore:

```
npm run toolcrib:bootstrap -- --inventory=./inventory.json --credentials=./serviceAccount.json
```

El script es idempotente: usa IDs determinísticos basados en `(customer, partNumber)` y `(partId, revision)`, garantiza **una sola revisión activa por parte** y añade `createdAtUTC` + `createdByUid='bootstrap-v1'` sólo en creaciones.

### Desplegar reglas/índices Tool Crib

Ejecuta el mismo comando de Firestore que el audit trail para sincronizar las colecciones nuevas (`toolcribParts`, `toolcribDrawings`, `toolcribPrintLogs`):

```
npx firebase deploy --only firestore:rules,firestore:indexes
```

