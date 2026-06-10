import { describe, it, expect } from 'vitest';
import { getDueDateSeverity, calcMetrics } from '../metrics';
import type { WorkOrder } from '../../../types';
import { addDaysToISODate } from '../../age';

function makeWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'wo-1',
    poNumber: 'PO-100',
    soNumber: 'SO-001',
    otDate: '2025-06-01',
    customer: 'SUPRAJIT',
    pieza: 'HEX SWAGE BLOCK',
    numeroParte: 'WCD-001',
    cantidad: '2',
    prioridad: 'Normal',
    status: 'pendiente',
    matchedPartId: null,
    matchedDrawingId: null,
    matchScore: null,
    deliveredToTornero: null,
    deliveredAtUTC: null,
    deliveredByUid: null,
    dueDate: null,
    assignedToTornero: null,
    assignedAtUTC: null,
    finishedAtUTC: null,
    notes: '',
    sourcePdfName: '',
    archived: false,
    createdAtUTC: '2025-06-01T00:00:00Z',
    updatedAtUTC: null,
    odooSource: false,
    odooOrderId: null,
    sortIndex: null,
    ...overrides,
  };
}

describe('getDueDateSeverity', () => {
  it('returns "done" when status is "entregada" regardless of date', () => {
    const result = getDueDateSeverity('2025-12-31', 'entregada');
    expect(result).toBe('done');

    const resultNull = getDueDateSeverity(null, 'entregada');
    expect(resultNull).toBe('done');

    const resultPast = getDueDateSeverity('2020-01-01', 'entregada');
    expect(resultPast).toBe('done');
  });

  it('returns "unknown" when dueDate is null', () => {
    const result = getDueDateSeverity(null, 'pendiente');
    expect(result).toBe('unknown');

    const result2 = getDueDateSeverity(null, 'en_proceso');
    expect(result2).toBe('unknown');
  });

  it('returns "overdue" for a date in the past', () => {
    const pastDate = '2020-01-01';
    const result = getDueDateSeverity(pastDate, 'pendiente');
    expect(result).toBe('overdue');
  });

  it('returns "critical" for dates 0-3 days away', () => {
    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Today
    const result0 = getDueDateSeverity(todayISO, 'pendiente');
    expect(result0).toBe('critical');

    // Tomorrow (1 day)
    const tomorrow = addDaysToISODate(todayISO, 1);
    const result1 = getDueDateSeverity(tomorrow!, 'pendiente');
    expect(result1).toBe('critical');

    // 3 days from now
    const in3Days = addDaysToISODate(todayISO, 3);
    const result3 = getDueDateSeverity(in3Days!, 'pendiente');
    expect(result3).toBe('critical');
  });

  it('returns "warning" for dates 4-7 days away', () => {
    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 4 days
    const in4Days = addDaysToISODate(todayISO, 4);
    const result4 = getDueDateSeverity(in4Days!, 'pendiente');
    expect(result4).toBe('warning');

    // 7 days
    const in7Days = addDaysToISODate(todayISO, 7);
    const result7 = getDueDateSeverity(in7Days!, 'pendiente');
    expect(result7).toBe('warning');
  });

  it('returns "ok" for dates > 7 days away', () => {
    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 8 days
    const in8Days = addDaysToISODate(todayISO, 8);
    const result = getDueDateSeverity(in8Days!, 'pendiente');
    expect(result).toBe('ok');

    // 30 days
    const in30Days = addDaysToISODate(todayISO, 30);
    const result30 = getDueDateSeverity(in30Days!, 'pendiente');
    expect(result30).toBe('ok');
  });
});

