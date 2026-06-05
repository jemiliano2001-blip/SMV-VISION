import { describe, it, expect } from 'vitest';
import type { DropResult } from '@hello-pangea/dnd';
import { resolveKanbanDrop } from '../kanbanDrop';
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
    archived: false,
    sortIndex: null,
    assignedToTornero: null,
    deliveredToTornero: null,
    createdAtUTC: null,
    assignedAtUTC: null,
    finishedAtUTC: null,
    deliveredAtUTC: null,
    deliveredByUid: null,
    sourcePdfName: '',
    updatedAtUTC: null,
    odooSource: false,
    odooOrderId: null,
    ...overrides,
  };
}

function makeDropResult(overrides: Partial<DropResult> = {}): DropResult {
  return {
    draggableId: 'wo-1',
    type: 'DEFAULT',
    source: { droppableId: 'pendiente', index: 0 },
    destination: { droppableId: 'en_proceso', index: 0 },
    reason: 'DROP',
    mode: 'FLUID',
    combine: null,
    ...overrides,
  };
}

describe('resolveKanbanDrop', () => {
  it('returns noop when destination is null', () => {
    const result = resolveKanbanDrop(
      makeDropResult({ destination: null }),
      [makeOrder()]
    );
    expect(result.type).toBe('noop');
    if (result.type === 'noop') expect(result.reason).toBe('no-destination');
  });

  it('returns reorder when dropped in the same column', () => {
    const result = resolveKanbanDrop(
      makeDropResult({ destination: { droppableId: 'pendiente', index: 1 } }),
      [makeOrder(), makeOrder({ id: 'wo-2', status: 'pendiente' })]
    );
    expect(result.type).toBe('reorder');
    if (result.type === 'reorder') {
      expect(result.orderId).toBe('wo-1');
      expect(result.sourceIndex).toBe(0);
      expect(result.destinationIndex).toBe(1);
    }
  });

  it('returns transition for valid cross-column drop to terminada', () => {
    const result = resolveKanbanDrop(
      makeDropResult({
        source: { droppableId: 'en_proceso', index: 0 },
        destination: { droppableId: 'terminada', index: 0 },
      }),
      [makeOrder({ id: 'wo-1', status: 'en_proceso', assignedToTornero: 'Juan' })]
    );
    expect(result.type).toBe('transition');
    if (result.type === 'transition') {
      expect(result.newStatus).toBe('terminada');
      expect(result.torneroName).toBeNull();
    }
  });

  it('returns transition with torneroName for drop to en_proceso when already assigned', () => {
    const result = resolveKanbanDrop(
      makeDropResult({
        source: { droppableId: 'pendiente', index: 0 },
        destination: { droppableId: 'en_proceso', index: 0 },
      }),
      [makeOrder({ assignedToTornero: 'Pedro' })]
    );
    expect(result.type).toBe('transition');
    if (result.type === 'transition') expect(result.torneroName).toBe('Pedro');
  });

  it('returns noop with tornero-required when dropping to en_proceso without assigned tornero', () => {
    const result = resolveKanbanDrop(
      makeDropResult({
        source: { droppableId: 'pendiente', index: 0 },
        destination: { droppableId: 'en_proceso', index: 0 },
      }),
      [makeOrder({ assignedToTornero: null })]
    );
    expect(result.type).toBe('noop');
    if (result.type === 'noop') expect(result.reason).toBe('tornero-required');
  });

  it('returns noop with tornero-required when dropping to entregada without assigned tornero', () => {
    const result = resolveKanbanDrop(
      makeDropResult({
        source: { droppableId: 'terminada', index: 0 },
        destination: { droppableId: 'entregada', index: 0 },
      }),
      [makeOrder({ status: 'terminada', assignedToTornero: null })]
    );
    expect(result.type).toBe('noop');
    if (result.type === 'noop') expect(result.reason).toBe('tornero-required');
  });

  it('returns noop when order is not found', () => {
    const result = resolveKanbanDrop(
      makeDropResult({ draggableId: 'nonexistent' }),
      [makeOrder()]
    );
    expect(result.type).toBe('noop');
  });

  it('returns noop with invalid-stage for unknown droppable', () => {
    const result = resolveKanbanDrop(
      makeDropResult({ destination: { droppableId: 'unknown-stage', index: 0 } }),
      [makeOrder()]
    );
    expect(result.type).toBe('noop');
    if (result.type === 'noop') expect(result.reason).toBe('invalid-stage');
  });
});
