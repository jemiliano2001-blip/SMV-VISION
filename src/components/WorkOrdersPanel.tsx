/**
 * WorkOrdersPanel — Control de Producción Suprajit (v2)
 *
 * Nuevo flujo de 4 etapas:
 *   pendiente → en_proceso (plano dado al tornero) → terminada → entregada
 *
 * Dashboard:
 *   • Barra de alertas: vencidas / críticas (≤3d) / advertencia (≤7d)
 *   • Filtros por estado, urgentes, archivadas, búsqueda
 *   • Tarjetas con dueDate coloreada, asignación de tornero y notas
 *   • Panel de métricas colapsable: ciclo promedio, % a tiempo
 *   • Gestión de torneros (igual que antes)
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactElement,
} from 'react';
import {
  AlertCircle, CheckCircle2, Clock, Loader2, Printer, RefreshCcw,
  Search, Plus, Archive, ChevronDown, ChevronUp, BarChart2,
} from 'lucide-react';

import type { WorkOrder, WorkOrderStatus, Tornero } from '../types';
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
type DueDateSeverity = 'overdue' | 'critical' | 'warning' | 'ok' | 'done' | 'unknown';

function getDueDateSeverity(dueDate: string | null, status: WorkOrderStatus): DueDateSeverity {
  if (status === 'entregada') return 'done';
  if (!dueDate) return 'unknown';
  const days = Math.floor((new Date(dueDate).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days <= 3) return 'critical';
  if (days <= 7) return 'warning';
  return 'ok';
}

const SEVERITY_CLASSES: Record<DueDateSeverity, string> = {
  overdue:  'bg-red-600 text-white border-red-600',
  critical: 'bg-orange-500 text-white border-orange-500',
  warning:  'bg-yellow-400 text-black border-yellow-400',
  ok:       'bg-green-100 text-green-800 border-green-300',
  done:     'bg-gray-100 text-gray-500 border-gray-200',
  unknown:  'bg-gray-100 text-gray-400 border-gray-200',
};

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  pendiente:  'PENDIENTE',
  en_proceso: 'EN PROCESO',
  terminada:  'TERMINADA',
  entregada:  'ENTREGADA',
};
const STATUS_CHIP_CLASSES: Record<WorkOrderStatus, string> = {
  pendiente:  'bg-gray-200 text-gray-700',
  en_proceso: 'bg-blue-600 text-white',
  terminada:  'bg-green-600 text-white',
  entregada:  'bg-black text-white',
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
function oneLine(value: string): string {
  return (value ?? '').replace(/[\r\n]+/g, ' / ').replace(/\s+/g, ' ').trim();
}
function norm(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function dueDaysLabel(dueDate: string | null): string {
  if (!dueDate) return '';
  const days = Math.floor((new Date(dueDate).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `Vencida hace ${Math.abs(days)}d`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `Vence en ${days}d`;
}

// ── métricas ─────────────────────────────────────────────────────────────────

interface ProdMetrics {
  avgCycleDays: number | null;
  onTimePct: number | null;
  latePct: number | null;
  inProgressCount: number;
  deliveredCount: number;
}

function calcMetrics(orders: WorkOrder[]): ProdMetrics {
  const active = orders.filter((o) => !o.archived);
  const inProgressCount = active.filter((o) => o.status === 'en_proceso').length;
  const delivered = active.filter((o) => o.status === 'entregada' && o.deliveredAtUTC && o.createdAtUTC);

  let avgCycleDays: number | null = null;
  let onTimePct: number | null = null;
  let latePct: number | null = null;

  if (delivered.length > 0) {
    const cycleDays = delivered.map((o) =>
      Math.max(0, Math.floor((new Date(o.deliveredAtUTC!).getTime() - new Date(o.createdAtUTC!).getTime()) / 86_400_000))
    );
    avgCycleDays = Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length);

    const withDue = delivered.filter((o) => o.dueDate);
    if (withDue.length > 0) {
      const onTime = withDue.filter((o) => o.deliveredAtUTC! <= o.dueDate! + 'T23:59:59Z').length;
      onTimePct = Math.round((onTime / withDue.length) * 100);
      latePct = 100 - onTimePct;
    }
  }

  return { avgCycleDays, onTimePct, latePct, inProgressCount, deliveredCount: delivered.length };
}

// ── componente principal ──────────────────────────────────────────────────────

export function WorkOrdersPanel(): ReactElement {
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [torneros, setTorneros] = useState<Tornero[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas');
  const [showArchived, setShowArchived] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [alertFilter, setAlertFilter] = useState<DueDateSeverity | null>(null);
  const [rowBusy, setRowBusy] = useState<Record<string, string>>({});
  const [newTornero, setNewTornero] = useState('');
  const [showMetrics, setShowMetrics] = useState(false);
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

  // ── filtrado y ordenación ──────────────────────────────────────────────────

  const visible = useMemo(() => {
    const term = norm(search);
    return orders
      .filter((o) => (showArchived ? true : !o.archived))
      .filter((o) => (statusFilter === 'todas' ? true : o.status === statusFilter))
      .filter((o) => (urgentOnly ? o.prioridad === 'URGENTE' : true))
      .filter((o) => {
        if (!alertFilter) return true;
        return getDueDateSeverity(o.dueDate, o.status) === alertFilter;
      })
      .filter((o) => {
        if (term.length === 0) return true;
        const hay = norm(
          `${o.pieza} ${o.numeroParte} ${o.soNumber} ${o.poNumber} ${o.assignedToTornero ?? ''} ${o.deliveredToTornero ?? ''}`,
        );
        return hay.includes(term);
      })
      .sort((a, b) => {
        // 1. urgentes primero
        if (a.prioridad !== b.prioridad) return a.prioridad === 'URGENTE' ? -1 : 1;
        // 2. por severidad de dueDate
        const sevOrder: DueDateSeverity[] = ['overdue', 'critical', 'warning', 'unknown', 'ok', 'done'];
        const sa = sevOrder.indexOf(getDueDateSeverity(a.dueDate, a.status));
        const sb = sevOrder.indexOf(getDueDateSeverity(b.dueDate, b.status));
        if (sa !== sb) return sa - sb;
        // 3. más antiguas primero dentro de cada grupo
        return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
      });
  }, [orders, search, statusFilter, showArchived, urgentOnly, alertFilter]);

  const metrics = useMemo(() => calcMetrics(orders), [orders]);

  // ── handlers de estado ────────────────────────────────────────────────────

  const handleTransition = useCallback(async (
    order: WorkOrder,
    newStatus: WorkOrderStatus,
    torneroName?: string,
  ) => {
    setBusy(order.id, 'Guardando');
    const res = await updateOrderStatus(order.id, newStatus, torneroName);
    clearBusy(order.id);
    if (res.ok === false) {
      setErrorMessage(
        res.reason === 'not-authenticated'
          ? 'Inicia sesión para actualizar el estado.'
          : 'No fue posible actualizar el estado. Reintenta.',
      );
      return;
    }
    setOrders((prev) => prev.map((o) => {
      if (o.id !== order.id) return o;
      const now = new Date().toISOString();
      const base = { ...o, status: newStatus, updatedAtUTC: now };
      if (newStatus === 'en_proceso') {
        return { ...base, assignedToTornero: res.value.deliveredToTornero, assignedAtUTC: now };
      }
      if (newStatus === 'terminada') {
        return { ...base, finishedAtUTC: now };
      }
      if (newStatus === 'entregada') {
        return { ...base, deliveredToTornero: res.value.deliveredToTornero, deliveredAtUTC: now };
      }
      if (newStatus === 'pendiente') {
        return {
          ...base, assignedToTornero: null, assignedAtUTC: null,
          finishedAtUTC: null, deliveredToTornero: null, deliveredAtUTC: null,
        };
      }
      return base;
    }));
  }, []);

  const handleArchive = useCallback(async (order: WorkOrder) => {
    setBusy(order.id, 'Archivando');
    const res = await archiveWorkOrder(order.id, !order.archived);
    clearBusy(order.id);
    if (res.ok === false) { setErrorMessage('No fue posible archivar.'); return; }
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, archived: !order.archived } : o)));
  }, []);

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
  }, []);

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
    if (res.ok === false) { setErrorMessage('No fue posible agregar el tornero.'); return; }
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

  return (
    <div className="max-w-6xl mx-auto space-y-4">

      {/* ── Título + refrescar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[28px] font-black uppercase tracking-[-1px] mr-auto">
          Control de Producción
          <span className="ml-3 bg-accent text-bg px-2 py-0.5 text-[12px] align-middle">
            {pendientes} pendientes
          </span>
        </h2>
        <button
          type="button" onClick={() => void load()} disabled={status === 'loading'}
          className="border-2 border-ink bg-white px-3 py-2 text-[10px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40 flex items-center gap-1"
        >
          {status === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
          Refrescar
        </button>
      </div>

      {/* ── Barra de alertas ── */}
      {(alertCounts.overdue + alertCounts.critical + alertCounts.warning) > 0 && (
        <div className="flex flex-wrap gap-2">
          {alertCounts.overdue > 0 && (
            <button
              type="button"
              onClick={() => setAlertFilter(alertFilter === 'overdue' ? null : 'overdue')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase border-2 transition-colors ${
                alertFilter === 'overdue'
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-red-50 text-red-700 border-red-600 hover:bg-red-100'
              }`}
            >
              <AlertCircle size={12} />
              {alertCounts.overdue} vencida{alertCounts.overdue !== 1 ? 's' : ''}
            </button>
          )}
          {alertCounts.critical > 0 && (
            <button
              type="button"
              onClick={() => setAlertFilter(alertFilter === 'critical' ? null : 'critical')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase border-2 transition-colors ${
                alertFilter === 'critical'
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-orange-50 text-orange-700 border-orange-500 hover:bg-orange-100'
              }`}
            >
              <Clock size={12} />
              {alertCounts.critical} crítica{alertCounts.critical !== 1 ? 's' : ''} (≤3d)
            </button>
          )}
          {alertCounts.warning > 0 && (
            <button
              type="button"
              onClick={() => setAlertFilter(alertFilter === 'warning' ? null : 'warning')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase border-2 transition-colors ${
                alertFilter === 'warning'
                  ? 'bg-yellow-400 text-black border-yellow-500'
                  : 'bg-yellow-50 text-yellow-700 border-yellow-400 hover:bg-yellow-100'
              }`}
            >
              <Clock size={12} />
              {alertCounts.warning} próxima{alertCounts.warning !== 1 ? 's' : ''} (≤7d)
            </button>
          )}
          {alertFilter && (
            <button
              type="button" onClick={() => setAlertFilter(null)}
              className="px-3 py-1.5 text-[11px] font-black uppercase border-2 border-ink/30 text-ink/50 hover:border-ink hover:text-ink"
            >
              Ver todas
            </button>
          )}
        </div>
      )}

      {/* ── Filtros + búsqueda ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 border-2 border-ink px-2 py-1 bg-white">
          <Search size={14} className="text-ink/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pieza, parte, SO, tornero…"
            className="bg-transparent outline-none text-[12px] font-mono w-56"
          />
        </div>
        {(['todas', 'pendiente', 'en_proceso', 'terminada', 'entregada'] as const).map((f) => (
          <button
            key={f} type="button" onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border-2 border-ink transition-colors ${
              statusFilter === f ? 'bg-ink text-bg' : 'bg-white hover:bg-ink/10'
            }`}
          >
            {f === 'todas' ? 'Todas' : STATUS_LABELS[f]}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider cursor-pointer">
          <input type="checkbox" checked={urgentOnly} onChange={(e) => setUrgentOnly(e.target.checked)} />
          Solo urgentes
        </label>
        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Archivadas
        </label>
      </div>

      {/* ── Error ── */}
      {errorMessage && (
        <div className="flex items-start gap-2 border-2 border-accent bg-accent/10 px-3 py-2 text-[11px] font-mono text-accent" role="alert">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="grow">{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage(null)} className="shrink-0 text-accent/60 hover:text-accent text-xs">✕</button>
        </div>
      )}

      {/* ── Panel de métricas (colapsable) ── */}
      <div className="border-2 border-ink bg-white">
        <button
          type="button"
          onClick={() => setShowMetrics((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-black uppercase tracking-wider hover:bg-ink hover:text-bg"
        >
          <span className="flex items-center gap-2"><BarChart2 size={13} /> Métricas de producción</span>
          {showMetrics ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showMetrics && (
          <div className="border-t-2 border-ink px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[9px] font-black uppercase text-ink/50 mb-0.5">Ciclo promedio</p>
              <p className="text-[22px] font-black text-ink">
                {metrics.avgCycleDays !== null ? `${metrics.avgCycleDays}d` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-black uppercase text-ink/50 mb-0.5">A tiempo</p>
              <p className="text-[22px] font-black text-green-700">
                {metrics.onTimePct !== null ? `${metrics.onTimePct}%` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-black uppercase text-ink/50 mb-0.5">Con retraso</p>
              <p className="text-[22px] font-black text-red-600">
                {metrics.latePct !== null ? `${metrics.latePct}%` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-black uppercase text-ink/50 mb-0.5">En proceso hoy</p>
              <p className="text-[22px] font-black text-blue-700">{metrics.inProgressCount}</p>
            </div>
            <div className="col-span-2 sm:col-span-4 text-[9px] font-mono text-ink/40">
              Basado en {metrics.deliveredCount} órdenes entregadas con fecha registrada.
              Las órdenes sin dueDate no cuentan en % a tiempo.
            </div>
          </div>
        )}
      </div>

      {/* ── Gestión de torneros ── */}
      <details className="border-2 border-ink bg-white">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-black uppercase tracking-wider hover:bg-ink hover:text-bg">
          Torneros ({activeTorneros.length} activos)
        </summary>
        <div className="border-t-2 border-ink p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={newTornero} onChange={(e) => setNewTornero(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAddTornero(); }}
              placeholder="Nombre del tornero"
              className="grow border border-ink/40 px-2 py-1 text-[12px] font-mono outline-none"
            />
            <button type="button" onClick={() => void handleAddTornero()}
              className="border-2 border-ink bg-accent text-bg px-3 py-1 text-[10px] font-black uppercase flex items-center gap-1 hover:bg-ink">
              <Plus size={12} /> Agregar
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {torneros.map((t) => (
              <button key={t.id} type="button" onClick={() => void handleToggleTornero(t)}
                className={`px-2 py-1 text-[10px] font-black uppercase tracking-wider border-2 border-ink ${
                  t.active ? 'bg-ink text-bg' : 'bg-white text-ink/40 line-through'
                }`} title={t.active ? 'Click para desactivar' : 'Click para activar'}>
                {t.name}
              </button>
            ))}
            {torneros.length === 0 && (
              <span className="text-[10px] font-mono text-ink/50">Aún no hay torneros. Agrega el primero.</span>
            )}
          </div>
        </div>
      </details>

      {/* ── Lista de órdenes ── */}
      {status === 'loading' && (
        <div className="text-[12px] font-mono text-ink/60 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Cargando órdenes…
        </div>
      )}
      {status === 'ready' && visible.length === 0 && (
        <div className="text-[12px] font-mono text-ink/60 border-2 border-dashed border-ink/30 p-6 text-center">
          No hay órdenes que coincidan. Sube una PO en "Generar Reporte" para empezar.
        </div>
      )}

      <div className="space-y-2">
        {visible.map((o) => {
          const busy = rowBusy[o.id];
          const severity = getDueDateSeverity(o.dueDate, o.status);
          const isEditingNotes = editingNotesId === o.id;
          const isEditingDueDate = editingDueDateId === o.id;

          return (
            <div
              key={o.id}
              className={`border-2 border-ink bg-white p-3 shadow-[3px_3px_0px_rgba(0,0,0,1)] ${o.archived ? 'opacity-60' : ''}`}
            >
              {/* Fila principal */}
              <div className="flex flex-wrap items-start gap-3">

                {/* Info izquierda */}
                <div className="min-w-0 grow space-y-1">

                  {/* Nombre + badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {o.prioridad === 'URGENTE' && (
                      <span className="bg-accent text-bg px-1.5 py-0.5 text-[9px] font-black uppercase shrink-0">Urgente</span>
                    )}
                    <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase shrink-0 ${STATUS_CHIP_CLASSES[o.status]}`}>
                      {STATUS_LABELS[o.status]}
                    </span>
                    <p className="text-[14px] font-black uppercase tracking-tight truncate" title={o.pieza}>
                      {o.pieza}
                    </p>
                  </div>

                  {/* Datos básicos */}
                  <p className="text-[10px] font-mono text-ink/60">
                    PARTE: {o.numeroParte || '—'} · SO: {oneLine(o.soNumber) || '—'} · PO: {oneLine(o.poNumber) || '—'} · CANT: {oneLine(o.cantidad) || '—'} · OT: {oneLine(o.otDate) || '—'}
                  </p>

                  {/* Fecha límite */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {isEditingDueDate ? (
                      <form
                        className="flex items-center gap-1"
                        onSubmit={(e) => { e.preventDefault(); void handleSaveDueDate(o.id, draftDueDate); }}
                      >
                        <input
                          type="date"
                          value={draftDueDate}
                          onChange={(e) => setDraftDueDate(e.target.value)}
                          className="border border-ink/40 px-1 py-0.5 text-[11px] font-mono outline-none"
                        />
                        <button type="submit" className="px-2 py-0.5 bg-ink text-bg text-[9px] font-black uppercase">OK</button>
                        <button type="button" onClick={() => setEditingDueDateId(null)} className="px-2 py-0.5 border border-ink/30 text-[9px] font-black uppercase">✕</button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingDueDateId(o.id);
                          setDraftDueDate(o.dueDate ?? '');
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-black uppercase border ${SEVERITY_CLASSES[severity]} hover:opacity-80 transition-opacity`}
                        title="Click para editar fecha límite"
                      >
                        <Clock size={10} />
                        {o.dueDate ? `${fmtDateOnly(o.dueDate)} · ${dueDaysLabel(o.dueDate)}` : 'Sin fecha límite — click para fijar'}
                      </button>
                    )}
                  </div>

                  {/* Estado de avance */}
                  {o.status === 'en_proceso' && o.assignedToTornero && (
                    <p className="text-[10px] font-mono text-blue-700 flex items-center gap-1">
                      <span className="w-2 h-2 bg-blue-600 rounded-full inline-block" />
                      En proceso con <b>{o.assignedToTornero}</b>
                      {o.assignedAtUTC && <span className="text-ink/40"> · desde {fmtDate(o.assignedAtUTC)}</span>}
                    </p>
                  )}
                  {o.status === 'terminada' && (
                    <p className="text-[10px] font-mono text-green-700 flex items-center gap-1">
                      <CheckCircle2 size={11} />
                      Terminada{o.finishedAtUTC ? ` el ${fmtDate(o.finishedAtUTC)}` : ''}
                      {o.assignedToTornero && <span> · hecha por <b>{o.assignedToTornero}</b></span>}
                    </p>
                  )}
                  {o.status === 'entregada' && (
                    <p className="text-[10px] font-mono text-ink/60 flex items-center gap-1">
                      <CheckCircle2 size={11} className="text-green-600" />
                      Entregada a <b>{o.deliveredToTornero ?? '—'}</b> el {fmtDate(o.deliveredAtUTC)}
                    </p>
                  )}

                  {/* Notas */}
                  {isEditingNotes ? (
                    <div className="space-y-1 mt-1">
                      <textarea
                        rows={2}
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                        placeholder="Notas para esta orden…"
                        className="w-full border border-ink/40 px-2 py-1 text-[11px] font-mono outline-none resize-none"
                      />
                      <div className="flex gap-1">
                        <button type="button" onClick={() => void handleSaveNotes(o.id)}
                          className="px-2 py-0.5 bg-ink text-bg text-[9px] font-black uppercase">Guardar</button>
                        <button type="button" onClick={() => setEditingNotesId(null)}
                          className="px-2 py-0.5 border border-ink/30 text-[9px] font-black uppercase">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setEditingNotesId(o.id); setDraftNotes(o.notes); }}
                      className="text-[10px] font-mono text-ink/40 hover:text-ink text-left"
                    >
                      {o.notes ? o.notes : '+ Agregar nota…'}
                    </button>
                  )}
                </div>

                {/* Acciones derecha */}
                <div className="flex flex-col items-end gap-1.5 shrink-0">

                  {/* Botón Plano-OT */}
                  <button type="button" onClick={() => void handlePrint(o)} disabled={!!busy}
                    className="border-2 border-ink bg-white px-2 py-1 text-[9px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40 flex items-center gap-1">
                    <Printer size={11} /> Plano-OT
                  </button>

                  {/* Controles de estado según etapa */}
                  {o.status === 'pendiente' && (
                    <select
                      defaultValue=""
                      disabled={!!busy || activeTorneros.length === 0}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) void handleTransition(o, 'en_proceso', v);
                        e.currentTarget.value = '';
                      }}
                      className="border-2 border-ink bg-blue-600 text-white px-2 py-1 text-[9px] font-black uppercase disabled:opacity-40"
                      title={activeTorneros.length === 0 ? 'Agrega torneros primero' : 'Asignar a tornero'}
                    >
                      <option value="" disabled>{busy ?? 'Asignar a ▾'}</option>
                      {activeTorneros.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  )}

                  {o.status === 'en_proceso' && (
                    <>
                      <button type="button" disabled={!!busy}
                        onClick={() => void handleTransition(o, 'terminada')}
                        className="border-2 border-green-600 bg-green-600 text-white px-2 py-1 text-[9px] font-black uppercase hover:bg-green-700 disabled:opacity-40 flex items-center gap-1">
                        <CheckCircle2 size={11} /> Terminada
                      </button>
                      <select
                        defaultValue=""
                        disabled={!!busy || activeTorneros.length === 0}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) void handleTransition(o, 'en_proceso', v);
                          e.currentTarget.value = '';
                        }}
                        className="border-2 border-ink bg-white text-ink px-2 py-1 text-[9px] font-black uppercase disabled:opacity-40"
                      >
                        <option value="" disabled>Reasignar ▾</option>
                        {activeTorneros.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                      </select>
                      <button type="button" disabled={!!busy}
                        onClick={() => void handleTransition(o, 'pendiente')}
                        className="border-2 border-ink bg-white px-2 py-1 text-[9px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40">
                        Revertir
                      </button>
                    </>
                  )}

                  {o.status === 'terminada' && (
                    <>
                      <select
                        defaultValue=""
                        disabled={!!busy || activeTorneros.length === 0}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) void handleTransition(o, 'entregada', v);
                          e.currentTarget.value = '';
                        }}
                        className="border-2 border-ink bg-accent text-bg px-2 py-1 text-[9px] font-black uppercase disabled:opacity-40"
                        title={activeTorneros.length === 0 ? 'Agrega torneros primero' : 'Entregar a Suprajit…'}
                      >
                        <option value="" disabled>{busy ?? 'Entregar a ▾'}</option>
                        {activeTorneros.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                      </select>
                      <button type="button" disabled={!!busy}
                        onClick={() => void handleTransition(o, 'en_proceso', o.assignedToTornero ?? activeTorneros[0]?.name)}
                        className="border-2 border-ink bg-white px-2 py-1 text-[9px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40">
                        Volver a proceso
                      </button>
                    </>
                  )}

                  {o.status === 'entregada' && (
                    <button type="button" disabled={!!busy}
                      onClick={() => void handleTransition(o, 'pendiente')}
                      className="border-2 border-ink bg-white px-2 py-1 text-[9px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40">
                      Revertir
                    </button>
                  )}

                  {/* Archivar */}
                  <button type="button" onClick={() => void handleArchive(o)} disabled={!!busy}
                    className="text-ink/40 hover:text-ink text-[9px] font-black uppercase flex items-center gap-1">
                    <Archive size={10} /> {o.archived ? 'Desarchivar' : 'Archivar'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
