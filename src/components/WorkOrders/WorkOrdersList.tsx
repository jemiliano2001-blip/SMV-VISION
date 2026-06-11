import React, { type ReactElement } from 'react';
import type { WorkOrder, WorkOrderStatus, Tornero } from '../../types';
import { WorkOrderCard } from './WorkOrderCard';

export interface WorkOrdersListProps {
  orders: WorkOrder[];
  rowBusy: Record<string, string>;
  editingDueDateId: string | null;
  draftDueDate: string;
  editingNotesId: string | null;
  draftNotes: string;
  activeTorneros: Tornero[];
  workload: Record<string, number>;

  onTransition: (order: WorkOrder, status: WorkOrderStatus, tornero?: string) => void;
  onAssignTornero: (orderId: string, torneroName: string) => void;
  onArchive: (order: WorkOrder) => void;
  onPrint: (order: WorkOrder) => void;
  onSaveDueDate: (id: string, val: string) => void;
  onSaveNotes: (id: string) => void;
  onEditDueDate: (id: string | null) => void;
  onEditNotes: (id: string | null) => void;
  onDraftDueDateChange: (val: string) => void;
  onDraftNotesChange: (val: string) => void;
}

export function WorkOrdersList({
  orders,
  rowBusy,
  editingDueDateId,
  draftDueDate,
  editingNotesId,
  draftNotes,
  activeTorneros,
  workload,
  onTransition,
  onAssignTornero,
  onArchive,
  onPrint,
  onSaveDueDate,
  onSaveNotes,
  onEditDueDate,
  onEditNotes,
  onDraftDueDateChange,
  onDraftNotesChange,
}: WorkOrdersListProps): ReactElement {
  if (orders.length === 0) {
    return <p className="text-[11px] font-mono text-ink-dim py-4">Ninguna orden en este estado.</p>;
  }

  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <WorkOrderCard
          key={o.id}
          order={o}
          busy={rowBusy[o.id]}
          editingDueDateId={editingDueDateId}
          draftDueDate={draftDueDate}
          editingNotesId={editingNotesId}
          draftNotes={draftNotes}
          activeTorneros={activeTorneros}
          onTransition={onTransition}
          onAssignTornero={onAssignTornero}
          onArchive={onArchive}
          onPrint={onPrint}
          onSaveDueDate={onSaveDueDate}
          onSaveNotes={onSaveNotes}
          onEditDueDate={onEditDueDate}
          onEditNotes={onEditNotes}
          onDraftDueDateChange={onDraftDueDateChange}
          onDraftNotesChange={onDraftNotesChange}
          workload={workload}
          isBulkMode={false}
          isSelected={false}
          onToggleSelect={() => {}}
        />
      ))}
    </div>
  );
}
