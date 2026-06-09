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
  updateOrderStatus,
  updateDueDate,
  updateNotes,
  archiveWorkOrder,
  addTornero,
  setTorneroActive,
  updateAssignedTornero,
  updateSortIndex,
} from '../lib/firebase/workOrders';
import { useWorkOrdersContext } from '../contexts/WorkOrdersContext';
import { getDrawingById } from '../lib/firebase/toolcrib';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { openStampedPlanoOt } from '../lib/planoOt';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { resolveKanbanDrop } from '../lib/workOrders/kanbanDrop';

import { WorkOrdersSidebar } from './WorkOrders/WorkOrdersSidebar';

// ── helpers ─────────────────────────────────────────────────────────────────

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
type StatusFilter = 'todas' | WorkOrderStatus;
type ViewMode = 'board' | 'list' | 'torneros';

import { WorkOrderCard } from './WorkOrders/WorkOrderCard';
import { WorkOrdersBoard } from './WorkOrders/WorkOrdersBoard';
import { WorkOrdersList } from './WorkOrders/WorkOrdersList';
import {
  STATUS_LABELS,
  COLUMN_ACCENT,
  norm,
} from './WorkOrders/utils';

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

// ── componente principal ──────────────────────────────────────────────────────

export interface WorkOrdersPanelProps {
  /** Filtro de alerta inicial (cuando se entra desde "atención inmediata" de Inicio). */
  initialAlertFilter?: DueDateSeverity | null;
  /** Se invoca tras cualquier mutación que cambie contadores, para revalidar el resumen global. */
  onDataChanged?: () => void;
}