describe('calcMetrics', () => {
  it('returns nulls when no delivered orders', () => {
    const orders = [
      makeWorkOrder({ status: 'pendiente' }),
      makeWorkOrder({ status: 'en_proceso' }),
      makeWorkOrder({ status: 'terminada' }),
    ];
    const metrics = calcMetrics(orders);

    expect(metrics.avgCycleDays).toBe(null);
    expect(metrics.onTimePct).toBe(null);
    expect(metrics.latePct).toBe(null);
    expect(metrics.deliveredCount).toBe(0);
  });

  it('calculates avgCycleDays correctly (days between createdAtUTC and deliveredAtUTC)', () => {
    const created = '2025-06-01T00:00:00Z';
    const delivered = '2025-06-04T12:00:00Z'; // 3.5 days later

    const orders = [
      makeWorkOrder({
        status: 'entregada',
        createdAtUTC: created,
        deliveredAtUTC: delivered,
        dueDate: '2025-06-10',
      }),
    ];
    const metrics = calcMetrics(orders);

    // 3.5 days should be floored to 3, then avg is 3
    expect(metrics.avgCycleDays).toBe(3);
    expect(metrics.deliveredCount).toBe(1);
  });

  it('calculates avgCycleDays as average of multiple orders', () => {
    const orders = [
      makeWorkOrder({
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: '2025-06-04T00:00:00Z', // 3 days
        dueDate: '2025-06-10',
      }),
      makeWorkOrder({
        id: 'wo-2',
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: '2025-06-06T00:00:00Z', // 5 days
        dueDate: '2025-06-10',
      }),
    ];
    const metrics = calcMetrics(orders);

    // (3 + 5) / 2 = 4
    expect(metrics.avgCycleDays).toBe(4);
    expect(metrics.deliveredCount).toBe(2);
  });

  it('calculates onTimePct 100% when delivered before dueDate', () => {
    const orders = [
      makeWorkOrder({
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: '2025-06-04T12:00:00Z',
        dueDate: '2025-06-10',
      }),
    ];
    const metrics = calcMetrics(orders);

    expect(metrics.onTimePct).toBe(100);
    expect(metrics.latePct).toBe(0);
  });

  it('calculates onTimePct 100% when delivered on dueDate (before end of day local)', () => {
    // The implementation compares deliveredAtUTC against dueDate 23:59:59 LOCAL.
    // Build the timestamp with the local-time Date constructor so the test is
    // deterministic in any timezone (CI runs in UTC, the shop runs in UTC-6).
    const orders = [
      makeWorkOrder({
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        // 23:59:59 local on the due date — exactly at the on-time boundary.
        deliveredAtUTC: new Date(2025, 5, 10, 23, 59, 59).toISOString(),
        dueDate: '2025-06-10',
      }),
    ];
    const metrics = calcMetrics(orders);

    expect(metrics.onTimePct).toBe(100);
    expect(metrics.latePct).toBe(0);
  });

  it('calculates onTimePct 0% when delivered after the local end-of-day boundary', () => {
    // Same local-time construction: one second past midnight local on June 11
    // is after the June 10 local cutoff, so the order is late in any timezone.
    const orders = [
      makeWorkOrder({
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: new Date(2025, 5, 11, 0, 0, 1).toISOString(),
        dueDate: '2025-06-10',
      }),
    ];
    const metrics = calcMetrics(orders);

    expect(metrics.onTimePct).toBe(0);
    expect(metrics.latePct).toBe(100);
  });

  it('calculates onTimePct as percentage of on-time delivered orders', () => {
    const orders = [
      makeWorkOrder({
        id: 'wo-1',
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: '2025-06-04T00:00:00Z', // On time
        dueDate: '2025-06-10',
      }),
      makeWorkOrder({
        id: 'wo-2',
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: '2025-06-04T12:00:00Z', // Also on time
        dueDate: '2025-06-10',
      }),
    ];
    const metrics = calcMetrics(orders);

    // Both delivered before due date = 100%
    expect(metrics.onTimePct).toBe(100);
    expect(metrics.latePct).toBe(0);
  });

  it('counts delivered orders with status "entregada" and both timestamps', () => {
    const orders = [
      makeWorkOrder({
        id: 'wo-1',
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: '2025-06-04T00:00:00Z',
        dueDate: '2025-06-10',
      }),
      makeWorkOrder({
        id: 'wo-2',
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: null, // Missing timestamp
        dueDate: '2025-06-10',
      }),
      makeWorkOrder({
        id: 'wo-3',
        status: 'entregada',
        createdAtUTC: null, // Missing timestamp
        deliveredAtUTC: '2025-06-04T00:00:00Z',
        dueDate: '2025-06-10',
      }),
    ];
    const metrics = calcMetrics(orders);

    // Only wo-1 counts as delivered
    expect(metrics.deliveredCount).toBe(1);
  });

  it('excludes archived orders from inProgressCount', () => {
    const orders = [
      makeWorkOrder({
        id: 'wo-1',
        status: 'en_proceso',
        archived: false,
      }),
      makeWorkOrder({
        id: 'wo-2',
        status: 'en_proceso',
        archived: true,
      }),
      makeWorkOrder({
        id: 'wo-3',
        status: 'pendiente',
        archived: false,
      }),
    ];
    const metrics = calcMetrics(orders);

    // Only non-archived en_proceso orders
    expect(metrics.inProgressCount).toBe(1);
  });

  it('excludes archived orders from calculations', () => {
    const orders = [
      makeWorkOrder({
        id: 'wo-1',
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: '2025-06-04T00:00:00Z',
        dueDate: '2025-06-10',
        archived: true,
      }),
      makeWorkOrder({
        id: 'wo-2',
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: '2025-06-05T00:00:00Z',
        dueDate: '2025-06-10',
        archived: false,
      }),
    ];
    const metrics = calcMetrics(orders);

    // Only non-archived wo-2 counts: 4 days
    expect(metrics.avgCycleDays).toBe(4);
    expect(metrics.deliveredCount).toBe(1);
  });

  it('ignores orders without dueDate when calculating onTimePct', () => {
    const orders = [
      makeWorkOrder({
        id: 'wo-1',
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: '2025-06-04T00:00:00Z',
        dueDate: '2025-06-10',
      }),
      makeWorkOrder({
        id: 'wo-2',
        status: 'entregada',
        createdAtUTC: '2025-06-01T00:00:00Z',
        deliveredAtUTC: '2025-06-04T00:00:00Z',
        dueDate: null, // No due date
      }),
    ];
    const metrics = calcMetrics(orders);

    // Only wo-1 has a dueDate, so 100% on-time
    expect(metrics.onTimePct).toBe(100);
    expect(metrics.latePct).toBe(0);
    // But both count for avgCycleDays
    expect(metrics.avgCycleDays).toBe(3);
  });

  it('returns zero counts when orders array is empty', () => {
    const metrics = calcMetrics([]);
    expect(metrics.avgCycleDays).toBe(null);
    expect(metrics.onTimePct).toBe(null);
    expect(metrics.latePct).toBe(null);
    expect(metrics.inProgressCount).toBe(0);
    expect(metrics.deliveredCount).toBe(0);
  });
});
