# Mejoras de estructura, seguridad y generales — 2026-07-04

## Contexto

Auditoría completa del repo (estado: refactor purchases/entregas sin commitear, módulo
workOrders eliminado del cliente). Baseline verde: `tsc --noEmit` OK, 70/70 tests.
La app es privada (2 usuarios, email/password creado a mano, hosting `smv-brain.web.app`).

## Hallazgos y decisiones

### Seguridad

1. **firestore.rules** — hoy `match /{document=**} { allow read, write: if request.auth != null }`.
   Cualquier usuario autenticado puede escribir colecciones que solo debería tocar el
   Admin SDK (`odooSaleOrders`, `syncMeta`, `workOrders`) o falsificar logs de auditoría.
   → Reglas por colección con mínimo privilegio y deny por defecto:
   - `odooSaleOrders`, `syncMeta`, `workOrders`: solo lectura (escrituras vía Admin SDK, que ignora reglas).
   - `toolcribParts`, `toolcribDrawings`: read/create/update; delete denegado (solo scripts Admin).
   - `toolcribPrintLogs`: create solo si `printedByUid == request.auth.uid`; inmutables (no update/delete).
   - `analysisRuns`: create; inmutables.
   - `purchases`: CRUD completo autenticado (ComprasPanel).
   - Resto: deny. Verificación con skill firestore-security-rules-auditor.

2. **Headers de hosting** (`firebase.json`): añadir `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
   `Permissions-Policy` (cámara/micrófono/geolocalización off) y HSTS.

3. **AuthGate fail-open**: si Firebase está configurado pero `getAuth` falla al inicializar
   (`status === 'unavailable'`), hoy la app deja pasar sin login (expone la UI y el uso de
   la API key de Gemini). → Pantalla de error con botón de recarga cuando
   `isFirebaseConfigured() && status === 'unavailable'`. Sin config sigue pasando (feature
   "app funciona sin Firebase" intacta).

4. **Google Sign-In muerto** en `auth.ts` (~100 líneas): la UI solo ofrece email/password y
   no hay allowlist de dominios; cualquier cuenta Google podría autenticarse por esa vía si
   se re-expusiera. → Eliminar `signInWithGoogle`, redirect/popup y `consumeRedirectResult`.
   Nota: la vía de verdad se cierra deshabilitando el proveedor Google en Firebase Console
   (paso manual del usuario); esto elimina el código cliente y reduce bundle.

5. **syncServer.ts** (localhost:3031): un POST sin headers custom es una "simple request";
   una web maliciosa abierta en el navegador podría disparar syncs (drive-by). → Exigir
   header `X-SMV-Sync: 1` en `POST /sync` (fuerza preflight CORS que solo pasa para orígenes
   permitidos), añadir `Access-Control-Allow-Private-Network` en el preflight (Chrome PNA),
   y enviar el header desde el fallback de `OdooOrdersPanel`.

6. **npm audit**: 11 vulnerabilidades (4 high: vite ≤6.4.2, ws). → `npm audit fix`
   (semver-compatible) tras la limpieza de dependencias.

### Estructura

7. **Cloud Functions sin código fuente**: solo existe `functions/lib/index.js` (compilado),
   con `functions/lib/` en `.gitignore` y `functions/` entero sin trackear. Si se pierde la
   carpeta local, se pierde la función. → Reconstruir `functions/src/index.ts` (port fiel
   del JS: mismos exports `syncSuprajitOrders` + `triggerOdooSync`, misma lógica, sin
   cambios de comportamiento), añadir `tsconfig.json`, `typescript` devDep, script `build`
   y hook `predeploy` en `firebase.json`. Nota de drift (informativa, no se cambia):
   el JS desplegado aún escribe `workOrders` y mantiene el schedule de 30 min; la spec
   2026-06-11 habla de single-source vía tarea de Windows. Decisión de retirarlo = usuario.

8. **package.json**: nombre placeholder `react-example@0.0.0` → `smv-vision@1.0.0`
   (`__APP_VERSION__` visible en UI). Eliminar deps sin ningún import: `three`,
   `@react-three/drei`, `@react-three/fiber`, `@types/three`, `@hello-pangea/dnd` (kanban
   eliminado), `@radix-ui/react-dialog`, `@radix-ui/react-slot` (la UI usa @base-ui),
   `autoprefixer` (Tailwind v4 vite plugin, no hay postcss.config). Mover a devDependencies
   lo que no es runtime del navegador: `@vitejs/plugin-react`, `@tailwindcss/vite`,
   `express`, `dotenv`, `shadcn` (CLI); quitar `vite` duplicado de dependencies.
   `vite.config.ts`: eliminar rama `dnd-vendor` de manualChunks. El define
   `process.env.GEMINI_API_KEY` SE CONSERVA (fallback AI Studio en useVisionAnalysis).

9. **ErrorBoundary**: no existe ninguno; un throw en render deja pantalla en blanco.
   → `src/components/ErrorBoundary.tsx` (class component, fallback brutalista con botón
   de recarga) envolviendo el árbol en `main.tsx`.

10. **.gitignore**: añadir `.firebase/` (caché de deploy) y `scratch/`.

### Documentación

11. **CLAUDE.md**: actualizar reglas Firestore (ya no "any authenticated user can
    read/write"), ubicación del fuente de functions + build, quitar sección "Unused
    dependencies" (resuelta), auth = solo email/password, quitar filas App Check de la
    tabla de env (no queda código App Check en src/).

## Fuera de alcance (explícito)

- Refactor de `useVisionAnalysis.ts` (1210 líneas): funciona, está testeado indirectamente
  y partirlo es riesgo alto sin beneficio funcional inmediato.
- Retirar `syncSuprajitOrders`/escrituras `workOrders` de la Cloud Function (decisión de
  producto; el badge de producción del panel Órdenes aún lee `workOrders`).
- App Check / CSP estricta (requieren setup en consola y pruebas en producción).
- Commits/deploys: el árbol tiene trabajo previo sin commitear; no se toca git.

## Verificación

`npm run lint` + `npm test` + `npm run build` verdes al final; `tsc` de functions compila;
reglas auditadas con la skill dedicada.
