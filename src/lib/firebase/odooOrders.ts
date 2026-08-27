/**
 * src/lib/firebase/odooOrders.ts
 *
 * Capa de datos para las órdenes de Odoo sincronizadas en Firestore
 * (colección `odooSaleOrders`). Mismo contrato que `workOrders.ts`:
 *  - Las funciones NUNCA lanzan — devuelven un result type.
 *  - Solo lectura: la escritura la hace la Cloud Function (`functions/src/index.ts`).
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
import { log } from '../log';

// ─────────────────────────────────────────────────────────────────────────────
//  Constantes
// ─────────────────────────────────────────────────────────────────────────────

export const ODOO_ORDERS_COLLECTION = 'odooSaleOrders';

/** Prefijo de partnerKey para reporte / Tool Crib (sigue centrado en SUPRAJIT). */
export const REPORT_PARTNER_KEY_PREFIX = 'SUPRAJIT';

const DEFAULT_MAX = 1000;

/** Llave indexable del cliente (misma regla que la Cloud Function). */
export function normalizePartnerKey(partner: string): string {
  return partner.trim().toUpperCase();
}

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
  /** Partner normalizado (trim + uppercase) para filtros Firestore. */
  partnerKey: string;
  /** Referencia del cliente / PO. Null si no tiene. */
  client_order_ref: string | null;
  /** Requisitor o Ingeniero solicitante de la orden en Odoo. */
  requisitor: string | null;
  /**
   * Estado de facturación en Odoo:
   *   'to invoice' → A facturar (pendiente)
   *   'invoiced'   → Facturado por completo
   *   'upselling'  → Oportunidad de venta adicional
   *   'no'         → Nada que facturar
   */
  invoice_status: string;
  /** Estado de la orden ('draft', 'sent', 'sale', 'done', 'cancel') */
  state: string;
  /** true si la orden está pendiente de facturación (to invoice). */
  toInvoice: boolean;
  /** Líneas de la orden con producto, descripción y cantidad. */
  order_lines: OdooOrderLineView[];
  /** Entregas (remisiones / stock.picking) asociadas a esta orden. */
  deliveries: {
    name: string;
    state: string;
    date_done: string | false;
    lines: {
      product: string;
      qty_demand: number;
      qty_done: number;
      state: string;
      sale_line_id: number | null;
    }[];
  }[];
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
      const qty_pending_from_pickings = typeof l['qty_pending_from_pickings'] === 'number' ? l['qty_pending_from_pickings'] : undefined;
      
      return {
        product: typeof l['product'] === 'string' ? l['product'] : '',
        description: typeof l['description'] === 'string' ? l['description'] : '',
        qty,
        qty_delivered,
        qty_pending: qty_pending_from_pickings !== undefined ? qty_pending_from_pickings : Math.max(0, qty - qty_delivered),
        qty_pending_from_pickings,
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
    partnerKey:
      typeof raw['partnerKey'] === 'string' && raw['partnerKey'].trim() !== ''
        ? raw['partnerKey'].trim().toUpperCase()
        : normalizePartnerKey(
            typeof raw['partner'] === 'string' ? raw['partner'] : 'Sin cliente',
          ),
    client_order_ref: typeof raw['client_order_ref'] === 'string' ? raw['client_order_ref'] : null,
    requisitor: typeof raw['requisitor'] === 'string' && raw['requisitor'].trim() !== '' ? raw['requisitor'].trim() : null,
    invoice_status: typeof raw['invoice_status'] === 'string' ? raw['invoice_status'] : 'no',
    state: typeof raw['state'] === 'string' ? raw['state'] : 'unknown',
    toInvoice: raw['toInvoice'] === true,
    order_lines,
    deliveries: Array.isArray(raw['deliveries']) ? (raw['deliveries'] as any[]) : [],
    syncedAtUTC,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  API pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve órdenes pendientes de facturación (`toInvoice === true`).
 *
 * Requiere filtro de compañía:
 * - `partnerKey`: match exacto (botones en Órdenes).
 * - `partnerKeyPrefix`: rango Firestore (reporte / Tool Crib → SUPRAJIT*).
 *
 * Ordenadas por fecha de orden descendente.
 */
export async function listOrdersToInvoice(options: {
  max?: number;
  partnerKey?: string;
  partnerKeyPrefix?: string;
}): Promise<OdooOrderResult<OdooOrderView[]>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  const partnerKey =
    typeof options.partnerKey === 'string' && options.partnerKey.trim() !== ''
      ? normalizePartnerKey(options.partnerKey)
      : null;
  const partnerKeyPrefix =
    typeof options.partnerKeyPrefix === 'string' && options.partnerKeyPrefix.trim() !== ''
      ? normalizePartnerKey(options.partnerKeyPrefix)
      : null;

  // Sin partnerKey ni partnerKeyPrefix (incluido un prefijo vacio): "todas las
  // companias", no un error. Antes un prefijo vacio devolvia read-failed y el
  // boton "Todas" de Inicio caia siempre al fallback de SUPRAJIT.
  try {
    const max = Math.min(options.max ?? DEFAULT_MAX, DEFAULT_MAX);
    const constraints = partnerKey
      ? [
          where('toInvoice', '==', true),
          where('partnerKey', '==', partnerKey),
          fbLimit(max),
        ]
      : partnerKeyPrefix
      ? [
          where('toInvoice', '==', true),
          where('partnerKey', '>=', partnerKeyPrefix),
          where('partnerKey', '<=', `${partnerKeyPrefix}\uf8ff`),
          fbLimit(max),
        ]
      : [where('toInvoice', '==', true), fbLimit(max)];

    const q = query(collection(database, ODOO_ORDERS_COLLECTION), ...constraints);

    const snap = await getDocs(q);
    const out: OdooOrderView[] = [];
    snap.forEach((d) => {
      const normalized = normalizeOdooOrder(d.id, d.data() as Record<string, unknown>);
      if (normalized) out.push(normalized);
    });

    out.sort((a, b) => {
      const dateA = a.date_order || '';
      const dateB = b.date_order || '';
      return dateB.localeCompare(dateA);
    });

    return { ok: true, value: out };
  } catch (error) {
    log.warn('[smv-vision][odoo-orders] listOrdersToInvoice falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}

/**
 * Devuelve órdenes de SUPRAJIT que ya tienen remisión entregada ('done')
 * pero no tienen Orden de Compra (client_order_ref está vacío o dice "Pendiente").
 * También podemos verificar que state sea 'draft' o 'sent' (Cotización).
 */
export async function listEntregasSinOC(options?: {
  max?: number;
}): Promise<OdooOrderResult<OdooOrderView[]>> {
  const database = db();
  if (!database) return { ok: false, reason: 'not-configured' };
  if (!isAuthed()) return { ok: false, reason: 'not-authenticated' };

  try {
    // Como las órdenes sin OC de Suprajit tal vez no estén en 'toInvoice' (si se configuraron mal),
    // y Odoo no deja facturar cotizaciones sin confirmar, hacemos un query a todo lo de SUPRAJIT (las más recientes)
    // y lo filtramos en cliente. Firebase Admin syncOdoo actualiza las órdenes.
    const q = query(
      collection(database, ODOO_ORDERS_COLLECTION),
      orderBy('date_order', 'desc'),
      fbLimit(Math.min(options?.max ?? DEFAULT_MAX, DEFAULT_MAX)),
    );

    const snap = await getDocs(q);
    const out: OdooOrderView[] = [];
    snap.forEach((d) => {
      const normalized = normalizeOdooOrder(d.id, d.data() as Record<string, unknown>);
      if (!normalized) return;
      
      // Solo órdenes de Suprajit (o Bulk Pack, etc., dependiendo del negocio)
      if (!normalized.partner.toUpperCase().includes('SUPRAJIT')) return;

      const hasPo = normalized.client_order_ref && 
                    normalized.client_order_ref.trim() !== '' && 
                    normalized.client_order_ref.toUpperCase() !== 'PENDIENTE' &&
                    normalized.client_order_ref.toUpperCase() !== 'FALTA OC';

      if (hasPo) return; // Si tiene OC, no nos interesa
      
      // Solo nos interesan las que siguen siendo Cotizaciones (draft o sent)
      // Odoo states: draft, sent, sale, done, cancel
      if (normalized.state !== 'draft' && normalized.state !== 'sent') return;

      // Debe tener alguna remisión (stock.picking) en estado 'done'
      // o líneas con qty_delivered > 0
      const hasDeliveredLines = normalized.order_lines.some(l => l.qty_delivered > 0);
      const hasDoneDelivery = normalized.deliveries?.some(d => d.state === 'done');
      
      if (hasDeliveredLines || hasDoneDelivery) {
        out.push(normalized);
      }
    });

    return { ok: true, value: out };
  } catch (error) {
    log.warn('[smv-vision][odoo-orders] listEntregasSinOC falló', error);
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
    log.warn('[smv-vision][odoo-orders] listWorkOrderStatusBySoNumbers falló', error);
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
    log.warn('[smv-vision][odoo-orders] listAllOdooOrders falló', error);
    return { ok: false, reason: 'read-failed' };
  }
}
