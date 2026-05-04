/**
 * Singleton de inicialización de Firebase App + Firestore.
 *
 * Principios:
 * - Inicialización lazy: ningún import de esta librería paga coste hasta que
 *   se invoque `getFirestoreClient()` en una ruta de código real.
 * - Resiliencia: si la configuración no está presente o la inicialización
 *   falla, devuelve `null` en lugar de lanzar. El llamador decide no-op.
 * - Idempotencia: reusa `getApps()` para evitar dobles inicializaciones en
 *   HMR de Vite.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

import { initAppCheckOnce } from './appCheck';
import { getFirebaseConfig } from './env';

const FIREBASE_APP_NAME = 'smv-vision';

let cachedApp: FirebaseApp | null | undefined;
let cachedFirestore: Firestore | null | undefined;

function resolveApp(): FirebaseApp | null {
  if (cachedApp !== undefined) {
    return cachedApp;
  }

  const config = getFirebaseConfig();
  if (config === null) {
    cachedApp = null;
    return cachedApp;
  }

  try {
    const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);
    if (existing) {
      cachedApp = existing;
    } else {
      cachedApp = initializeApp(config, FIREBASE_APP_NAME);
    }
  } catch (error) {
    console.warn('[smv-vision][firebase] initializeApp falló, audit trail deshabilitado', error);
    cachedApp = null;
  }

  if (cachedApp) {
    // App Check debe inicializarse inmediatamente tras initializeApp para
    // que los servicios posteriores (Firestore, Auth) adjunten el token.
    try {
      initAppCheckOnce(cachedApp);
    } catch (error) {
      console.warn('[smv-vision][firebase] initAppCheckOnce falló', error);
    }
  }

  return cachedApp;
}

export function getFirestoreClient(): Firestore | null {
  if (cachedFirestore !== undefined) {
    return cachedFirestore;
  }

  const app = resolveApp();
  if (!app) {
    cachedFirestore = null;
    return cachedFirestore;
  }

  try {
    cachedFirestore = getFirestore(app);
  } catch (error) {
    console.warn('[smv-vision][firebase] getFirestore falló, audit trail deshabilitado', error);
    cachedFirestore = null;
  }

  return cachedFirestore;
}

/**
 * Útil para pruebas y para expresar intención en el llamador.
 * NO expone la app si no ha sido inicializada con éxito.
 */
export function getFirebaseAppOrNull(): FirebaseApp | null {
  return resolveApp();
}

export function __resetFirebaseClientForTests(): void {
  cachedApp = undefined;
  cachedFirestore = undefined;
  try {
    const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);
    if (existing) {
      void existing;
      void getApp(FIREBASE_APP_NAME);
    }
  } catch {
    // silencioso
  }
}
