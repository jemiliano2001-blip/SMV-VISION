/**
 * src/lib/firebase/odooOrders.ts
 *
 * Capa de datos para las órdenes de Odoo sincronizadas en Firestore
 * (colección `odooSaleOrders`). Mismo contrato que `workOrders.ts`:
 *  - Las funciones NUNCA lanzan — devuelven un result type.
 *  - Solo lectura: la escritura la hace el script `scripts/syncOdoo.ts`.
 */

import {
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';

const WORK_ORDERS_COLLECTION = 'workOrders';

import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import { isToolcribDebugUnauthAllowed } from './env';

// ─────────────────────────────────────────────────────────────────────────────
//  Constantes
// ─────────────────────────────────────────────────────────────────────────────

export const ODOO_ORDERS_COLLECTION = 'odooSaleOrders';

const DEFAULT_MAX = 1000;

// ─────────────────────────────────────────────────────────────────────────────
//  Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

/** Una línea de producto dentro de una orden de Odoo. */
export interface OdooOrderLineView {
  product: string;
  description: string;
  qty: number;
  /** Cantidad ya entregada según Odoo (stock.move done). */
  qty_delivered: number;
  /** Piezas pendientes = qty - qty_delivered (≥ 0). */
  qty_pending: number;
  /** Cantidad de piezas pendientes calculada desde stock.move (traslados). */
  qty_pending_from_pickings?: number;
}

/**
 * Forma canónica de una orden de Odoo lista para la UI.
 * Se construye normalizando el documento de Firestore.
 */
export interface OdooOrderView {
  /** ID del documento en Firestore (name con '/' → '_'). */
  id: string;
  /** Número de orden en Odoo (ej. "2026/S00781"). */
  name: string;
  /** Fecha de la orden en formato Odoo ("YYYY-MM-DD HH:mm:ss") o null. */
  date_order: string | null;
  /** Nombre del cliente (partner). */
  partner: string;
  /** Referencia del cliente / PO. Null si no tiene. */
  client_order_ref: string | null;
  /**
   * Estado de facturación en Odoo:
   *   'to invoice' → A facturar (pendiente)
   *   'invoiced'   → Facturado por completo
   *   'upselling'  → Oportunidad de venta adicional
   *   'no'         → Nada que facturar
   */
  invoice_status: string;
  /** true si la orden está pendiente de facturación (to invoice). */
  toInvoice: boolean;
  /** Líneas de la orden con producto, descripción y cantidad. */
  order_lines: OdooOrderLineView[];
  /** Cuándo se sincronizó desde Odoo (ISO string o null). */
  syncedAtUTC: string | null;
}

export type OdooOrderFailureReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'read-failed';

export type OdooOrderResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: OdooOrderFailureReason };

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

function db(): Firestore | null {
  return getFirestoreClient();
}

function isAuthed(): boolean {
  return getCurrentUserUid() !== null || isToolcribDebugUnauthAllowed();
}

