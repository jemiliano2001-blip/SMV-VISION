/**
 * WorkOrdersPanel — la vista "Control de Órdenes".
 *
 * Lista las órdenes acumuladas (Firestore), con filtros y búsqueda; permite
 * marcar "Entregar a [tornero]" (prueba con sello de servidor) e imprimir el
 * plano-OT (blueprint original sellado con SO·cantidad·fecha). Gestión mínima
 * de torneros. Toda la E/S pasa por `src/lib/firebase/workOrders.ts`.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  AlertCircle, CheckCircle2, Loader2, Printer, RefreshCcw, Search, Plus, Archive,
} from 'lucide-react';

import type { WorkOrder, Tornero } from '../types';
import {
  listWorkOrders, markDelivered, markPending, archiveWorkOrder,
  listTorneros, addTornero, setTorneroActive,
} from '../lib/firebase/workOrders';
import { getDrawingById } from '../lib/firebase/toolcrib';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { openStampedPlanoOt } from '../lib/planoOt';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
type StatusFilter = 'todas' | 'pendiente' | 'entregada';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
function oneLine(value: string): string {
  return (value ?? '').replace(/[\r\n]+/g, ' / ').replace(/\s+/g, ' ').trim();
}
function norm(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function WorkOrdersPanel(): ReactElement {
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [torneros, setTorneros] = useState<Tornero[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pendiente');
  const [showArchived, setShowArchived] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [rowBusy, setRowBusy] = useState<Record<string, string>>({});
  const [newTornero, setNewTornero] = useState('');

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

  const visible = useMemo(() => {
    const term = norm(search);
    return orders
      .filter((o) => (showArchived ? true : !o.archived))
      .filter((o) => (statusFilter === 'todas' ? true : o.status === statusFilter))
      .filter((o) => (urgentOnly ? o.prioridad === 'URGENTE' : true))
      .filter((o) => {
        if (term.length === 0) return true;
        const hay = norm(
          `${o.pieza} ${o.numeroParte} ${o.soNumber} ${o.poNumber} ${o.deliveredToTornero ?? ''}`,
        );
        return hay.includes(term);
      })
      .sort((a, b) => {
        if (a.prioridad !== b.prioridad) return a.prioridad === 'URGENTE' ? -1 : 1;
        return (b.createdAtUTC ?? '').localeCompare(a.createdAtUTC ?? '');
      });
  }, [orders, search, statusFilter, showArchived, urgentOnly]);

  const pendientes = useMemo(
    () => orders.filter((o) => !o.archived && o.status === 'pendiente').length,
    [orders],
  );

  const setBusy = (id: string, label: string) => setRowBusy((p) => ({ ...p, [id]: label }));
  const clearBusy = (id: string) => setRowBusy((p) => { const n = { ...p }; delete n[id]; return n; });

  const handleDeliver = useCallback(async (order: WorkOrder, torneroName: string) => {
    setBusy(order.id, 'Guardando');
    const res = await markDelivered(order.id, torneroName);
    clearBusy(order.id);
    if (res.ok === false) {
      setErrorMessage(
        res.reason === 'not-authenticated'
          ? 'Inicia sesión para registrar la entrega (queda con tu usuario y fecha del servidor).'
          : 'No fue posible registrar la entrega. Reintenta.',
      );
      return;
    }
    setOrders((prev) => prev.map((o) => (
      o.id === order.id
        ? { ...o, status: 'entregada', deliveredToTornero: torneroName, deliveredAtUTC: new Date().toISOString() }
        : o
    )));
  }, []);

  const handleUndo = useCallback(async (order: WorkOrder) => {
    setBusy(order.id, 'Revirtiendo');
    const res = await markPending(order.id);
    clearBusy(order.id);
    if (res.ok === false) { setErrorMessage('No fue posible revertir la entrega.'); return; }
    setOrders((prev) => prev.map((o) => (
      o.id === order.id
        ? { ...o, status: 'pendiente', deliveredToTornero: null, deliveredAtUTC: null }
        : o
    )));
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
        setErrorMessage('El plano emparejado no tiene PDF accesible (sube el plano a Storage o revisa el catálogo).');
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

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[28px] font-black uppercase tracking-[-1px] mr-auto">
          Control de Órdenes
          <span className="ml-3 bg-accent text-bg px-2 py-0.5 text-[12px] align-middle">{pendientes} pendientes</span>
        </h2>
        <div className="flex items-center gap-2 border-2 border-ink px-2 py-1 bg-white">
          <Search size={14} className="text-ink/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pieza, parte, SO, PO, tornero…"
            className="bg-transparent outline-none text-[12px] font-mono w-64"
          />
        </div>
        <button
          type="button" onClick={() => void load()} disabled={status === 'loading'}
          className="border-2 border-ink bg-white px-3 py-2 text-[10px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40 flex items-center gap-1"
        >
          {status === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
          Refrescar
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(['pendiente', 'entregada', 'todas'] as const).map((f) => (
          <button
            key={f} type="button" onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border-2 border-ink transition-colors ${
              statusFilter === f ? 'bg-ink text-bg' : 'bg-white hover:bg-ink/10'
            }`}
          >
            {f}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider cursor-pointer">
          <input type="checkbox" checked={urgentOnly} onChange={(e) => setUrgentOnly(e.target.checked)} />
          Solo urgentes
        </label>
        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Ver archivadas
        </label>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2 border-2 border-accent bg-accent/10 px-3 py-2 text-[11px] font-mono text-accent" role="alert">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Torneros management */}
      <details className="border-2 border-ink bg-white">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-black uppercase tracking-wider hover:bg-ink hover:text-bg">
          Torneros ({activeTorneros.length} activos)
        </summary>
        <div className="border-t-2 border-ink p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={newTornero} onChange={(e) => setNewTornero(e.target.value)}
              placeholder="Nombre del tornero" className="grow border border-ink/40 px-2 py-1 text-[12px] font-mono outline-none"
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
            {torneros.length === 0 && <span className="text-[10px] font-mono text-ink/50">Aún no hay torneros. Agrega el primero.</span>}
          </div>
        </div>
      </details>

      {/* List */}
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
          return (
            <div key={o.id}
              className={`border-2 border-ink bg-white p-3 shadow-[3px_3px_0px_rgba(0,0,0,1)] ${o.archived ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 grow">
                  <div className="flex items-center gap-2">
                    {o.prioridad === 'URGENTE' && (
                      <span className="bg-accent text-bg px-1.5 py-0.5 text-[9px] font-black uppercase">Urgente</span>
                    )}
                    <p className="text-[14px] font-black uppercase tracking-tight truncate" title={o.pieza}>{o.pieza}</p>
                  </div>
                  <p className="text-[10px] font-mono text-ink/60 mt-0.5">
                    PARTE: {o.numeroParte || '—'} · SO: {oneLine(o.soNumber) || '—'} · PO: {oneLine(o.poNumber) || '—'} · CANT: {oneLine(o.cantidad) || '—'} · FECHA: {oneLine(o.otDate) || '—'}
                  </p>
                  {o.status === 'entregada' ? (
                    <p className="text-[10px] font-mono text-green-700 mt-1 flex items-center gap-1">
                      <CheckCircle2 size={11} /> Entregada a <b>{o.deliveredToTornero}</b> · {fmtDate(o.deliveredAtUTC)}
                    </p>
                  ) : (
                    <p className="text-[10px] font-mono text-ink/50 mt-1">Pendiente de entregar</p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <button type="button" onClick={() => void handlePrint(o)} disabled={!!busy}
                    className="border-2 border-ink bg-white px-2 py-1 text-[9px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40 flex items-center gap-1">
                    <Printer size={11} /> Plano-OT
                  </button>

                  {o.status === 'pendiente' ? (
                    <select
                      defaultValue=""
                      disabled={!!busy || activeTorneros.length === 0}
                      onChange={(e) => { const v = e.target.value; if (v) void handleDeliver(o, v); e.currentTarget.value = ''; }}
                      className="border-2 border-ink bg-accent text-bg px-2 py-1 text-[9px] font-black uppercase disabled:opacity-40"
                      title={activeTorneros.length === 0 ? 'Agrega torneros primero' : 'Entregar a…'}
                    >
                      <option value="" disabled>{busy ?? 'Entregar a ▾'}</option>
                      {activeTorneros.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  ) : (
                    <button type="button" onClick={() => void handleUndo(o)} disabled={!!busy}
                      className="border-2 border-ink bg-white px-2 py-1 text-[9px] font-black uppercase hover:bg-ink hover:text-bg disabled:opacity-40">
                      Revertir
                    </button>
                  )}

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
