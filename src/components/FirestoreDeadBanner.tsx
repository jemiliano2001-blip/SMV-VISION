import { useSyncExternalStore } from 'react';
import {
  isFirestoreClientDead,
  subscribeFirestoreHealth,
} from '../lib/firebase/firestoreHealth';

/**
 * Aviso no bloqueante: deja a la vista el trabajo que sigue en memoria
 * (planos y resultados) y la persona decide cuándo recargar.
 */
export function FirestoreDeadBanner() {
  const isDead = useSyncExternalStore(subscribeFirestoreHealth, isFirestoreClientDead);
  if (!isDead) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-danger px-4 py-2 text-[13px] font-medium text-white"
    >
      <span>
        Se perdió la conexión con la base de datos. Lo que ves sigue aquí, pero no se puede leer ni
        guardar nada hasta recargar.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-9 rounded-lg bg-white px-3 font-bold text-danger"
      >
        Recargar
      </button>
    </div>
  );
}
