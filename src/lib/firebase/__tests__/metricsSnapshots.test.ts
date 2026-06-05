import { describe, it, expect } from 'vitest';
import { buildSnapshotData } from '../metricsSnapshots';
import type { WorkOrder } from '../../../types';

function makeOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'wo-1',
    poNumber: 'PO-100',
    soNumber: 'SO-001',
    otDate: '2026-01-01',
    customer: 'SUPRAJIT',
    pieza: 'HEX BLOCK',
    numeroParte: 'WCD-001',
    cantidad: '2',
    prioridad: 'Normal',
    status: 'pendiente',
    matchedPartId: null,
    matchedDrawingId: null,
    matchScore: null,
    dueDate: null,
    notes: '',
    sourcePdfName: '',
    archived: false,
    sortIndex: null,
    assignedToTornero: null,
    deliveredToTornero: null,
    createdAtUTC: null,
    assignedAtUTC: null,
    finishedAtUTC: null,
    deliveredAtUTC: null,
    deliveredByUid: null,
    updatedAtUTC: null,
    odooSource: false,
    odooOrderId: null,
    ...overrides,
  };
}

describe('buildSnapshotData', () => {
  it('counts active orders by stage', () => {
    const orders = [
      makeOrder({ id: '1', status: 'pendiente' }),
      makeOrder({ id: '2', status: 'pendiente' }),
      makeOrder({ id: '3', status: 'en_proceso', assignedToTornero: 'Juan' }),
      makeOrder({ id: '4', status: 'terminada', assignedToTornero: 'Juan' }),
      makeOrder({ id: '5', status: 'entregada' }),
    ];
    const snap = buildSnapshotData(orders);
    expect(snap.byStage).toEqual({ pendiente: 2, en_proceso: 1, terminada: 1, entregada: 1 });
    expect(snap.totalActive).toBe(5);
  });

  it('excludes archived orders', () => {
    const orders = [
      makeOrder({ id: '1', status: 'pendiente' }),
      makeOrder({ id: '2', status: 'pendiente', archived: true }),
    ];
    const snap = buildSnapshotData(orders);
    expect(snap.totalActive).toBe(1);
    expect(snap.byStage.pendiente).toBe(1);
  });

  it('groups non-entregada orders by tornero', () => {
    const orders = [
      makeOrder({ id: '1', status: 'pendiente', assignedToTornero: null }),
      makeOrder({ id: '2', status: 'en_proceso', assignedToTornero: 'Juan' }),
      makeOrder({ id: '3', status: 'en_proceso', assignedToTornero: 'Juan' }),
      makeOrder({ id: '4', status: 'terminada', assignedToTornero: 'Pedro' }),
      makeOrder({ id: '5', status: 'entregada', assignedToTornero: 'Pedro' }), // excluded
    ];
    const snap = buildSnapshotData(orders);
    expect(snap.byTornero['Juan']).toBe(2);
    expect(snap.byTornero['Pedro']).toBe(1);
    expect(snap.byTornero['__unassigned__']).toBe(1);
    // entregada orders are not counted in byTornero
    expect(Object.values(snap.byTornero).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('counts overdue orders (past due date, not entregada)', () => {
    const orders = [
      makeOrder({ id: '1', status: 'pendiente', dueDate: '2020-01-01' }), // overdue
      makeOrder({ id: '2', status: 'pendiente', dueDate: '2030-01-01' }), // ok
      makeOrder({ id: '3', status: 'entregada', dueDate: '2020-01-01' }), // entregada, not overdue
    ];
    const snap = buildSnapshotData(orders);
    expect(snap.overdueCount).toBe(1);
  });

  it('sets date as today in YYYY-MM-DD format', () => {
    const snap = buildSnapshotData([]);
    expect(snap.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
