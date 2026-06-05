/**
 * WorkOrdersContext
 *
 * Una única suscripción onSnapshot a la colección `workOrders` (archived == false)
 * compartida por toda la app. Elimina la doble lectura que ocurría al arrancar
 * cuando `useDashboardSummary` y `WorkOrdersPanel` llamaban `listWorkOrders()`
 * por separado, y permite que el dashboard y el panel de control se actualicen
 * en tiempo real sin polling ni refresh manual.
 *
 * Coloca `<WorkOrdersProvider>` en `main.tsx`, dentro de `<AuthGate>`, para
 * garantizar que el listener siempre arranca con una sesión activa.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import type { Tornero, WorkOrder } from '../types';
import { getFirestoreClient } from '../lib/firebase/client';
import { getCurrentUserUid } from '../lib/firebase/auth';
import { isToolcribDebugUnauthAllowed } from '../lib/firebase/env';
import { normalizeWorkOrder } from '../lib/firebase/workOrderValidators';
import { WORK_ORDERS_COLLECTION, listTorneros } from '../lib/firebase/workOrders';
import { useDailySnapshot } from '../hooks/useDailySnapshot';

// ─────────────────────────────────────────────────────────────────────────────
//  Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export type WorkOrdersCtxStatus = 'idle' | 'loading' | 'ready' | 'error';
export type WorkOrdersCtxReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'error'
  | null;

export interface WorkOrdersContextValue {
  /** Órdenes activas (archived == false), en tiempo real vía onSnapshot. */
  orders: WorkOrder[];
  /** Torneros cargados al montar; refrescables con `reloadTorneros()`. */
  torneros: Tornero[];
  status: WorkOrdersCtxStatus;
  reason: WorkOrdersCtxReason;
  /** Recarga la lista de torneros desde Firestore (tras agregar/desactivar). */
  reloadTorneros: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Context
// ─────────────────────────────────────────────────────────────────────────────

const WorkOrdersContext = createContext<WorkOrdersContextValue | null>(null);

export function WorkOrdersProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [torneros, setTorneros] = useState<Tornero[]>([]);
  const [status, setStatus] = useState<WorkOrdersCtxStatus>('idle');
  const [reason, setReason] = useState<WorkOrdersCtxReason>(null);

  // ── suscripción onSnapshot ─────────────────────────────────────────────────
  useEffect(() => {
    const database = getFirestoreClient();

    if (!database) {
      setStatus('error');
      setReason('not-configured');
      return;
    }

    // IMPORTANTE: esta comprobación asume que Firebase Auth ya resolvió el estado
    // antes de que AuthGate renderice este Provider. Si getCurrentUserUid() devuelve
    // null aquí pese a haber sesión activa, el listener nunca arranca — AuthGate
    // debe asegurarse de esperar a onAuthStateChanged antes de montar sus hijos.
    const isAuthed =
      getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();

    if (!isAuthed) {
      setStatus('error');
      setReason('not-authenticated');
      return;
    }

    setStatus('loading');
    setReason(null);

    // Solo órdenes activas — las archivadas no interesan en la UI principal.
    const q = query(
      collection(database, WORK_ORDERS_COLLECTION),
      where('archived', '==', false),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const result: WorkOrder[] = [];
        snap.forEach((d) => {
          const n = normalizeWorkOrder(d.id, d.data());
          if (n) result.push(n);
        });
        setOrders(result);
        setStatus('ready');
        setReason(null);
      },
      (err) => {
        console.warn('[smv-vision][work-orders] onSnapshot error', err);
        setStatus('error');
        setReason('error');
      },
    );

    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Solo se monta cuando el proveedor aparece — AuthGate garantiza sesión activa.

  // ── torneros (one-shot; sin onSnapshot porque cambian poco) ───────────────
  const reloadTorneros = useCallback(async () => {
    const r = await listTorneros();
    if (r.ok) setTorneros(r.value);
  }, []);

  useEffect(() => {
    void reloadTorneros();
  }, [reloadTorneros]);

  useDailySnapshot(orders, status === 'ready');

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <WorkOrdersContext.Provider
      value={{ orders, torneros, status, reason, reloadTorneros }}
    >
      {children}
    </WorkOrdersContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hook de consumo
// ─────────────────────────────────────────────────────────────────────────────

export function useWorkOrdersContext(): WorkOrdersContextValue {
  const ctx = useContext(WorkOrdersContext);
  if (!ctx) {
    throw new Error(
      'useWorkOrdersContext debe usarse dentro de <WorkOrdersProvider>',
    );
  }
  return ctx;
}
