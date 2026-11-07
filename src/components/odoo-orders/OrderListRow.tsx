import { memo } from 'react';
import { orderRequester, type OdooOrderView } from '../../lib/firebase/odooOrders';
import { getOrderAgeDays } from '../../lib/age';

export interface OrderListRowProps {
  order: OdooOrderView;
  selected: boolean;
  missingDrawing: boolean;
  onSelect: (orderId: string) => void;
}

function ageTone(days: number | null): string {
  if (days === null) return 'text-ink-dim';
  if (days > 14) return 'text-danger';
  if (days >= 8) return 'text-warn';
  return 'text-ok';
}

export const OrderListRow = memo(function OrderListRow({
  order,
  selected,
  missingDrawing,
  onSelect,
}: OrderListRowProps) {
  const days = order.date_order ? getOrderAgeDays(order.date_order.split(' ')[0]) : null;
  const lines = order.order_lines.length;

  return (
    <button
      type="button"
      aria-current={selected || undefined}
      onClick={() => onSelect(order.id)}
      className={`w-full min-h-14 text-left px-4 py-2 border-b border-l-2 border-b-line transition-colors ${
        selected ? 'border-l-accent bg-accent/10' : 'border-l-transparent hover:bg-surface-2'
      }`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-sm font-bold text-ink">{order.name}</span>
        <span className={`font-mono text-[11px] font-bold tabular-nums shrink-0 ${ageTone(days)}`}>
          {days === null ? 'Sin fecha' : `${days} d`}
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-3 mt-0.5 text-[11px] text-ink-dim">
        <span className="truncate">
          {order.partner}
          {orderRequester(order) ? ` · ${orderRequester(order)}` : ''}
        </span>
        <span className="shrink-0 tabular-nums">
          {missingDrawing && <span className="text-warn font-semibold">Sin plano · </span>}
          {lines} {lines === 1 ? 'línea' : 'líneas'}
        </span>
      </span>
    </button>
  );
});
