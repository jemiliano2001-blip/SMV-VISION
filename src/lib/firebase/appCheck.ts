/**
 * Inicialización idempotente de Firebase App Check.
 *
 * Estrategia:
 * - Requiere `VITE_RECAPTCHA_SITE_KEY` (reCAPTCHA v3) para inicializar. Si falta,
 *   App Check no se activa; si Firebase Auth impone App Check, el inicio de sesión fallará.
 * - Desarrollo: por defecto se activa el debug token (`FIREBASE_APPCHECK_DEBUG_TOKEN`)
 *   salvo `VITE_APPCHECK_DEBUG=false`. Opcional: `VITE_APPCHECK_DEBUG_TOKEN` con UUID
 *   fijo registrado en Firebase Console → App Check.
 * - En localhost (Vite dev) ya no se omite App Check: si enforcement está activo en Auth,
 *   omitir el SDK causaba `auth/firebase-app-check-token-is-invalid`.
 *
 * Esta función NO debe llamarse dos veces ni lanzar nunca al caller.
 */

import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';

let appCheckInitialized = false;
let cachedAppCheck: AppCheck | null = null;

function enableDebugTokenIfRequested(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const fixedFromEnv = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
  if (typeof fixedFromEnv === 'string' && fixedFromEnv.trim().length > 0) {
    window.FIREBASE_APPCHECK_DEBUG_TOKEN = fixedFromEnv.trim();
    return;
  }
  const debugFlag = import.meta.env.VITE_APPCHECK_DEBUG;
  if (debugFlag === 'true' || (import.meta.env.DEV && debugFlag !== 'false')) {
    window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    console.info(
      '[smv-vision][appcheck] debug token activado. Copia el token de la consola y regístralo en Firebase Console → App Check → Apps.',
    );
  }
}

export function initAppCheckOnce(app: FirebaseApp): AppCheck | null {
  if (appCheckInitialized) {
    return cachedAppCheck;
  }
  appCheckInitialized = true;

  const rawSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  const siteKey =
    typeof rawSiteKey === 'string' && rawSiteKey.trim().length > 0
      ? rawSiteKey.trim()
      : null;

  if (!siteKey) {
    if (import.meta.env.DEV) {
      console.info(
        '[smv-vision][appcheck] VITE_RECAPTCHA_SITE_KEY no configurada. App Check desactivado.',
      );
    } else {
      console.warn(
        '[smv-vision][appcheck] VITE_RECAPTCHA_SITE_KEY ausente en producción. App Check NO protegerá las requests.',
      );
    }
    cachedAppCheck = null;
    return cachedAppCheck;
  }

  enableDebugTokenIfRequested();

  try {
    cachedAppCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    console.warn('[smv-vision][appcheck] initializeAppCheck falló; continuando sin App Check', error);
    cachedAppCheck = null;
  }

  return cachedAppCheck;
}
