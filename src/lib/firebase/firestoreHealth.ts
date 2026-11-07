/**
 * Detecta cuando el cliente de Firestore queda inservible.
 *
 * Bug del SDK (firebase-js-sdk #10310, #10008): la aserción interna `ca9` mata
 * la cola del cliente de forma permanente. Desde ahí, leer, escribir, suscribirse
 * y desuscribirse lanzan `b815`, y lo único que lo recupera es recargar la página.
 */

const DEAD_CLIENT_PATTERN = /FIRESTORE \(.*\) INTERNAL ASSERTION FAILED/;

let dead = false;
const listeners = new Set<() => void>();

export function isFirestoreClientDeadError(error: unknown): boolean {
  return error instanceof Error && DEAD_CLIENT_PATTERN.test(error.message);
}

export function isFirestoreClientDead(): boolean {
  return dead;
}

export function subscribeFirestoreHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Marca el cliente como muerto si `error` lo demuestra; devuelve si lo demostró. */
export function noteFirestoreError(error: unknown): boolean {
  if (!isFirestoreClientDeadError(error)) return false;
  if (!dead) {
    dead = true;
    listeners.forEach((listener) => listener());
  }
  return true;
}

/**
 * El SDK solo avisa de la muerte de la cola por estos dos canales globales
 * (promesa rechazada sin manejar y excepción en sus callbacks de red).
 */
export function watchFirestoreClientHealth(target: EventTarget = window): void {
  target.addEventListener('unhandledrejection', (event) => {
    noteFirestoreError((event as PromiseRejectionEvent).reason);
  });
  target.addEventListener('error', (event) => {
    noteFirestoreError((event as ErrorEvent).error);
  });
}

export function __resetFirestoreHealthForTests(): void {
  dead = false;
  listeners.clear();
}
