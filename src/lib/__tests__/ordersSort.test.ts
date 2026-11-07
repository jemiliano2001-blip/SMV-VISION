import { describe, expect, it } from 'vitest';
import type { OdooOrderView } from '../firebase/odooOrders';
import { sortOrdersOldestFirst } from '../../hooks/useOdooOrdersFilters';

const order = (name: string, date_order: string | null) => ({ name, date_order }) as OdooOrderView;

describe('sortOrdersOldestFirst', () => {
  it('pone primero la orden más antigua y al final las que no tienen fecha', () => {
    const sorted = sortOrdersOldestFirst([
      order('sin-fecha', null),
      order('nueva', '2026-11-05 10:00:00'),
      order('vieja', '2026-09-01 10:00:00'),
    ]);
    expect(sorted.map((o) => o.name)).toEqual(['vieja', 'nueva', 'sin-fecha']);
  });

  it('no modifica el arreglo recibido', () => {
    const input = [order('b', '2026-02-01'), order('a', '2026-01-01')];
    sortOrdersOldestFirst(input);
    expect(input.map((o) => o.name)).toEqual(['b', 'a']);
  });
});
