/**
 * Capa delgada sobre Firebase Auth.
 *
 * Principios:
 * - No se re-exportan tipos internos del SDK fuera de lo estrictamente
 *   necesario. Así cualquier futuro cambio de SDK se absorbe aquí.
 * - El hook `useFirebaseUser` es la única forma permitida de que la UI
 *   consuma estado de autenticación: centraliza el suscriptor a
 *   `onAuthStateChanged` y evita múltiples listeners en paralelo.
 * - Errores de red NO deben romper la app: se normalizan a un tipo de
 *   retorno `{ ok, error? }` para que el UI pueda mostrar feedback
 *   constructivo sin throws que escapen a React.
 * - Único proveedor: Email/Password. El flujo de Google se eliminó a
 *   propósito (app privada sin allowlist de dominios).
 */

import { useEffect, useSyncExternalStore } from 'react';
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

import { getFirebaseAppOrNull } from './client';

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out' | 'unavailable';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
}

export type SignInResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'not-configured' | 'error'; message?: string };

export type SignOutResult =
  | { ok: true }
  | { ok: false; reason: 'not-configured' | 'error'; message?: string };

let cachedAuth: Auth | null | undefined;

function resolveAuth(): Auth | null {
  if (cachedAuth !== undefined) {
    return cachedAuth;
  }
  const app = getFirebaseAppOrNull();
  if (!app) {
    cachedAuth = null;
    return cachedAuth;
  }
  try {
    cachedAuth = getAuth(app);
  } catch (error) {
    console.warn('[smv-vision][auth] getAuth falló', error);
    cachedAuth = null;
  }

  if (cachedAuth) {
    setPersistence(cachedAuth, browserLocalPersistence).catch((error: unknown) => {
      console.warn('[smv-vision][auth] setPersistence falló', error);
    });
  }

  return cachedAuth;
}

export function getAuthOrNull(): Auth | null {
  return resolveAuth();
}

export function getCurrentUserUid(): string | null {
  const auth = resolveAuth();
  if (!auth) {
    return null;
  }
  return auth.currentUser?.uid ?? null;
}

/**
 * Inicia sesión con correo y contraseña (proveedor Email/Password en Firebase Console).
 */
export async function signInWithEmailPassword(
  email: string,
  password: string,
): Promise<SignInResult> {
  const auth = resolveAuth();
  if (!auth) {
    return { ok: false, reason: 'not-configured' };
  }

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return { ok: true, user: credential.user };
  } catch (error: unknown) {
    const code = extractErrorCode(error);
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error('[smv-vision][auth] signInWithEmailAndPassword falló', { code, message, error });

    if (code === 'auth/invalid-email') {
      return {
        ok: false,
        reason: 'error',
        message: 'El correo electrónico no tiene un formato válido.',
      };
    }
    if (code === 'auth/user-disabled') {
      return {
        ok: false,
        reason: 'error',
        message: 'Esta cuenta está deshabilitada. Contacta al administrador.',
      };
    }
    if (
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential'
    ) {
      return {
        ok: false,
        reason: 'error',
        message: 'Correo o contraseña incorrectos.',
      };
    }
    if (code === 'auth/too-many-requests') {
      return {
        ok: false,
        reason: 'error',
        message: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
      };
    }
    if (code === 'auth/firebase-app-check-token-is-invalid') {
      return {
        ok: false,
        reason: 'error',
        message:
          'Sesión rechazada por políticas de seguridad. Contacta al administrador.',
      };
    }

    return {
      ok: false,
      reason: 'error',
      message: code ? `${code}: ${message}` : message,
    };
  }
}


/**
 * Inicia sesión utilizando un Firebase Custom Token (Single Sign-On desde SMV Hub).
 */
export async function signInWithSsoToken(
  customToken: string
): Promise<SignInResult> {
  const auth = resolveAuth();
  if (!auth) {
    return { ok: false, reason: 'not-configured' };
  }

  try {
    const credential = await signInWithCustomToken(auth, customToken);
    return { ok: true, user: credential.user };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error('[smv-vision][auth] signInWithCustomToken falló', error);
    return { ok: false, reason: 'error', message };
  }
}

export async function signOutUser(): Promise<SignOutResult> {
  const auth = resolveAuth();
  if (!auth) {
    return { ok: false, reason: 'not-configured' };
  }
  try {
    await signOut(auth);
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.warn('[smv-vision][auth] signOut falló', error);
    return { ok: false, reason: 'error', message };
  }
}

function extractErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const maybe = (error as { code?: unknown }).code;
  if (typeof maybe !== 'string') {
    return null;
  }
  // Algunas respuestas de Firebase incluyen un punto final en el código.
  return maybe.replace(/\.$/, '');
}

type Listener = (state: AuthState) => void;

interface AuthStore {
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => AuthState;
}

let authStore: AuthStore | null = null;

function getAuthStore(): AuthStore {
  if (authStore) {
    return authStore;
  }

  const auth = resolveAuth();
  if (!auth) {
    const unavailable: AuthState = { status: 'unavailable', user: null };
    authStore = {
      subscribe: () => () => {},
      getSnapshot: () => unavailable,
    };
    return authStore;
  }

  let state: AuthState = { status: 'loading', user: null };
  const listeners = new Set<Listener>();
  let unsubscribeAuth: (() => void) | null = null;

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        console.warn('[smv-vision][auth] listener lanzó', error);
      }
    }
  }

  function ensureSubscribed(): void {
    if (unsubscribeAuth || !auth) {
      return;
    }
    unsubscribeAuth = onAuthStateChanged(
      auth,
      (user) => {
        state = {
          status: user ? 'signed-in' : 'signed-out',
          user,
        };
        notify();
      },
      (error) => {
        console.warn('[smv-vision][auth] onAuthStateChanged error', error);
        state = { status: 'signed-out', user: null };
        notify();
      },
    );
  }

  authStore = {
    subscribe(listener) {
      listeners.add(listener);
      ensureSubscribed();
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
  };

  return authStore;
}

export function useFirebaseUser(): AuthState {
  const store = getAuthStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    // Fuerza la activación del suscriptor interno aunque el componente no
    // haya pedido snapshots aún (defensa en profundidad frente a StrictMode).
    const unsubscribe = store.subscribe(() => {});
    return unsubscribe;
  }, [store]);

  return state;
}
