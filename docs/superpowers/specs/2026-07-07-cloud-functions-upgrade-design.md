# Upgrade Cloud Functions: firebase-functions v4→v7, firebase-admin v11→v13, Node 20→22 — 2026-07-07

## Contexto

`functions/` fue reconstruido desde el compilado (`functions/lib/index.js`) hacia
TypeScript (`functions/src/index.ts`) en un trabajo previo (commit `d28b70b`). En ese
momento se mantuvieron las versiones instaladas (`firebase-functions@4.9.0`,
`firebase-admin@11.11.1`, `engines.node: "20"`) para minimizar riesgo durante la
reconstrucción. Node 20 en Cloud Functions Gen 2 se retira el 2026-10-30 (aviso propio de
Firebase en el deploy). Se decide actualizar ahora, como pieza de trabajo separada del
resto de mejoras ya desplegadas.

Alcance: solo `functions/`. No toca el resto de la app, ni la lógica de negocio del sync
de Odoo, ni las reglas de Firestore/Storage.

## Decisiones (confirmadas por el usuario)

- **Versión objetivo**: directo a la última — `firebase-functions ^7.2.5`,
  `engines.node: "22"`. Se descarta el paso intermedio conservador (v5/v6) porque el
  único breaking change real que nos afecta (namespace legacy de Admin SDK) es el mismo
  cambio requerido en cualquier punto intermedio.
- **firebase-admin: `^13.10.0`, no v14.** Corrección post-implementación (descubierta en
  Task 1 al correr `npm install`): `firebase-functions@7.2.5` (y su release candidate
  `7.2.6-rc.0`, la última versión publicada) declaran
  `peerDependencies: { "firebase-admin": "^11.10.0 || ^12.0.0 || ^13.0.0" }` — v14 está
  fuera de rango. No existe ninguna versión de `firebase-functions` publicada que soporte
  `firebase-admin` v14 todavía. `^13.10.0` es la última v13 disponible; sigue siendo un
  salto grande desde v11.11.1 (misma migración de API modular descrita abajo), corre sin
  problema bajo Node 22, y evita el conflicto de peer dependencies por completo.
- **Verificación antes de producción**: emulador local (`firebase emulators:start
  --only functions`) invocando `triggerOdooSync` contra el emulador, además de
  `build`/`npm ci`. Se prefiere esto sobre "solo build" porque el rewrite de
  inicialización del Admin SDK es un cambio de runtime, no solo de tipos — un `tsc`
  limpio no garantiza que `initializeApp()`/`getFirestore()` no truenen al cargar el
  módulo.

## Cambios de código

### 1. `functions/package.json`

```json
{
  "engines": { "node": "22" },
  "dependencies": {
    "firebase-admin": "^14.1.0",
    "firebase-functions": "^7.2.5",
    "odoo-xmlrpc": "^1.0.8"
  }
}
```

`odoo-xmlrpc` no declara restricción de Node en su `engines` (confirmado en el registry
durante la investigación) — no requiere cambios.

### 2. `functions/src/index.ts` — inicialización del Admin SDK

firebase-admin v14 elimina el soporte del namespace legacy (`import * as admin from
"firebase-admin"; admin.firestore()`). El código ya importa `FieldValue`/`Firestore`
desde `firebase-admin/firestore` (API modular) en paralelo al namespace legacy para
`initializeApp()`/`admin.firestore()` — esto se unifica:

Antes:
```ts
import * as admin from "firebase-admin";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
// ... más abajo, dentro de cada handler:
const db = admin.firestore();
```

Después:
```ts
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp();
}
// ... más abajo, dentro de cada handler:
const db = getFirestore();
```

Nada más cambia: `onSchedule`, `onCall`, `HttpsError`, `defineSecret`, la lógica de
`runSync`, el manejo de `ODOO_API_KEY`, y los exports (`syncSuprajitOrders`,
`triggerOdooSync`) no están afectados por breaking changes entre v4→v7 de
firebase-functions según el changelog revisado.

### 3. `functions/tsconfig.json` (opcional, bajo riesgo)

Subir `target`/`lib` de `es2017` a `es2022` para alinear con lo que firebase-functions v7
y el runtime Node 22 ya soportan nativamente — evita helpers de downleveling
innecesarios en el output compilado. No es requerido por ningún breaking change; se
incluye por consistencia.

## Verificación

Orden de pasos, cada uno debe pasar antes de continuar al siguiente:

1. `npm install` en `functions/` con las nuevas versiones → regenera
   `functions/package-lock.json`.
2. `rm -rf functions/node_modules && npm ci --prefix functions` — replica exactamente lo
   que corre Cloud Build, para no repetir el fallo de lockfile-drift del deploy anterior.
3. `npm --prefix functions run build` (`tsc`) — debe compilar sin errores.
4. `firebase emulators:start --only functions` y disparar `triggerOdooSync` contra el
   emulador (vía `firebase functions:shell` o una llamada HTTP al emulador local) —
   confirma que `initializeApp()` / `getFirestore()` no truenan al cargar el módulo ni al
   invocar el handler. No se requiere que el sync complete contra Odoo/Firestore reales;
   basta con confirmar que la función arranca y el Admin SDK responde (aceptamos que
   puede fallar más adelante en la llamada real a Odoo si no hay red/credenciales en el
   entorno del emulador — eso no es parte de lo que este cambio verifica).
5. `npm audit --prefix functions` — reportar si el conteo de vulnerabilidades (hoy 10:
   4 moderate, 5 high, 1 critical) mejora, empeora, o se mantiene tras el bump.

## Rollout

Igual patrón que el deploy anterior de Functions: `firebase deploy --only functions
--project smv-brain`, con confirmación explícita del usuario antes de ejecutarlo — es
producción, `syncSuprajitOrders` corre cada 30 minutos automáticamente y
`triggerOdooSync` respalda el botón "Refrescar" de `OdooOrdersPanel`.

## Fuera de alcance

- No se toca `odoo-xmlrpc` ni su versión.
- No se toca el resto del monorepo (root `package.json`, `src/`, reglas de
  Firestore/Storage).
- No se cambia la lógica de negocio del sync (agrupación de órdenes, batching, códigos de
  servicio genéricos, etc.).
- No se retira `syncSuprajitOrders` (schedule legacy mantenido por paridad con lo
  desplegado, según decisión previa documentada en CLAUDE.md).
