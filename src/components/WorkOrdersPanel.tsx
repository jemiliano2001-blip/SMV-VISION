/**
 * WorkOrdersPanel — Control de Producción Suprajit (v3)
 *
 * Flujo de 4 etapas:
 *   pendiente → en_proceso (plano dado al tornero) → terminada → entregada
 *
 * Layout: tablero (columna por estado) o lista. Barra de alertas como filtros,
 * búsqueda/filtros, y un cajón lateral con métricas + gestión de torneros.
 * Toda la lógica de severidad/métricas vive en `lib/workOrders/metrics`.
 */

import React, {
  useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode,
} from 'react';
import {
  AlertCircle, CheckCircle2, Clock, Loader2, Printer, RefreshCcw,
  Search, Plus, Archive, BarChart2, Users, X, LayoutGrid, List, SlidersHorizontal,
} from 'lucide-react';

import type { WorkOrder, WorkOrderStatus, Tornero } from '../types';
import {
  getDueDateSeverity, dueDaysLabel, calcMetrics, type DueDateSeverity,
} from '../lib/workOrders/metrics';
import {
  listWorkOrders,
  updateOrderStatus,
  updateDueDate,
  updateNotes,
  archiveWorkOrder,
  listTorneros,
  addTornero,
  setTorneroActive,
} from '../lib/firebase/workOrders';
import { getDrawingById } from '../lib/firebase/toolcrib';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { openStampedPlanoOt } from '../lib/planoOt';

// ── helpers ─────────────────────────────────────────────────────────────────

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
type StatusFilter = 'todas' | WorkOrderStatus;
type ViewMode = 'board' | 'list';

const SEVERITY_CLASSES: Record<DueDateSeverity, string> = {
  overdue:  'bg-danger/20 text-danger border-danger',
  critical: 'bg-accent/20 text-accent border-accent',
  warning:  'bg-warn/20 text-warn border-warn',
  ok:       'bg-ok/15 text-ok border-ok/60',
  done:     'bg-surface-2 text-ink-dim border-line',
  unknown:  'bg-surface-2 text-ink-dim border-line',
};

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  pendiente:  'PENDIENTE',
  en_proceso: 'EN PROCESO',
  terminada:  'TERMINADA',
  entregada:  'ENTREGADA',
};
const STATUS_CHIP_CLASSES: Record<WorkOrderStatus, string> = {
  pendiente:  'bg-surface-2 text-ink-dim border border-line',
  en_proceso: 'bg-draft/20 text-draft border border-draft',
  terminada:  'bg-ok/20 text-ok border border-ok',
  entregada:  'bg-ink text-bg',
};
const COLUMN_ACCENT: Record<WorkOrderStatus, string> = {
  pendiente:  'border-t-ink-dim',
  en_proceso: 'border-t-draft',
  terminada:  'border-t-ok',
  entregada:  'border-t-ink',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}
function fmtDateOnly(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-MX');
}
/**
 * Formatea una fecha de SOLO-FECHA (`YYYY-MM-DD`, ej. dueDate) sin desfase de
 * huso. `new Date("2025-06-15")` se interpreta como medianoche UTC y en MX
 * (UTC-6) se mostraría como el 14; por eso parseamos los componentes y los
 * tratamos como fecha local.
 */
