import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { topCriticalOrders } from '../topCriticalOrders';
import type { OdooOrderView } from '../firebase/odooOrders';

function order(id: string, date: string | null, pending: number[], extra: Partial<OdooOrderView> = {}): OdooOrderView {
  return {
    id,
    name: `S-${id}`,
    date_order: date,
    partner: 'ACME',
    engineer: null,
    requisitor: null,
    order_lines: pending.map((qty_pending) => ({ qty_pending })),
    ...extra,
  } as unknown as OdooOrderView;
}

describe('topCriticalOrders', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('ordena de la más antigua a la más reciente y respeta el límite', () => {
    const res = topCriticalOrders(
      [order('a', '2026-11-08 10:00:00', [1]), order('b', '2026-10-01 10:00:00', [1]), order('c', '2026-11-01 10:00:00', [1])],
      2,
    );
    expect(res.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('devuelve compañía, antigüedad en días y piezas pendientes (solo positivas)', () => {
    const [r] = topCriticalOrders([order('a', '2026-11-05 08:00:00', [3, -2, 4], { partner: 'SUPRAJIT', engineer: 'Ana' })], 5);
    expect(r).toMatchObject({ id: 'a', company: 'SUPRAJIT', requester: 'Ana', ageDays: 5, pendingPieces: 7 });
  });

  it('manda al final las órdenes sin fecha legible', () => {
    const res = topCriticalOrders([order('x', null, [1]), order('y', '2026-11-09 10:00:00', [1])], 5);
    expect(res.map((r) => r.id)).toEqual(['y', 'x']);
    expect(res[1].ageDays).toBeNull();
  });

  it('límite 0 o lista vacía devuelve []', () => {
    expect(topCriticalOrders([], 3)).toEqual([]);
    expect(topCriticalOrders([order('a', '2026-11-01 00:00:00', [1])], 0)).toEqual([]);
  });
});
