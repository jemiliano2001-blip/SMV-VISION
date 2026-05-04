/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  readonly VITE_APPCHECK_DEBUG?: string;
  /** UUID fijo registrado en Firebase Console → App Check (alternativa al token impreso en consola). */
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
  readonly VITE_APPCHECK_ALLOW_LOCALHOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare interface Window {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
}