function fmtCalendarDate(iso: string | null): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return fmtDateOnly(iso);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es-MX');
}
function oneLine(value: string): string {
  return (value ?? '').replace(/[\r\n]+/g, ' / ').replace(/\s+/g, ' ').trim();
}
function norm(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ── OrderCard (module scope + React.memo to prevent re-creation on render) ────

function applyOptimisticTransition(
  orders: WorkOrder[],
  orderId: string,
  newStatus: WorkOrderStatus,
  torneroName?: string,
): WorkOrder[] {
  const now = new Date().toISOString();
  return orders.map((o) => {
    if (o.id !== orderId) return o;
    const base = { ...o, status: newStatus, updatedAtUTC: now };
    if (newStatus === 'en_proceso') {
      return { ...base, assignedToTornero: torneroName ?? null, assignedAtUTC: now };
    }
    if (newStatus === 'terminada') {
      return { ...base, finishedAtUTC: now };
    }
    if (newStatus === 'entregada') {
      return { ...base, deliveredToTornero: torneroName ?? null, deliveredAtUTC: now };
    }
    if (newStatus === 'pendiente') {
      return {
        ...base,
        assignedToTornero: null, assignedAtUTC: null,
        finishedAtUTC: null, deliveredToTornero: null, deliveredAtUTC: null,
      };
    }
    return base;
  });
}

interface OrderCardProps {
  order: WorkOrder;
  busy: string | undefined;
  editingDueDateId: string | null;
  draftDueDate: string;
  editingNotesId: string | null;
  draftNotes: string;
  activeTorneros: Tornero[];
  onTransition: (order: WorkOrder, status: WorkOrderStatus, tornero?: string) => void;
  onArchive: (order: WorkOrder) => void;
  onPrint: (order: WorkOrder) => void;
  onSaveDueDate: (id: string, val: string) => void;
  onSaveNotes: (id: string) => void;
  onEditDueDate: (id: string | null) => void;
  onEditNotes: (id: string | null) => void;
  onDraftDueDateChange: (val: string) => void;
  onDraftNotesChange: (val: string) => void;
}

const OrderCard = React.memo(function OrderCard({
  order: o,
  busy,
  editingDueDateId,
  draftDueDate,
  editingNotesId,
  draftNotes,
  activeTorneros,
  onTransition,
  onArchive,
  onPrint,
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
      className={`relative border-2 border-line bg-surface p-3 ${o.prioridad === 'URGENTE' ? 'border-l-accent border-l-4' : ''} ${o.archived ? 'opacity-50' : ''}`}
    >
      <div className="flex flex-wrap items-start gap-3">
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
            <select
              defaultValue=""
              disabled={!!busy || activeTorneros.length === 0}
              onChange={(e) => { const v = e.target.value; if (v) void onTransition(o, 'en_proceso', v); e.currentTarget.value = ''; }}
              className="border border-draft bg-draft text-bg px-2 py-1 text-[9px] font-black uppercase disabled:opacity-40"
              title={activeTorneros.length === 0 ? 'Agrega torneros primero' : 'Asignar a tornero'}
            >
              <option value="" disabled>{busy ?? 'Asignar a ▾'}</option>
              {activeTorneros.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
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
                {activeTorneros.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
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

// ── componente principal ──────────────────────────────────────────────────────

export interface WorkOrdersPanelProps {
  /** Filtro de alerta inicial (cuando se entra desde "atención inmediata" de Inicio). */
  initialAlertFilter?: DueDateSeverity | null;
  /** Se invoca tras cualquier mutación que cambie contadores, para revalidar el resumen global. */
  onDataChanged?: () => void;
}

export function WorkOrdersPanel({ initialAlertFilter = null, onDataChanged }: WorkOrdersPanelProps = {}): ReactElement {
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [torneros, setTorneros] = useState<Tornero[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas');
  const [showArchived, setShowArchived] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [alertFilter, setAlertFilter] = useState<DueDateSeverity | null>(initialAlertFilter);
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [showPanel, setShowPanel] = useState(false);
  const [rowBusy, setRowBusy] = useState<Record<string, string>>({});
  const [newTornero, setNewTornero] = useState('');
  // Track which order is showing the notes editor
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState('');
  // Track which order is showing the due-date editor
  const [editingDueDateId, setEditingDueDateId] = useState<string | null>(null);
  const [draftDueDate, setDraftDueDate] = useState('');

  const setBusy = (id: string, label: string) => setRowBusy((p) => ({ ...p, [id]: label }));
  const clearBusy = (id: string) => setRowBusy((p) => { const n = { ...p }; delete n[id]; return n; });

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    const [woRes, tRes] = await Promise.all([listWorkOrders(), listTorneros()]);
    if (woRes.ok === false) {
      setStatus('error');
      setErrorMessage(
        woRes.reason === 'not-configured'
          ? 'Firebase no está configurado. Completa VITE_FIREBASE_* en .env.local.'
          : woRes.reason === 'not-authenticated'
            ? 'Inicia sesión para ver y registrar órdenes.'
            : 'No fue posible cargar las órdenes. Revisa tu conexión.',
      );
      return;
    }
    setOrders(woRes.value);
    if (tRes.ok) setTorneros(tRes.value);
    setStatus('ready');
  }, []);

  useEffect(() => {
    if (status === 'idle') void load();
  }, [load, status]);

  const activeTorneros = useMemo(
    () => torneros.filter((t) => t.active).sort((a, b) => a.name.localeCompare(b.name)),
    [torneros],
  );

  // ── alertas ────────────────────────────────────────────────────────────────

  const alertCounts = useMemo(() => {
    const active = orders.filter((o) => !o.archived && o.status !== 'entregada');
    return {
      overdue:  active.filter((o) => getDueDateSeverity(o.dueDate, o.status) === 'overdue').length,
      critical: active.filter((o) => getDueDateSeverity(o.dueDate, o.status) === 'critical').length,
      warning:  active.filter((o) => getDueDateSeverity(o.dueDate, o.status) === 'warning').length,
    };
  }, [orders]);

  const pendientes = useMemo(
    () => orders.filter((o) => !o.archived && o.status === 'pendiente').length,
    [orders],
  );

  // ── filtrado y ordenación (sin statusFilter — eso solo aplica a la lista) ────

  const sortOrders = (arr: WorkOrder[]): WorkOrder[] =>
    [...arr].sort((a, b) => {
      if (a.prioridad !== b.prioridad) return a.prioridad === 'URGENTE' ? -1 : 1;
      const sevOrder: DueDateSeverity[] = ['overdue', 'critical', 'warning', 'unknown', 'ok', 'done'];
      const sa = sevOrder.indexOf(getDueDateSeverity(a.dueDate, a.status));
      const sb = sevOrder.indexOf(getDueDateSeverity(b.dueDate, b.status));
      if (sa !== sb) return sa - sb;
      return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
    });

  const filtered = useMemo(() => {
    const term = norm(search);
    return sortOrders(
      orders
        .filter((o) => (showArchived ? true : !o.archived))
        .filter((o) => (urgentOnly ? o.prioridad === 'URGENTE' : true))
        .filter((o) => (!alertFilter ? true : getDueDateSeverity(o.dueDate, o.status) === alertFilter))
        .filter((o) => {
          if (term.length === 0) return true;
          const hay = norm(
            `${o.pieza} ${o.numeroParte} ${o.soNumber} ${o.poNumber} ${o.assignedToTornero ?? ''} ${o.deliveredToTornero ?? ''}`,
          );
          return hay.includes(term);
        }),
    );
  }, [orders, search, showArchived, urgentOnly, alertFilter]);

  const listVisible = useMemo(
    () => (statusFilter === 'todas' ? filtered : filtered.filter((o) => o.status === statusFilter)),
    [filtered, statusFilter],
  );

  const metrics = useMemo(() => calcMetrics(orders), [orders]);

  // ── handlers de estado ────────────────────────────────────────────────────

  const handleTransition = useCallback(async (
    order: WorkOrder,
    newStatus: WorkOrderStatus,
    torneroName?: string,
  ) => {
    // 1. Snapshot for rollback
    const snapshot = order;

    // 2. Optimistic update — UI responds instantly
    setOrders((prev) => applyOptimisticTransition(prev, order.id, newStatus, torneroName));

    // 3. Firebase write (background)
    const res = await updateOrderStatus(order.id, newStatus, torneroName);

    if (res.ok === false) {
      // 4a. Revert on failure
      setOrders((prev) => prev.map((o) => (o.id === order.id ? snapshot : o)));
      setErrorMessage(
        res.reason === 'not-authenticated'
          ? 'Inicia sesión para actualizar el estado.'
          : 'No fue posible actualizar el estado. Reintenta.',
      );
      return;
    }

    // 4b. Merge server-authoritative fields (tornero name confirmed by Firebase)
    setOrders((prev) => prev.map((o) => {
      if (o.id !== order.id) return o;
      if (newStatus === 'entregada') return { ...o, deliveredToTornero: res.value.deliveredToTornero };
      if (newStatus === 'en_proceso') return { ...o, assignedToTornero: res.value.deliveredToTornero };
      return o;
    }));
    onDataChanged?.();
  }, [onDataChanged]);

  const handleArchive = useCallback(async (order: WorkOrder) => {
    setBusy(order.id, 'Archivando');
    const res = await archiveWorkOrder(order.id, !order.archived);
    clearBusy(order.id);
    if (res.ok === false) { setErrorMessage('No fue posible archivar.'); return; }
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, archived: !order.archived } : o)));
    onDataChanged?.();
  }, [onDataChanged]);

  const handlePrint = useCallback(async (order: WorkOrder) => {
    if (!order.matchedDrawingId) {
      setErrorMessage(`"${order.pieza}" no tiene plano emparejado en el catálogo.`);
      return;
    }
    setBusy(order.id, 'Abriendo plano');
    try {
      const drawing = await getDrawingById(order.matchedDrawingId);
      if (drawing.ok === false || !drawing.value.pdfUrl) {
        setErrorMessage('El plano emparejado no tiene PDF accesible.');
        return;
      }
      const dataUrl = await fetchPdfAsDataUrl(drawing.value.pdfUrl);
      await openStampedPlanoOt(dataUrl, {
        soNumber: order.soNumber, cantidad: order.cantidad, fecha: order.otDate,
      });
    } catch (e) {
      console.warn('[smv-vision][work-orders] print falló', e);
      setErrorMessage('No fue posible abrir el plano-OT.');
    } finally {
      clearBusy(order.id);
    }
  }, []);

  const handleSaveDueDate = useCallback(async (orderId: string, value: string) => {
    const dateVal = value || null;
    const res = await updateDueDate(orderId, dateVal);
    setEditingDueDateId(null);
    if (res.ok === false) { setErrorMessage('No fue posible guardar la fecha límite.'); return; }
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, dueDate: dateVal } : o)));
    onDataChanged?.();
  }, [onDataChanged]);

  const handleSaveNotes = useCallback(async (orderId: string) => {
    const res = await updateNotes(orderId, draftNotes);
    setEditingNotesId(null);
    if (res.ok === false) { setErrorMessage('No fue posible guardar las notas.'); return; }
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, notes: draftNotes } : o)));
  }, [draftNotes]);

  const handleAddTornero = useCallback(async () => {
    const name = newTornero.trim();
    if (!name) return;
    const res = await addTornero(name);
    if (res.ok === false) {
      setErrorMessage(
        res.reason === 'not-authenticated'
          ? 'Inicia sesión para agregar torneros.'
          : 'No fue posible agregar el tornero.',
      );
      return;
    }
    setNewTornero('');
    const t = await listTorneros();
    if (t.ok) setTorneros(t.value);
  }, [newTornero]);

  const handleToggleTornero = useCallback(async (t: Tornero) => {
    const res = await setTorneroActive(t.id, !t.active);
    if (res.ok === false) { setErrorMessage('No fue posible actualizar el tornero.'); return; }
    setTorneros((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: !t.active } : x)));
  }, []);

  // ── render ────────────────────────────────────────────────────────────────

  const totalAlerts = alertCounts.overdue + alertCounts.critical + alertCounts.warning;

  return (
    <div className="min-h-full bp-grid-lg">
      {/* ── Sub-header pegajoso ── */}
      <div className="sticky top-0 z-20 bg-bg/95 backdrop-blur border-b-2 border-line px-6 lg:px-8 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-0.5">Producción Suprajit</p>
            <h1 className="font-display font-black text-3xl lg:text-4xl uppercase italic tracking-[-1.5px] leading-none flex items-center gap-3">
              Control de Órdenes
              <span className="bg-accent text-bg px-2 py-0.5 text-[13px] not-italic align-middle">{pendientes} pend.</span>
            </h1>
          </div>

          {/* Toggle de vista */}
          <div className="flex border-2 border-line">
            {([['board', LayoutGrid, 'Tablero'], ['list', List, 'Lista']] as const).map(([mode, Icon, label]) => (
              <button
                key={mode} type="button" onClick={() => setViewMode(mode)}
                title={label} aria-pressed={viewMode === mode}
                className={`px-3 py-2 text-[10px] font-black uppercase flex items-center gap-1.5 transition-colors ${
                  viewMode === mode ? 'bg-ink text-bg' : 'bg-surface text-ink-dim hover:text-ink'
                }`}
              >
                <Icon size={13} /> <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          <button
            type="button" onClick={() => setShowPanel(true)}
            className="border-2 border-line bg-surface px-3 py-2 text-[10px] font-black uppercase text-ink hover:border-accent hover:text-accent transition-colors flex items-center gap-1.5"
          >
            <SlidersHorizontal size={13} /> <span className="hidden sm:inline">Panel</span>
          </button>

          <button
            type="button" onClick={() => void load()} disabled={status === 'loading'}
            className="border-2 border-line bg-surface px-3 py-2 text-[10px] font-black uppercase text-ink hover:border-accent hover:text-accent disabled:opacity-40 flex items-center gap-1.5 transition-colors"
          >
            {status === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
            <span className="hidden sm:inline">Refrescar</span>
          </button>
        </div>
      </div>

      <div className="px-6 lg:px-8 py-5 space-y-4">
        {/* ── Barra de alertas ── */}
        {totalAlerts > 0 && (
          <div className="flex flex-wrap gap-2">
            {alertCounts.overdue > 0 && (
              <AlertChip active={alertFilter === 'overdue'} tone="danger" icon={AlertCircle}
                onClick={() => setAlertFilter(alertFilter === 'overdue' ? null : 'overdue')}>
                {alertCounts.overdue} vencida{alertCounts.overdue !== 1 ? 's' : ''}
              </AlertChip>
            )}
            {alertCounts.critical > 0 && (
              <AlertChip active={alertFilter === 'critical'} tone="accent" icon={Clock}
                onClick={() => setAlertFilter(alertFilter === 'critical' ? null : 'critical')}>
                {alertCounts.critical} crítica{alertCounts.critical !== 1 ? 's' : ''} (≤3d)
              </AlertChip>
            )}
            {alertCounts.warning > 0 && (
              <AlertChip active={alertFilter === 'warning'} tone="warn" icon={Clock}
                onClick={() => setAlertFilter(alertFilter === 'warning' ? null : 'warning')}>
                {alertCounts.warning} próxima{alertCounts.warning !== 1 ? 's' : ''} (≤7d)
              </AlertChip>
            )}
            {alertFilter && (
              <button type="button" onClick={() => setAlertFilter(null)}
                className="px-3 py-1.5 text-[11px] font-black uppercase border-2 border-line text-ink-dim hover:border-ink hover:text-ink transition-colors">
                Ver todas
              </button>
            )}
          </div>
        )}

        {/* ── Filtros + búsqueda ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 border-2 border-line px-2 py-1.5 bg-surface">
            <Search size={14} className="text-ink-dim" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pieza, parte, SO, tornero…"
              className="bg-transparent outline-none text-[12px] font-mono text-ink w-56 placeholder:text-ink-dim/70"
            />
          </div>
          {viewMode === 'list' && (['todas', 'pendiente', 'en_proceso', 'terminada', 'entregada'] as const).map((f) => (
            <button
              key={f} type="button" onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border-2 border-line transition-colors ${
                statusFilter === f ? 'bg-ink text-bg border-ink' : 'bg-surface text-ink-dim hover:text-ink'
              }`}
            >
              {f === 'todas' ? 'Todas' : STATUS_LABELS[f]}
            </button>
          ))}
          <label className="ml-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider cursor-pointer text-ink-dim hover:text-ink">
            <input type="checkbox" checked={urgentOnly} onChange={(e) => setUrgentOnly(e.target.checked)} className="accent-accent" />
            Solo urgentes
          </label>
          <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider cursor-pointer text-ink-dim hover:text-ink">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-accent" />
            Archivadas
          </label>
        </div>

        {/* ── Error ── */}
        {errorMessage && (
          <div className="flex items-start gap-2 border-2 border-danger bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger" role="alert">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="grow">{errorMessage}</span>
            <button type="button" onClick={() => setErrorMessage(null)} className="shrink-0 text-danger/60 hover:text-danger text-xs">✕</button>
          </div>
        )}

        {/* ── Estados de carga / vacío ── */}
        {status === 'loading' && (
          <div className="text-[12px] font-mono text-ink-dim flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Cargando órdenes…
          </div>
        )}
        {status === 'ready' && filtered.length === 0 && (
          <div className="text-[12px] font-mono text-ink-dim border-2 border-dashed border-line p-8 text-center">
            No hay órdenes que coincidan. Sube una PO en "Generar Reporte" para empezar.
          </div>
        )}

        {/* ── Tablero ── */}
        {status === 'ready' && filtered.length > 0 && viewMode === 'board' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {(['pendiente', 'en_proceso', 'terminada', 'entregada'] as const).map((col) => {
              const cards = filtered.filter((o) => o.status === col);
              return (
                <section key={col} className={`bg-surface/40 border-2 border-line border-t-4 ${COLUMN_ACCENT[col]} flex flex-col min-h-[120px]`}>
                  <header className="flex items-center justify-between px-3 py-2 border-b-2 border-line sticky top-0">
                    <span className="font-display font-black text-[12px] uppercase tracking-wider">{STATUS_LABELS[col]}</span>
                    <span className="font-mono text-[11px] text-ink-dim">{cards.length}</span>
                  </header>
                  <div className="p-2 space-y-2 grow">
                    {cards.length === 0
                      ? <p className="text-[10px] font-mono text-ink-dim/60 text-center py-6">—</p>
                      : cards.map((o) => (
                        <OrderCard
                          key={o.id}
                          order={o}
                          busy={rowBusy[o.id]}
                          editingDueDateId={editingDueDateId}
                          draftDueDate={draftDueDate}
                          editingNotesId={editingNotesId}
                          draftNotes={draftNotes}
                          activeTorneros={activeTorneros}
                          onTransition={handleTransition}
                          onArchive={handleArchive}
                          onPrint={handlePrint}
                          onSaveDueDate={handleSaveDueDate}
                          onSaveNotes={handleSaveNotes}
                          onEditDueDate={setEditingDueDateId}
                          onEditNotes={setEditingNotesId}
                          onDraftDueDateChange={setDraftDueDate}
                          onDraftNotesChange={setDraftNotes}
                        />
                      ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* ── Lista ── */}
        {status === 'ready' && filtered.length > 0 && viewMode === 'list' && (
          <div className="space-y-2">
            {listVisible.length === 0
              ? <p className="text-[11px] font-mono text-ink-dim py-4">Ninguna orden en este estado.</p>
              : listVisible.map((o) => (
                <OrderCard
                  key={o.id}
                  order={o}
                  busy={rowBusy[o.id]}
                  editingDueDateId={editingDueDateId}
                  draftDueDate={draftDueDate}
                  editingNotesId={editingNotesId}
                  draftNotes={draftNotes}
                  activeTorneros={activeTorneros}
                  onTransition={handleTransition}
                  onArchive={handleArchive}
                  onPrint={handlePrint}
                  onSaveDueDate={handleSaveDueDate}
                  onSaveNotes={handleSaveNotes}
                  onEditDueDate={setEditingDueDateId}
                  onEditNotes={setEditingNotesId}
                  onDraftDueDateChange={setDraftDueDate}
                  onDraftNotesChange={setDraftNotes}
                />
              ))}
          </div>
        )}
      </div>

      {/* ── Cajón lateral: métricas + torneros ── */}
      {showPanel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowPanel(false)} aria-hidden />
          <aside
            className="fixed inset-y-0 right-0 z-50 w-[360px] max-w-[88vw] bg-surface border-l-2 border-line flex flex-col"
            role="dialog" aria-label="Panel de métricas y torneros"
          >
            <header className="flex items-center justify-between px-4 py-3 border-b-2 border-line">
              <h2 className="font-display font-black text-[15px] uppercase tracking-wide">Panel</h2>
              <button type="button" onClick={() => setShowPanel(false)}
                className="p-1.5 text-ink-dim hover:text-accent transition-colors" aria-label="Cerrar panel">
                <X size={18} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Métricas */}
              <section>
                <h3 className="font-mono text-[10px] uppercase tracking-[2px] text-ink-dim mb-3 flex items-center gap-2">
                  <BarChart2 size={13} className="text-accent" /> Métricas de producción
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Ciclo promedio" value={metrics.avgCycleDays !== null ? `${metrics.avgCycleDays}d` : '—'} tone="text-ink" />
                  <Metric label="A tiempo" value={metrics.onTimePct !== null ? `${metrics.onTimePct}%` : '—'} tone="text-ok" />
                  <Metric label="Con retraso" value={metrics.latePct !== null ? `${metrics.latePct}%` : '—'} tone="text-danger" />
                  <Metric label="En proceso hoy" value={String(metrics.inProgressCount)} tone="text-draft" />
                </div>
                <p className="text-[9px] font-mono text-ink-dim/70 mt-3 leading-snug">
                  Basado en {metrics.deliveredCount} órdenes entregadas con fecha registrada. Las órdenes sin dueDate no cuentan en % a tiempo.
                </p>
              </section>

              {/* Torneros */}
              <section>
                <h3 className="font-mono text-[10px] uppercase tracking-[2px] text-ink-dim mb-3 flex items-center gap-2">
                  <Users size={13} className="text-accent" /> Torneros ({activeTorneros.length} activos)
                </h3>
                <div className="flex items-center gap-2 mb-3">
                  <input
                    value={newTornero} onChange={(e) => setNewTornero(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleAddTornero(); }}
                    placeholder="Nombre del tornero"
                    className="grow border border-line bg-surface-2 text-ink px-2 py-1.5 text-[12px] font-mono outline-none placeholder:text-ink-dim/70"
                  />
                  <button type="button" onClick={() => void handleAddTornero()}
                    className="border-2 border-accent bg-accent text-bg px-3 py-1.5 text-[10px] font-black uppercase flex items-center gap-1 hover:bg-accent/80 transition-colors">
                    <Plus size={12} /> Agregar
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {torneros.map((t) => (
                    <button key={t.id} type="button" onClick={() => void handleToggleTornero(t)}
                      className={`px-2 py-1 text-[10px] font-black uppercase tracking-wider border-2 transition-colors ${
                        t.active ? 'bg-ink text-bg border-ink' : 'bg-surface text-ink-dim border-line line-through'
                      }`} title={t.active ? 'Click para desactivar' : 'Click para activar'}>
                      {t.name}
                    </button>
                  ))}
                  {torneros.length === 0 && (
                    <span className="text-[10px] font-mono text-ink-dim">Aún no hay torneros. Agrega el primero.</span>
                  )}
                </div>
              </section>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

// ── subcomponentes de presentación ────────────────────────────────────────────

function AlertChip({
  active, tone, icon: Icon, onClick, children,
}: {
  active: boolean;
  tone: 'danger' | 'accent' | 'warn';
  icon: typeof Clock;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  const tones: Record<string, { on: string; off: string }> = {
    danger: { on: 'bg-danger text-white border-danger', off: 'bg-danger/10 text-danger border-danger/60 hover:bg-danger/20' },
    accent: { on: 'bg-accent text-bg border-accent', off: 'bg-accent/10 text-accent border-accent/60 hover:bg-accent/20' },
    warn:   { on: 'bg-warn text-black border-warn', off: 'bg-warn/10 text-warn border-warn/60 hover:bg-warn/20' },
  };
  const t = tones[tone];
  return (
    <button
      type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase border-2 transition-colors ${active ? t.on : t.off}`}
    >
      <Icon size={12} />
      {children}
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }): ReactElement {
  return (
    <div className="border border-line bg-surface-2 p-2.5">
      <p className="text-[9px] font-mono uppercase tracking-wider text-ink-dim mb-1">{label}</p>
      <p className={`font-display font-black text-2xl italic leading-none ${tone}`}>{value}</p>
    </div>
  );
}