export function WorkOrdersPanel({ initialAlertFilter = null, onDataChanged }: WorkOrdersPanelProps = {}): ReactElement {
  // ── Fuente de datos: contexto compartido (onSnapshot, sin doble lectura) ────
  const {
    orders: ctxOrders,
    torneros: ctxTorneros,
    status: ctxStatus,
    reason: ctxReason,
    reloadTorneros,
  } = useWorkOrdersContext();

  // Estado local para mutaciones optimistas — se inicializa desde el contexto
  // y se sincroniza en tiempo real cada vez que onSnapshot actualiza el contexto.
  const [orders, setOrders] = useState<WorkOrder[]>(ctxOrders);
  const [torneros, setTorneros] = useState<Tornero[]>(ctxTorneros);

  // Convierte el estado del contexto al tipo local
  const status: LoadStatus =
    ctxStatus === 'idle'    ? 'idle'    :
    ctxStatus === 'loading' ? 'loading' :
    ctxStatus === 'ready'   ? 'ready'   :
    /* error */               'error';

  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    ctxReason === 'not-configured'
      ? 'Firebase no está configurado. Completa VITE_FIREBASE_* en .env.local.'
      : ctxReason === 'not-authenticated'
      ? 'Inicia sesión para ver y registrar órdenes.'
      : null,
  );

  // Sincroniza órdenes desde el contexto (onSnapshot = actualizaciones en tiempo real).
  // Las mutaciones optimistas se aplican sobre este estado; el onSnapshot siguiente
  // confirma o revierte con los datos autoritativos de Firestore.
  useEffect(() => {
    setOrders(ctxOrders);
  }, [ctxOrders]);

  useEffect(() => {
    setTorneros(ctxTorneros);
  }, [ctxTorneros]);

  useEffect(() => {
    if (ctxReason === 'not-configured') {
      setErrorMessage('Firebase no está configurado. Completa VITE_FIREBASE_* en .env.local.');
    } else if (ctxReason === 'not-authenticated') {
      setErrorMessage('Inicia sesión para ver y registrar órdenes.');
    } else if (ctxReason === 'error') {
      setErrorMessage('No fue posible cargar las órdenes. Revisa tu conexión.');
    }
  }, [ctxReason]);

  // "Refrescar" ahora recarga torneros (órdenes ya están al día via onSnapshot)
  const load = useCallback(async () => {
    await reloadTorneros();
  }, [reloadTorneros]);

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

  // --- Mejoras: Carga, Masivo y Reordenamiento ---
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [pendientesSortBy, setPendientesSortBy] = useState<'manual' | 'dueDate' | 'po'>('manual');

  const workload = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of orders) {
      if (o.status === 'en_proceso' && o.assignedToTornero) {
        counts[o.assignedToTornero] = (counts[o.assignedToTornero] || 0) + 1;
      }
    }
    return counts;
  }, [orders]);

  const setBusy = (id: string, label: string) => setRowBusy((p) => ({ ...p, [id]: label }));
  const clearBusy = (id: string) => setRowBusy((p) => { const n = { ...p }; delete n[id]; return n; });

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
      if (newStatus === 'entregada') return { ...o, deliveredToTornero: res.value.torneroName };
      if (newStatus === 'en_proceso') return { ...o, assignedToTornero: res.value.torneroName };
      return o;
    }));
    onDataChanged?.();
  }, [onDataChanged]);

  const handleAssignTornero = useCallback(async (orderId: string, torneroName: string) => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, assignedToTornero: torneroName } : o)));
    const res = await updateAssignedTornero(orderId, torneroName);
    if (res.ok === false) {
      setErrorMessage('No fue posible pre-asignar el tornero.');
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, assignedToTornero: null } : o)));
    } else {
      onDataChanged?.();
    }
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
    await reloadTorneros();
  }, [newTornero, reloadTorneros]);

  const handleToggleTornero = useCallback(async (t: Tornero) => {
    const res = await setTorneroActive(t.id, !t.active);
    if (res.ok === false) { setErrorMessage('No fue posible actualizar el tornero.'); return; }
    setTorneros((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: !t.active } : x)));
  }, []);

  // --- Handlers de Acciones Masivas ---
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkAssign = useCallback(async (torneroName: string) => {
    const ids = Array.from(selectedOrders);
    if (ids.length === 0) return;
    setOrders((prev) => prev.map((o) => (ids.includes(o.id) ? { ...o, assignedToTornero: torneroName } : o)));
    await Promise.all(ids.map((id) => updateAssignedTornero(id, torneroName)));
    onDataChanged?.();
  }, [selectedOrders, onDataChanged]);

  const handleBulkTransition = useCallback(async (newStatus: WorkOrderStatus) => {
    const ids = Array.from(selectedOrders);
    if (ids.length === 0) return;
    const toTransition = orders.filter((o) => ids.includes(o.id) && o.assignedToTornero);
    const skipped = ids.length - toTransition.length;
    if (skipped > 0) {
      setErrorMessage(`${skipped} orden(es) sin tornero asignado no fueron procesadas.`);
    }
    if (toTransition.length === 0) return;
    setOrders((prev) => prev.map((o) => (ids.includes(o.id) && o.assignedToTornero ? { ...o, status: newStatus } : o)));
    await Promise.all(toTransition.map((o) => updateOrderStatus(o.id, newStatus, o.assignedToTornero!)));
    setIsBulkMode(false);
    setSelectedOrders(new Set());
    onDataChanged?.();
  }, [orders, selectedOrders, onDataChanged]);

  // --- Handler de Drag & Drop (@hello-pangea/dnd) ---
  const handleKanbanDrop = useCallback((result: DropResult) => {
    const drop = resolveKanbanDrop(result, orders);

    if (drop.type === 'noop') {
      if (drop.reason === 'tornero-required') {
        setErrorMessage('Asigna un tornero a la orden antes de moverla a esta etapa.');
      }
      return;
    }

    if (drop.type === 'reorder') {
      const pendingOrders = filtered
        .filter((o) => o.status === 'pendiente')
        .sort((a, b) => (a.sortIndex ?? Infinity) - (b.sortIndex ?? Infinity))
        .map((o, i) => ({ ...o, _idx: o.sortIndex ?? i }));

      const sourceItem = pendingOrders[drop.sourceIndex];
      const insertAfter = drop.sourceIndex < drop.destinationIndex;
      const prevItem = insertAfter
        ? pendingOrders[drop.destinationIndex]
        : pendingOrders[drop.destinationIndex - 1];
      const nextItem = insertAfter
        ? pendingOrders[drop.destinationIndex + 1]
        : pendingOrders[drop.destinationIndex];

      if (!sourceItem) return;
      const prevIdx = prevItem?._idx ?? (pendingOrders[0]?._idx ?? 0) - 1;
      const nextIdx = nextItem?._idx ?? (pendingOrders[pendingOrders.length - 1]?._idx ?? 0) + 1;
      const newIndex = prevIdx + (nextIdx - prevIdx) / 2;

      setOrders((prev) => prev.map((o) => (o.id === drop.orderId ? { ...o, sortIndex: newIndex } : o)));
      void updateSortIndex(drop.orderId, newIndex);
      onDataChanged?.();
      return;
    }

    // type === 'transition'
    const order = orders.find((o) => o.id === drop.orderId);
    if (!order) return;
    void handleTransition(order, drop.newStatus, drop.torneroName ?? undefined);
  }, [orders, filtered, handleTransition, onDataChanged]);

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
            {([['board', LayoutGrid, 'Tablero'], ['list', List, 'Lista'], ['torneros', Users, 'Torneros']] as const).map(([mode, Icon, label]) => (
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
          <WorkOrdersBoard
            filteredOrders={filtered}
            pendientesSortBy={pendientesSortBy}
            setPendientesSortBy={setPendientesSortBy}
            isBulkMode={isBulkMode}
            setIsBulkMode={setIsBulkMode}
            selectedOrders={selectedOrders}
            setSelectedOrders={setSelectedOrders}
            activeTorneros={activeTorneros}
            workload={workload}
            rowBusy={rowBusy}
            editingDueDateId={editingDueDateId}
            draftDueDate={draftDueDate}
            editingNotesId={editingNotesId}
            draftNotes={draftNotes}
            onDragEnd={handleKanbanDrop}
            onBulkAssign={handleBulkAssign}
            onBulkTransition={handleBulkTransition}
            onTransition={handleTransition}
            onAssignTornero={handleAssignTornero}
            onArchive={handleArchive}
            onPrint={handlePrint}
            onSaveDueDate={handleSaveDueDate}
            onSaveNotes={handleSaveNotes}
            onEditDueDate={setEditingDueDateId}
            onEditNotes={setEditingNotesId}
            onDraftDueDateChange={setDraftDueDate}
            onDraftNotesChange={setDraftNotes}
            onToggleSelect={handleToggleSelect}
          />
        )}

        {/* ── Lista ── */}
        {status === 'ready' && filtered.length > 0 && viewMode === 'list' && (
          <WorkOrdersList
            orders={listVisible}
            rowBusy={rowBusy}
            editingDueDateId={editingDueDateId}
            draftDueDate={draftDueDate}
            editingNotesId={editingNotesId}
            draftNotes={draftNotes}
            activeTorneros={activeTorneros}
            workload={workload}
            onTransition={handleTransition}
            onAssignTornero={handleAssignTornero}
            onArchive={handleArchive}
            onPrint={handlePrint}
            onSaveDueDate={handleSaveDueDate}
            onSaveNotes={handleSaveNotes}
            onEditDueDate={setEditingDueDateId}
            onEditNotes={setEditingNotesId}
            onDraftDueDateChange={setDraftDueDate}
            onDraftNotesChange={setDraftNotes}
          />
        )}

        {/* ── Tab Torneros ── */}
        {status === 'ready' && viewMode === 'torneros' && (
          <div className="max-w-2xl mx-auto py-8">
            <section className="bg-surface border-2 border-line p-6">
              <header className="flex items-center gap-3 mb-6">
                <div className="p-3 border-2 border-line bg-accent text-bg">
                  <Users size={24} />
                </div>
                <div>
                  <h2 className="font-display font-black text-2xl uppercase tracking-tighter">Control de Torneros</h2>
                  <p className="font-mono text-[11px] text-ink-dim">{activeTorneros.length} torneros activos</p>
                </div>
              </header>

              <div className="flex items-center gap-2 mb-6">
                <input
                  value={newTornero} onChange={(e) => setNewTornero(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleAddTornero(); }}
                  placeholder="Nombre del tornero"
                  className="grow border-2 border-line bg-surface-2 text-ink px-3 py-2 text-[12px] font-mono outline-none placeholder:text-ink-dim/70 focus:border-accent"
                />
                <button type="button" onClick={() => void handleAddTornero()}
                  className="border-2 border-accent bg-accent text-bg px-4 py-2 text-[11px] font-black uppercase flex items-center gap-1.5 hover:bg-accent/80 transition-colors shadow-hard active:translate-x-0.5 active:translate-y-0.5">
                  <Plus size={14} /> Agregar Tornero
                </button>
              </div>

              <div className="space-y-3">
                {torneros.map((t) => (
                  <div key={t.id} className={`flex items-center justify-between p-3 border-2 transition-colors ${
                    t.active ? 'border-line bg-surface' : 'border-dashed border-line bg-surface-2 opacity-60'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${t.active ? 'bg-ok' : 'bg-ink-dim'}`} />
                      <span className={`font-black text-[13px] uppercase tracking-wider ${!t.active && 'line-through text-ink-dim'}`}>
                        {t.name}
                      </span>
                    </div>
                    <button type="button" onClick={() => void handleToggleTornero(t)}
                      className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border-2 transition-colors ${
                        t.active ? 'border-line text-ink-dim hover:text-ink hover:border-ink' : 'border-ink bg-ink text-bg'
                      }`}>
                      {t.active ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </div>
                ))}
                {torneros.length === 0 && (
                  <div className="text-center py-10 border-2 border-dashed border-line text-ink-dim">
                    <p className="font-mono text-[12px] mb-1">Aún no hay torneros registrados.</p>
                    <p className="text-[10px] uppercase">Agrega el primero usando el campo de arriba.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      <WorkOrdersSidebar
        showPanel={showPanel}
        setShowPanel={setShowPanel}
        metrics={metrics}
        activeTorneros={activeTorneros}
        torneros={torneros}
        newTornero={newTornero}
        setNewTornero={setNewTornero}
        onAddTornero={handleAddTornero}
        onToggleTornero={handleToggleTornero}
      />
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

