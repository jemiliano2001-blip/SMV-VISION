/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_TOOLCRIB_DEBUG_ALLOW_UNAUTH?: string;
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  readonly VITE_APPCHECK_DEBUG?: string;
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Inyectado por Vite (vite.config.ts → define). Espejo de `version` en package.json.
declare const __APP_VERSION__: string;

