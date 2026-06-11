import React, { type ReactElement } from 'react';
import { Clock, CheckCircle2, Printer, Archive } from 'lucide-react';
import type { WorkOrder, WorkOrderStatus, Tornero } from '../../types';
import { getDueDateSeverity, dueDaysLabel } from '../../lib/workOrders/metrics';
import {
  SEVERITY_CLASSES,
  STATUS_CHIP_CLASSES,
  STATUS_LABELS,
  fmtCalendarDate,
  fmtDate,
  oneLine,
} from './utils';

export interface OrderCardProps {
  order: WorkOrder;
  busy: string | undefined;
  editingDueDateId: string | null;
  draftDueDate: string;
  editingNotesId: string | null;
  draftNotes: string;
  activeTorneros: Tornero[];
  onTransition: (order: WorkOrder, status: WorkOrderStatus, tornero?: string) => void;
  onAssignTornero: (orderId: string, torneroName: string) => void;
  onArchive: (order: WorkOrder) => void;
  onPrint: (order: WorkOrder) => void;

  workload: Record<string, number>;
  isBulkMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;

  onSaveDueDate: (id: string, val: string) => void;
  onSaveNotes: (id: string) => void;
  onEditDueDate: (id: string | null) => void;
  onEditNotes: (id: string | null) => void;
  onDraftDueDateChange: (val: string) => void;
  onDraftNotesChange: (val: string) => void;
}

