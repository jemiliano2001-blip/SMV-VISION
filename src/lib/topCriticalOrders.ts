/** Órdenes más críticas (más antiguas) para la portada. Lógica pura. */

import { getOrderAgeDays } from './age';
import { orderRequester, type OdooOrderView } from './firebase/odooOrders';

export interface CriticalOrder {
  id: string;
  name: string;
  company: string;
  requester: string | null;
  /** Días desde la fecha de la orden; null si la fecha no es legible. */
  ageDays: number | null;
  pendingPieces: number;
}

export function topCriticalOrders(orders: OdooOrderView[], limit: number): CriticalOrder[] {
  if (limit <= 0) return [];
  return orders
    .map((o): CriticalOrder => {
      const date = typeof o.date_order === 'string' ? o.date_order.split(' ')[0] : '';
      return {
        id: o.id,
        name: o.name,
        company: o.partner,
        requester: orderRequester(o),
        ageDays: date ? getOrderAgeDays(date) : null,
        pendingPieces: (o.order_lines ?? []).reduce(
          (sum, l) => sum + (Number.isFinite(l.qty_pending) && l.qty_pending > 0 ? l.qty_pending : 0),
          0,
        ),
      };
    })
    .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1))
    .slice(0, limit);
}