/** Normaliza un documento crudo de Firestore al tipo OdooOrderView. */
function normalizeOdooOrder(id: string, raw: Record<string, unknown>): OdooOrderView | null {
  if (typeof raw['name'] !== 'string') return null;

  // Líneas de la orden
  const rawLines = Array.isArray(raw['order_lines']) ? raw['order_lines'] : [];
  const order_lines: OdooOrderLineView[] = rawLines
    .filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
    .map((l) => {
      const qty = typeof l['qty'] === 'number' ? l['qty'] : 0;
      const qty_delivered = typeof l['qty_delivered'] === 'number' ? l['qty_delivered'] : 0;
      return {
        product: typeof l['product'] === 'string' ? l['product'] : '',
        description: typeof l['description'] === 'string' ? l['description'] : '',
        qty,
        qty_delivered,
        qty_pending: Math.max(0, qty - qty_delivered),
        qty_pending_from_pickings: typeof l['qty_pending_from_pickings'] === 'number' ? l['qty_pending_from_pickings'] : undefined,
      };
    });

  // syncedAtUTC: Firestore Timestamp → ISO string
  let syncedAtUTC: string | null = null;
  const ts = raw['syncedAtUTC'];
  if (ts && typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    syncedAtUTC = (ts as { toDate: () => Date }).toDate().toISOString();
  }

  return {
    id,
    name: raw['name'] as string,
    date_order: typeof raw['date_order'] === 'string' ? raw['date_order'] : null,
    partner: typeof raw['partner'] === 'string' ? raw['partner'] : 'Sin cliente',
    client_order_ref: typeof raw['client_order_ref'] === 'string' ? raw['client_order_ref'] : null,
    invoice_status: typeof raw['invoice_status'] === 'string' ? raw['invoice_status'] : 'no',
    toInvoice: raw['toInvoice'] === true,
    order_lines,
    syncedAtUTC,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  API pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve ÚNICAMENTE las órdenes pendientes de facturación (toInvoice === true).
 * Estas son las que representan trabajos activos para SMV-Vision.
 *
 * Ordenadas por fecha de orden descendente.
 */
export async function listOrdersToInvoice(options?: {
  max?: number;
}): Promise<OdooOrderResult<OdooOrderView[]>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  try {
    // Filtra por `toInvoice === true`, campo que el script syncOdoo.ts calcula
    // usando la LÓGICA BASADA EN TRASLADOS:
    // Solo órdenes marcadas en Odoo como 'A facturar' ('to invoice') o 'upselling',
    // Y que tengan al menos un Traslado (Remisión) en estado 'Listo', 'En espera' o no tengan ninguno.
    // Si TODOS sus traslados están en 'Hecho', significa que ya se entregó al 100% y se oculta.
    const q = query(
      collection(database, ODOO_ORDERS_COLLECTION),
      where('toInvoice', '==', true),
      fbLimit(Math.min(options?.max ?? DEFAULT_MAX, DEFAULT_MAX)),
    );

    const snap = await getDocs(q);
    const out: OdooOrderView[] = [];
    snap.forEach((d) => {
      const normalized = normalizeOdooOrder(d.id, d.data() as Record<string, unknown>);
      if (normalized) out.push(normalized);
    });

    // Ordenar en memoria (descendente por fecha) para no requerir índice compuesto en Firestore
    out.sort((a, b) => {
      const dateA = a.date_order || '';
      const dateB = b.date_order || '';
      return dateB.localeCompare(dateA);
    });

    return { ok: true, value: out };
  } catch (error) {
    console.warn('[smv-vision][odoo-orders] listOrdersToInvoice falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

export interface ProductionStatus {
  total: number;
  entregadas: number;
}

/**
 * Para cada soNumber dado, cuenta cuántas WorkOrders existen y cuántas
 * están en estado 'entregada'. Usado por OdooOrdersPanel para el badge.
 *
 * Firestore `in` acepta máx 30 valores → queries en paralelo por chunks.
 */
export async function listWorkOrderStatusBySoNumbers(
  soNumbers: string[],
): Promise<OdooOrderResult<Map<string, ProductionStatus>>> {
  if (soNumbers.length === 0) return { ok: true, value: new Map() };

  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  try {
    const CHUNK = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < soNumbers.length; i += CHUNK) {
      chunks.push(soNumbers.slice(i, i + CHUNK));
    }

    const snapshots = await Promise.all(
      chunks.map((chunk) =>
        getDocs(
          query(
            collection(database, WORK_ORDERS_COLLECTION),
            where('soNumber', 'in', chunk),
            where('archived', '==', false),
          ),
        ),
      ),
    );

    const result = new Map<string, ProductionStatus>();
    for (const snap of snapshots) {
      snap.forEach((d) => {
        const raw = d.data() as Record<string, unknown>;
        const so = typeof raw['soNumber'] === 'string' ? raw['soNumber'] : null;
        if (!so) return;
        const status = raw['status'];
        const entry = result.get(so) ?? { total: 0, entregadas: 0 };
        entry.total += 1;
        if (status === 'entregada') entry.entregadas += 1;
        result.set(so, entry);
      });
    }

    return { ok: true, value: result };
  } catch (error) {
    console.warn('[smv-vision][odoo-orders] listWorkOrderStatusBySoNumbers falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Devuelve TODAS las órdenes de Odoo (historial completo), sin filtro.
 * Útil para reportes de auditoría o comparaciones.
 */
export async function listAllOdooOrders(options?: {
  max?: number;
}): Promise<OdooOrderResult<OdooOrderView[]>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  try {
    const q = query(
      collection(database, ODOO_ORDERS_COLLECTION),
      orderBy('date_order', 'desc'),
      fbLimit(Math.min(options?.max ?? DEFAULT_MAX, DEFAULT_MAX)),
    );

    const snap = await getDocs(q);
    const out: OdooOrderView[] = [];
    snap.forEach((d) => {
      const normalized = normalizeOdooOrder(d.id, d.data() as Record<string, unknown>);
      if (normalized) out.push(normalized);
    });

    return { ok: true, value: out };
  } catch (error) {
    console.warn('[smv-vision][odoo-orders] listAllOdooOrders falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}
