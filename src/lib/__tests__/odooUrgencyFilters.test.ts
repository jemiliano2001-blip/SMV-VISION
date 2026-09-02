import { describe, it, expect } from 'vitest';
import { getOrderUrgencyCategory } from '../../hooks/useOdooOrdersFilters';
import type { OdooOrderView } from '../firebase/odooOrders';

function makeMockOrder(overrides: Partial<OdooOrderView>): OdooOrderView {
  return {
    id: 'so_1',
    name: 'SO001',
    date_order: null,
    partner: 'SUPRAJIT',
    partnerKey: 'SUPRAJIT',
    client_order_ref: 'PO-1234',
    requisitor: 'ING. CARLOS',
    invoice_status: 'to invoice',
    state: 'sale',
    toInvoice: true,
    order_lines: [],
    deliveries: [],
    syncedAtUTC: null,
    ...overrides,
  };
}

describe('Odoo Urgency Categories and Filters', () => {
  it('identifies OVERDUE orders (> 14 days)', () => {
    // 20 days ago
    const pastDate = new Date(Date.now() - 20 * 86_400_000);
    const dateStr = pastDate.toISOString().split('T')[0] + ' 10:00:00';
    const order = makeMockOrder({ date_order: dateStr });

    expect(getOrderUrgencyCategory(order)).toBe('OVERDUE');
  });

  it('identifies CRITICAL orders (between 8 and 14 days)', () => {
    // 10 days ago
    const pastDate = new Date(Date.now() - 10 * 86_400_000);
    const dateStr = pastDate.toISOString().split('T')[0] + ' 08:30:00';
    const order = makeMockOrder({ date_order: dateStr });

    expect(getOrderUrgencyCategory(order)).toBe('CRITICAL');
  });

  it('identifies NORMAL orders (<= 7 days)', () => {
    // 2 days ago
    const recentDate = new Date(Date.now() - 2 * 86_400_000);
    const dateStr = recentDate.toISOString().split('T')[0] + ' 12:00:00';
    const order = makeMockOrder({ date_order: dateStr });

    expect(getOrderUrgencyCategory(order)).toBe('NORMAL');
  });

  it('returns UNKNOWN when date_order is missing or invalid', () => {
    expect(getOrderUrgencyCategory(makeMockOrder({ date_order: null }))).toBe('UNKNOWN');
    expect(getOrderUrgencyCategory(makeMockOrder({ date_order: 'not-a-date' }))).toBe('UNKNOWN');
  });
});
