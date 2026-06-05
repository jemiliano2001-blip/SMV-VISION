import type { DropResult } from '@hello-pangea/dnd';
import type { WorkOrder, WorkOrderStatus } from '../../types';

const STAGES: WorkOrderStatus[] = ['pendiente', 'en_proceso', 'terminada', 'entregada'];

type KanbanDropNoop = { type: 'noop'; reason: 'no-destination' | 'same-column' | 'invalid-stage' | 'tornero-required' | 'order-not-found' };
type KanbanDropReorder = { type: 'reorder'; orderId: string; sourceIndex: number; destinationIndex: number };
type KanbanDropTransition = { type: 'transition'; orderId: string; newStatus: WorkOrderStatus; torneroName: string | null };

export type KanbanDropResult = KanbanDropNoop | KanbanDropReorder | KanbanDropTransition;

export function resolveKanbanDrop(result: DropResult, orders: WorkOrder[]): KanbanDropResult {
  if (!result.destination) {
    return { type: 'noop', reason: 'no-destination' };
  }

  const { droppableId: sourceCol, index: sourceIndex } = result.source;
  const { droppableId: destCol, index: destIndex } = result.destination;

  if (sourceCol === destCol) {
    return { type: 'reorder', orderId: result.draggableId, sourceIndex, destinationIndex: destIndex };
  }

  if (!STAGES.includes(destCol as WorkOrderStatus)) {
    return { type: 'noop', reason: 'invalid-stage' };
  }

  const order = orders.find((o) => o.id === result.draggableId);
  if (!order) {
    return { type: 'noop', reason: 'order-not-found' };
  }

  const newStatus = destCol as WorkOrderStatus;
  const needsTornero = newStatus === 'en_proceso' || newStatus === 'entregada';

  if (needsTornero && !order.assignedToTornero) {
    return { type: 'noop', reason: 'tornero-required' };
  }

  return {
    type: 'transition',
    orderId: result.draggableId,
    newStatus,
    torneroName: needsTornero ? order.assignedToTornero : null,
  };
}
