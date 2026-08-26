/**
 * Lectura segura de la configuración Firebase desde `import.meta.env`.
 *
 * Diseño:
 * - Si alguna variable obligatoria falta, `getFirebaseConfig()` devuelve `null`
 *   y el resto del sistema trata el audit trail como "desactivado". El flujo
 *   principal (Gemini, UI) jamás se rompe por falta de configuración Firebase.
 * - Nunca se imprime la apiKey en logs; sólo un flag booleano de estado.
 */

import { log } from '../log';

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

type RequiredEnvKey =
  | 'VITE_FIREBASE_API_KEY'
  | 'VITE_FIREBASE_AUTH_DOMAIN'
  | 'VITE_FIREBASE_PROJECT_ID'
  | 'VITE_FIREBASE_STORAGE_BUCKET'
  | 'VITE_FIREBASE_MESSAGING_SENDER_ID'
  | 'VITE_FIREBASE_APP_ID';

const REQUIRED_KEYS: readonly RequiredEnvKey[] = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

function readEnvValue(key: RequiredEnvKey): string | undefined {
  const raw = import.meta.env[key];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

let cachedConfig: FirebaseClientConfig | null | undefined;

export function getFirebaseConfig(): FirebaseClientConfig | null {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }

  const missing: RequiredEnvKey[] = [];
  const values: Partial<Record<RequiredEnvKey, string>> = {};

  for (const key of REQUIRED_KEYS) {
    const value = readEnvValue(key);
    if (value === undefined) {
      missing.push(key);
    } else {
      values[key] = value;
    }
  }

  if (missing.length > 0) {
    if (import.meta.env.DEV) {
      log.info(
        '[smv-vision][firebase] Audit trail desactivado (faltan variables de entorno):',
        missing.join(', '),
      );
    }
    cachedConfig = null;
    return cachedConfig;
  }

  const measurementRaw = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID;
  const measurementId =
    typeof measurementRaw === 'string' && measurementRaw.trim().length > 0
      ? measurementRaw.trim()
      : undefined;

  cachedConfig = {
    apiKey: values.VITE_FIREBASE_API_KEY as string,
    authDomain: values.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: values.VITE_FIREBASE_PROJECT_ID as string,
    storageBucket: values.VITE_FIREBASE_STORAGE_BUCKET as string,
    messagingSenderId: values.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
    appId: values.VITE_FIREBASE_APP_ID as string,
    measurementId,
  };
  return cachedConfig;
}

export function isFirebaseConfigured(): boolean {
  return getFirebaseConfig() !== null;
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Bypass local para depurar Tool Crib sin sesión activa.
 * Solo se habilita en DEV aunque la variable exista en otros entornos.
 */
export function isToolcribDebugUnauthAllowed(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  return parseBooleanEnv(import.meta.env.VITE_TOOLCRIB_DEBUG_ALLOW_UNAUTH);
}

export interface AppCheckClientConfig {
  recaptchaSiteKey: string;
  /** UUID de debug registrado en Firebase Console → App Check (para DEV/localhost). */
  debugToken: string | undefined;
  /** Activa el debug provider aunque no haya token fijo (imprime uno nuevo en consola). */
  debugEnabled: boolean;
}

/**
 * App Check solo se activa si hay site key de reCAPTCHA v3 configurada.
 * Sin ella, `null` — el resto del sistema sigue funcionando sin App Check
 * (igual que Firebase/Gemini: ausencia de config nunca rompe el flujo).
 */
export function getAppCheckConfig(): AppCheckClientConfig | null {
  const siteKey = readEnvOptional('VITE_RECAPTCHA_SITE_KEY');
  if (!siteKey) {
    return null;
  }
  return {
    recaptchaSiteKey: siteKey,
    debugToken: readEnvOptional('VITE_APPCHECK_DEBUG_TOKEN'),
    debugEnabled: parseBooleanEnv(import.meta.env.VITE_APPCHECK_DEBUG),
  };
}

function readEnvOptional(key: 'VITE_RECAPTCHA_SITE_KEY' | 'VITE_APPCHECK_DEBUG_TOKEN'): string | undefined {
  const raw = import.meta.env[key];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
