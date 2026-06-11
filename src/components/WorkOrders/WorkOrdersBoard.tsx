import React, { type ReactElement } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import type { WorkOrder, WorkOrderStatus, Tornero } from '../../types';
import { WorkOrderCard } from './WorkOrderCard';
import { STATUS_LABELS, COLUMN_ACCENT } from './utils';

export interface WorkOrdersBoardProps {
  filteredOrders: WorkOrder[];
  pendientesSortBy: 'manual' | 'dueDate' | 'po';
  setPendientesSortBy: (val: 'manual' | 'dueDate' | 'po') => void;
  isBulkMode: boolean;
  setIsBulkMode: (val: boolean) => void;
  selectedOrders: Set<string>;
  setSelectedOrders: (val: Set<string>) => void;
  activeTorneros: Tornero[];
  workload: Record<string, number>;
  rowBusy: Record<string, string>;

  editingDueDateId: string | null;
  draftDueDate: string;
  editingNotesId: string | null;
  draftNotes: string;

  onDragEnd: (result: DropResult) => void;
  onBulkAssign: (torneroName: string) => void;
  onBulkTransition: (newStatus: WorkOrderStatus) => void;

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
  onToggleSelect: (id: string) => void;
}

export function WorkOrdersBoard({
  filteredOrders,
  pendientesSortBy,
  setPendientesSortBy,
  isBulkMode,
  setIsBulkMode,
  selectedOrders,
  setSelectedOrders,
  activeTorneros,
  workload,
  rowBusy,
  editingDueDateId,
  draftDueDate,
  editingNotesId,
  draftNotes,

  onDragEnd,
  onBulkAssign,
  onBulkTransition,

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
  onToggleSelect,
}: WorkOrdersBoardProps): ReactElement {
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {(['pendiente', 'en_proceso', 'terminada', 'entregada'] as const).map((col) => {
          let cards = filteredOrders.filter((o) => o.status === col);
          if (col === 'pendiente') {
            if (pendientesSortBy === 'manual') cards = cards.sort((a, b) => (a.sortIndex ?? Infinity) - (b.sortIndex ?? Infinity));
            else if (pendientesSortBy === 'dueDate') cards = cards.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
            else if (pendientesSortBy === 'po') cards = cards.sort((a, b) => (a.poNumber || '').localeCompare(b.poNumber || ''));
          }
          
          return (
            <section key={col} className={`bg-surface/40 border-2 border-line border-t-4 ${COLUMN_ACCENT[col]} flex flex-col min-h-[120px]`}>
              <header className="flex flex-col bg-surface z-10 sticky top-0 border-b-2 border-line">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="font-display font-black text-[12px] uppercase tracking-wider">{STATUS_LABELS[col]}</span>
                  <span className="font-mono text-[11px] text-ink-dim">{cards.length}</span>
                </div>
                {col === 'pendiente' && (
                  <div className="px-2 pb-2 flex flex-col gap-2">
                    {/* Sorting toolbar */}
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => setPendientesSortBy('manual')} className={`px-2 py-1 text-[9px] font-black uppercase border-2 transition-colors ${pendientesSortBy === 'manual' ? 'bg-ink text-bg border-ink' : 'border-line text-ink-dim'}`}>Manual</button>
                      <button type="button" onClick={() => setPendientesSortBy('dueDate')} className={`px-2 py-1 text-[9px] font-black uppercase border-2 transition-colors ${pendientesSortBy === 'dueDate' ? 'bg-ink text-bg border-ink' : 'border-line text-ink-dim'}`}>Fecha</button>
                      <button type="button" onClick={() => setPendientesSortBy('po')} className={`px-2 py-1 text-[9px] font-black uppercase border-2 transition-colors ${pendientesSortBy === 'po' ? 'bg-ink text-bg border-ink' : 'border-line text-ink-dim'}`}>PO</button>
                    </div>
                    {/* Bulk actions trigger */}
                    <div className="flex justify-between items-center bg-surface-2 px-2 py-1.5 border border-line">
                      <label className="flex items-center gap-1.5 text-[9px] font-black uppercase cursor-pointer text-ink hover:text-accent transition-colors">
                        <input type="checkbox" checked={isBulkMode} onChange={(e) => { setIsBulkMode(e.target.checked); if (!e.target.checked) setSelectedOrders(new Set()); }} className="accent-accent" />
                        Selección Múltiple
                      </label>
                      {isBulkMode && selectedOrders.size > 0 && (
                        <span className="text-[9px] font-black text-accent">{selectedOrders.size} selec.</span>
                      )}
                    </div>
                    {/* Bulk actions bar */}
                    {isBulkMode && selectedOrders.size > 0 && (
                      <div className="flex flex-col gap-1 border border-line p-1 bg-surface-2 animate-in fade-in slide-in-from-top-2">
                        <select
                          defaultValue=""
                          onChange={(e) => { const v = e.target.value; if (v) void onBulkAssign(v); e.currentTarget.value = ''; }}
                          className="border border-line bg-surface text-ink px-2 py-1 text-[9px] font-black uppercase w-full"
                        >
                          <option value="" disabled>Asignar seleccionadas ▾</option>
                          {activeTorneros.map((t) => <option key={t.id} value={t.name}>{t.name} {workload[t.name] ? `(${workload[t.name]} act)` : ''}</option>)}
                        </select>
                        <button type="button" onClick={() => void onBulkTransition('en_proceso')} className="border border-draft bg-draft text-bg px-2 py-1 text-[9px] font-black uppercase w-full">A Proceso ({selectedOrders.size})</button>
                      </div>
                    )}
                  </div>
                )}
              </header>
              <Droppable droppableId={col}>
                {(droppableProvided) => (
                  <div
                    ref={droppableProvided.innerRef}
                    {...droppableProvided.droppableProps}
                    className="p-2 space-y-2 grow min-h-[40px]"
                  >
                    {cards.length === 0
                      ? <p className="text-[10px] font-mono text-ink-dim/60 text-center py-6">—</p>
                      : cards.map((o, cardIndex) => (
                          <Draggable
                            key={o.id}
                            draggableId={o.id}
                            index={cardIndex}
                            isDragDisabled={isBulkMode || (col === 'pendiente' && pendientesSortBy !== 'manual')}
                          >
                            {(draggableProvided) => (
                              <div
                                ref={draggableProvided.innerRef}
                                {...draggableProvided.draggableProps}
                                {...draggableProvided.dragHandleProps}
                              >
                                <WorkOrderCard
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
                                  isBulkMode={isBulkMode}
                                  isSelected={selectedOrders.has(o.id)}
                                  onToggleSelect={onToggleSelect}
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                    {droppableProvided.placeholder}
                  </div>
                )}
              </Droppable>
            </section>
          );
        })}
      </div>
    </DragDropContext>
  );
}