export const WorkOrderCard = React.memo(function WorkOrderCard({
  order: o,
  busy,
  editingDueDateId,
  draftDueDate,
  editingNotesId,
  draftNotes,
  activeTorneros,
  onTransition,
  onAssignTornero,
  onArchive,
  onPrint,
  workload,
  isBulkMode,
  isSelected,
  onToggleSelect,
  onSaveDueDate,
  onSaveNotes,
  onEditDueDate,
  onEditNotes,
  onDraftDueDateChange,
  onDraftNotesChange,
}: OrderCardProps): ReactElement {
  const severity = getDueDateSeverity(o.dueDate, o.status);
  const isEditingNotes = editingNotesId === o.id;
  const isEditingDueDate = editingDueDateId === o.id;

  return (
    <div
      className={`relative border-2 border-line bg-surface transition-all p-3 ${o.prioridad === 'URGENTE' ? 'border-l-accent border-l-4' : ''} ${o.archived ? 'opacity-50' : ''}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        {/* Bulk mode checkbox */}
        {isBulkMode && o.status === 'pendiente' && (
          <div className="pt-1 pr-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(o.id)}
              className="w-4 h-4 cursor-pointer accent-ink"
            />
          </div>
        )}

        {/* Info izquierda */}
        <div className="min-w-0 grow space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {o.prioridad === 'URGENTE' && (
              <span className="bg-accent text-bg px-1.5 py-0.5 text-[9px] font-black uppercase shrink-0">Urgente</span>
            )}
            <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase shrink-0 ${STATUS_CHIP_CLASSES[o.status]}`}>
              {STATUS_LABELS[o.status]}
            </span>
            <p className="text-[14px] font-black uppercase tracking-tight truncate text-ink" title={o.pieza}>
              {o.pieza}
            </p>
          </div>

          <p className="text-[10px] font-mono text-ink-dim">
            PARTE: {o.numeroParte || '—'} · SO: {oneLine(o.soNumber) || '—'} · PO: {oneLine(o.poNumber) || '—'} · CANT: {oneLine(o.cantidad) || '—'} · OT: {oneLine(o.otDate) || '—'}
          </p>

          {/* Fecha límite */}
          <div className="flex items-center gap-2 flex-wrap">
            {isEditingDueDate ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => { e.preventDefault(); void onSaveDueDate(o.id, draftDueDate); }}
              >
                <input
                  type="date"
                  value={draftDueDate}
                  onChange={(e) => onDraftDueDateChange(e.target.value)}
                  className="border border-line bg-surface-2 text-ink px-1 py-0.5 text-[11px] font-mono outline-none"
                />
                <button type="submit" className="px-2 py-0.5 bg-ink text-bg text-[9px] font-black uppercase">OK</button>
                <button type="button" onClick={() => onEditDueDate(null)} className="px-2 py-0.5 border border-line text-[9px] font-black uppercase text-ink-dim">✕</button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => { onEditDueDate(o.id); onDraftDueDateChange(o.dueDate ?? ''); }}
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-black uppercase border ${SEVERITY_CLASSES[severity]} hover:opacity-80 transition-opacity`}
                title="Click para editar fecha límite"
              >
                <Clock size={10} />
                {o.dueDate ? `${fmtCalendarDate(o.dueDate)} · ${dueDaysLabel(o.dueDate)}` : 'Sin fecha límite — click para fijar'}
              </button>
            )}
          </div>

          {/* Estado de avance */}
          {o.status === 'pendiente' && o.assignedToTornero && (
            <p className="text-[10px] font-mono text-draft flex items-center gap-1">
              Pre-asignado a <b>{o.assignedToTornero}</b> (en espera)
            </p>
          )}
          {o.status === 'en_proceso' && o.assignedToTornero && (
            <p className="text-[10px] font-mono text-draft flex items-center gap-1">
              <span className="w-2 h-2 bg-draft rounded-full inline-block" />
              En proceso con <b>{o.assignedToTornero}</b>
              {o.assignedAtUTC && <span className="text-ink-dim"> · desde {fmtDate(o.assignedAtUTC)}</span>}
            </p>
          )}
          {o.status === 'terminada' && (
            <p className="text-[10px] font-mono text-ok flex items-center gap-1">
              <CheckCircle2 size={11} />
              Terminada{o.finishedAtUTC ? ` el ${fmtDate(o.finishedAtUTC)}` : ''}
              {o.assignedToTornero && <span> · hecha por <b>{o.assignedToTornero}</b></span>}
            </p>
          )}
          {o.status === 'entregada' && (
            <p className="text-[10px] font-mono text-ink-dim flex items-center gap-1">
              <CheckCircle2 size={11} className="text-ok" />
              Entregada a <b>{o.deliveredToTornero ?? '—'}</b> el {fmtDate(o.deliveredAtUTC)}
            </p>
          )}

          {/* Notas */}
          {isEditingNotes ? (
            <div className="space-y-1 mt-1">
              <textarea
                rows={2}
                value={draftNotes}
                onChange={(e) => onDraftNotesChange(e.target.value)}
                placeholder="Notas para esta orden…"
                className="w-full border border-line bg-surface-2 text-ink px-2 py-1 text-[11px] font-mono outline-none resize-none placeholder:text-ink-dim/70"
              />
              <div className="flex gap-1">
                <button type="button" onClick={() => void onSaveNotes(o.id)}
                  className="px-2 py-0.5 bg-ink text-bg text-[9px] font-black uppercase">Guardar</button>
                <button type="button" onClick={() => onEditNotes(null)}
                  className="px-2 py-0.5 border border-line text-[9px] font-black uppercase text-ink-dim">Cancelar</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { onEditNotes(o.id); onDraftNotesChange(o.notes); }}
              className="text-[10px] font-mono text-ink-dim hover:text-ink text-left"
            >
              {o.notes ? o.notes : '+ Agregar nota…'}
            </button>
          )}
        </div>

        {/* Acciones derecha */}
        <div className="flex flex-col items-stretch gap-1.5 shrink-0">
          <button type="button" onClick={() => void onPrint(o)} disabled={!!busy}
            className="border border-line bg-surface-2 px-2 py-1 text-[9px] font-black uppercase text-ink hover:border-accent hover:text-accent disabled:opacity-40 flex items-center gap-1 transition-colors">
            <Printer size={11} /> Plano-OT
          </button>

          {o.status === 'pendiente' && (
            <>
              <select
                value={o.assignedToTornero ?? ''}
                disabled={!!busy || activeTorneros.length === 0}
                onChange={(e) => { const v = e.target.value; if (v) void onAssignTornero(o.id, v); }}
                className="border border-line bg-surface-2 text-ink px-2 py-1 text-[9px] font-black uppercase disabled:opacity-40"
                title={activeTorneros.length === 0 ? 'Agrega torneros primero' : 'Asignar a tornero'}
              >
                <option value="" disabled>{busy ?? 'Asignar a ▾'}</option>
                {activeTorneros.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name} {workload[t.name] ? `(${workload[t.name]} act)` : ''}
                  </option>
                ))}
              </select>
              {o.assignedToTornero && (
                <button type="button" disabled={!!busy}
                  onClick={() => void onTransition(o, 'en_proceso', o.assignedToTornero!)}
                  className="border border-draft bg-draft text-bg px-2 py-1 text-[9px] font-black uppercase hover:opacity-80 disabled:opacity-40">
                  A proceso
                </button>
              )}
            </>
          )}

          {o.status === 'en_proceso' && (
            <>
              <button type="button" disabled={!!busy}
                onClick={() => void onTransition(o, 'terminada')}
                className="border border-ok bg-ok text-bg px-2 py-1 text-[9px] font-black uppercase hover:opacity-80 disabled:opacity-40 flex items-center gap-1">
                <CheckCircle2 size={11} /> Terminada
              </button>
              <select
                defaultValue=""
                disabled={!!busy || activeTorneros.length === 0}
                onChange={(e) => { const v = e.target.value; if (v) void onTransition(o, 'en_proceso', v); e.currentTarget.value = ''; }}
                className="border border-line bg-surface-2 text-ink px-2 py-1 text-[9px] font-black uppercase disabled:opacity-40"
              >
                <option value="" disabled>Reasignar ▾</option>
                {activeTorneros.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name} {workload[t.name] ? `(${workload[t.name]} act)` : ''}
                  </option>
                ))}
              </select>
              <button type="button" disabled={!!busy}
                onClick={() => void onTransition(o, 'pendiente')}
                className="border border-line bg-surface-2 px-2 py-1 text-[9px] font-black uppercase text-ink-dim hover:text-ink disabled:opacity-40">
                Revertir
              </button>
            </>
          )}

          {o.status === 'terminada' && (
            <>
              <select
                defaultValue=""
                disabled={!!busy || activeTorneros.length === 0}
                onChange={(e) => { const v = e.target.value; if (v) void onTransition(o, 'entregada', v); e.currentTarget.value = ''; }}
                className="border border-accent bg-accent text-bg px-2 py-1 text-[9px] font-black uppercase disabled:opacity-40"
                title={activeTorneros.length === 0 ? 'Agrega torneros primero' : 'Entregar a Suprajit…'}
              >
                <option value="" disabled>{busy ?? 'Entregar a ▾'}</option>
                {activeTorneros.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <button type="button" disabled={!!busy}
                onClick={() => void onTransition(o, 'en_proceso', o.assignedToTornero ?? activeTorneros[0]?.name)}
                className="border border-line bg-surface-2 px-2 py-1 text-[9px] font-black uppercase text-ink-dim hover:text-ink disabled:opacity-40">
                Volver a proceso
              </button>
            </>
          )}

          {o.status === 'entregada' && (
            <button type="button" disabled={!!busy}
              onClick={() => void onTransition(o, 'pendiente')}
              className="border border-line bg-surface-2 px-2 py-1 text-[9px] font-black uppercase text-ink-dim hover:text-ink disabled:opacity-40">
              Revertir
            </button>
          )}

          <button type="button" onClick={() => void onArchive(o)} disabled={!!busy}
            className="text-ink-dim hover:text-ink text-[9px] font-black uppercase flex items-center gap-1 justify-center">
            <Archive size={10} /> {o.archived ? 'Desarchivar' : 'Archivar'}
          </button>
        </div>
      </div>
    </div>
  );
});
