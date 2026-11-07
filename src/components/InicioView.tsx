/**
 * InicioView — portada / resumen.
 *
 * Contesta "¿qué hay hoy?": órdenes más críticas, semáforo de antigüedad,
 * carga por requisitor y cifras en vivo de Firestore.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { motion } from 'motion/react';
import {
  ScanLine,
  ArrowRight,
  CloudDownload,
  FileWarning,
  RefreshCw,
  Clock,
  Users,
  Boxes,
  AlertCircle,
  X,
  type LucideIcon,
} from 'lucide-react';

import { listEntregasSinOC, listOrdersToInvoice, orderRequester, REPORT_PARTNER_KEY_PREFIX, type OdooOrderView } from '../lib/firebase/odooOrders';
import { triggerOdooSync } from '../lib/firebase/syncOdoo';
import { formatAgeDays, formatRelativeTime, getOrderAgeDays } from '../lib/age';
import { topCriticalOrders } from '../lib/topCriticalOrders';
import { useSyncMeta } from '../hooks/useSyncMeta';
import { BarChart, type BarChartEntry } from './charts/BarChart';
import { Button } from './ui/button';
import { PageFrame } from './shell/PageFrame';
import type { AnalysisRunSummary } from '../types';
import type { AppView } from './shell/AppShell';

export interface InicioViewProps {
  onNavigate: (view: AppView) => void;
  analysisSummary: AnalysisRunSummary | null;
  /** Abre una orden concreta (id del documento Firestore). */
  onOpenOrder?: (orderId: string) => void;
}

const CRITICAL_LIMIT = 8;
const NO_REQUESTER = 'Sin requisitor';

/** Por cifra: `undefined` = cargando · `null` = la consulta falló · número = dato bueno. */
function show(n: number | null | undefined): string {
  if (n === undefined) return '…';
  if (n === null) return '—';
  return String(n);
}

function ageTone(days: number | null): string {
  if (days === null) return 'text-ink-dim';
  if (days > 15) return 'text-danger';
  if (days >= 7) return 'text-warn';
  return 'text-ok';
}

export function InicioView({ onNavigate, analysisSummary, onOpenOrder }: InicioViewProps): ReactElement {
  const now = new Date().toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const { meta, state: syncState, isError, isStale, totalToInvoiceOrders, effectiveLastSyncDate } = useSyncMeta();
  const [sinOc, setSinOc] = useState<number | null | undefined>(undefined);
  const [orders, setOrders] = useState<OdooOrderView[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [ordersLoadFailed, setOrdersLoadFailed] = useState(false);
  const [selectedPartnerKey, setSelectedPartnerKey] = useState<string>('ALL');
  const [syncing, setSyncing] = useState(false);
  const [syncElapsed, setSyncElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cargar órdenes activas para métricas de carga y semáforo de antigüedad
  const loadOrders = useCallback(async (partnerKeyFilter: string) => {
    setLoadingOrders(true);
    try {
      if (partnerKeyFilter === 'ALL') {
        const res = await listOrdersToInvoice({ partnerKeyPrefix: '' });
        if (res.ok) {
          setOrders(res.value);
          setOrdersLoadFailed(false);
          setError(null);
        } else {
          // Fallback a Suprajit si no trae prefijo vacío
          const fallback = await listOrdersToInvoice({ partnerKeyPrefix: REPORT_PARTNER_KEY_PREFIX });
          if (fallback.ok) {
            setOrders(fallback.value);
            setOrdersLoadFailed(false);
            setError(null);
          } else {
            setOrdersLoadFailed(true);
            setError('No fue posible cargar las órdenes. Los datos mostrados pueden estar desactualizados.');
          }
        }
      } else {
        const res = await listOrdersToInvoice({ partnerKey: partnerKeyFilter });
        if (res.ok) {
          setOrders(res.value);
          setOrdersLoadFailed(false);
          setError(null);
        } else {
          setOrdersLoadFailed(true);
          setError('No fue posible cargar las órdenes. Los datos mostrados pueden estar desactualizados.');
        }
      }
    } catch {
      setOrders([]);
      setOrdersLoadFailed(true);
      setError('No fue posible cargar las órdenes. Los datos mostrados pueden estar desactualizados.');
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders(selectedPartnerKey);
  }, [loadOrders, selectedPartnerKey]);

  // Entregas sin OC: sigue leyendo Firestore (filtro SUPRAJIT en cliente).
  useEffect(() => {
    let alive = true;
    void listEntregasSinOC().then((sin) => {
      if (!alive) return;
      setSinOc(sin.ok ? sin.value.length : null);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Manejador de sincronización directa desde Inicio
  const handleTriggerSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncElapsed(0);
    setError(null);

    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    syncTimerRef.current = setInterval(() => {
      setSyncElapsed((prev) => {
        if (prev >= 120) {
          clearInterval(syncTimerRef.current!);
          setSyncing(false);
          return 0;
        }
        return prev + 1;
      });
    }, 1000);

    try {
      const result = await triggerOdooSync();
      if (result.ok === false) {
        setError(
          result.reason === 'not-authenticated'
            ? 'Debes iniciar sesión para sincronizar.'
            : `No se pudo sincronizar con Odoo: ${result.reason}`,
        );
        return;
      }
      await loadOrders(selectedPartnerKey);
      const sin = await listEntregasSinOC();
      if (sin.ok) setSinOc(sin.value.length);
    } finally {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      setSyncing(false);
      setSyncElapsed(0);
    }
  };

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, []);

  // Piezas totales pendientes
  const totalPieces = useMemo(() => {
    if (ordersLoadFailed && orders.length === 0) return null;
    if (orders.length === 0) return loadingOrders ? undefined : 0;
    return orders.reduce((sum, o) => {
      return sum + (o.order_lines ?? []).reduce((lSum, l) => {
        const pending = Number.isFinite(l.qty_pending) ? l.qty_pending : 0;
        return lSum + Math.max(0, pending);
      }, 0);
    }, 0);
  }, [orders, loadingOrders, ordersLoadFailed]);

  // Órdenes más críticas (más antiguas primero)
  const criticalOrders = useMemo(() => topCriticalOrders(orders, CRITICAL_LIMIT), [orders]);

  // Carga por requisitor (Top 5); "Sin requisitor" va aparte, fuera de la gráfica
  const { requisitorChartData, noRequesterPieces } = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const o of orders) {
      const req = orderRequester(o);
      const pieces = (o.order_lines ?? []).reduce(
        (sum, l) => sum + (Number.isFinite(l.qty_pending) && l.qty_pending > 0 ? l.qty_pending : 0),
        0,
      );
      const value = pieces > 0 ? pieces : 1;
      if (!req) unassigned += value;
      else counts.set(req, (counts.get(req) ?? 0) + value);
    }
    const data: BarChartEntry[] = Array.from(counts.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    return { requisitorChartData: data, noRequesterPieces: unassigned };
  }, [orders]);

  // Semáforo de antigüedad
  const agingStats = useMemo(() => {
    let recent = 0; // < 7 días
    let mid = 0; // 7 - 15 días
    let critical = 0; // > 15 días
    for (const o of orders) {
      const orderDate = typeof o.date_order === 'string' ? o.date_order.split(' ')[0] : '';
      const age = orderDate ? getOrderAgeDays(orderDate) : 0;
      if (age === null || age < 7) {
        recent += 1;
      } else if (age <= 15) {
        mid += 1;
      } else {
        critical += 1;
      }
    }
    const total = orders.length || 1;
    return {
      recent,
      mid,
      critical,
      totalOrders: orders.length,
      pctRecent: Math.round((recent / total) * 100),
      pctMid: Math.round((mid / total) * 100),
      pctCritical: Math.round((critical / total) * 100),
    };
  }, [orders]);

  const partnersList = meta?.partners ?? [];
  const pendingOrdersValue = meta
    ? totalToInvoiceOrders
    : syncState === 'loading'
      ? undefined
      : null;
  const syncLabel =
    syncState === 'loading'
      ? 'Verificando sync Odoo'
      : isError
        ? 'Sync con incidencias'
        : isStale
          ? 'Sync desactualizado'
          : syncState === 'ready'
            ? 'Último sync Odoo'
            : 'Sync no disponible';
  const syncTone = isError ? 'text-danger' : isStale || syncState !== 'ready' ? 'text-warn' : 'text-ok';

  return (
    <PageFrame
      title="Inicio"
      subtitle={<span className="capitalize">{now}</span>}
      actions={
        <Button onClick={() => onNavigate('reporte')} className="h-11 rounded-lg bg-accent px-4 text-white font-semibold shadow-hard-accent hover:bg-accent/90">
          <ScanLine size={16} /> Nuevo reporte
        </Button>
      }
      toolbar={
        partnersList.length > 0 ? (
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase font-bold tracking-widest text-ink-dim">
            Compañía
            <select
              value={selectedPartnerKey}
              onChange={(e) => setSelectedPartnerKey(e.target.value)}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-xs font-bold text-ink normal-case tracking-normal outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="ALL">Todas ({totalToInvoiceOrders})</option>
              {partnersList.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name} ({p.toInvoiceCount})
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      notices={
        error ? (
          <div className="shrink-0 mx-4 sm:mx-6 mt-3 flex items-start gap-2 rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span className="grow font-mono text-xs">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="grid min-h-11 min-w-11 place-items-center rounded-lg text-danger/70 hover:bg-danger/10 hover:text-danger shrink-0"
              title="Cerrar"
              aria-label="Cerrar error"
            >
              <X size={14} />
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="max-w-[1480px] mx-auto space-y-5">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
          {/* ── Columna principal: órdenes críticas ── */}
          <section className="workspace-panel p-5" aria-label="Órdenes críticas">
            <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-line/60">
              <h2 className="font-display font-semibold text-base tracking-tight">Órdenes críticas</h2>
              <button
                type="button"
                onClick={() => onNavigate('odoo')}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-mono text-[10px] uppercase font-bold text-accent hover:bg-accent/10"
              >
                <span>Ver todas</span>
                <ArrowRight size={12} />
              </button>
            </div>
            {loadingOrders ? (
              <p className="font-mono text-[10px] text-ink-dim py-6 text-center">Cargando órdenes…</p>
            ) : criticalOrders.length === 0 ? (
              <p className="font-mono text-[10px] text-ink-dim py-6 text-center">Sin órdenes activas.</p>
            ) : (
              <ul className="divide-y divide-line/50">
                {criticalOrders.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => onOpenOrder?.(o.id)}
                      className="w-full min-h-14 py-2 px-2 flex items-center gap-3 text-left rounded-lg hover:bg-accent/5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className={`w-20 shrink-0 font-display font-bold text-sm ${ageTone(o.ageDays)}`}>
                        {o.ageDays === null ? '—' : formatAgeDays(o.ageDays)}
                      </span>
                      <span className="min-w-0 grow">
                        <span className="block font-semibold text-sm truncate">{o.name}</span>
                        <span className="block font-mono text-[10px] text-ink-dim truncate">
                          {o.company}
                          {o.requester ? ` · ${o.requester}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-dim">
                        {o.pendingPieces} {o.pendingPieces === 1 ? 'pza' : 'pzas'}
                      </span>
                      <ArrowRight size={14} className="shrink-0 text-ink-dim" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Columna lateral: semáforo y carga ── */}
          <div className="space-y-4">
            <section className="workspace-panel p-5" aria-label="Semáforo de antigüedad">
              <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-line/60">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-accent" />
                  <h2 className="font-display font-semibold text-base tracking-tight">Semáforo</h2>
                </div>
                <span className="font-mono text-[10px] text-ink-dim uppercase">
                  {agingStats.totalOrders} {agingStats.totalOrders === 1 ? 'orden' : 'órdenes'}
                </span>
              </div>
              <div className="h-3 w-full bg-surface-2 border border-line flex overflow-hidden">
                <div
                  style={{ width: `${agingStats.pctRecent}%` }}
                  className="bg-ok h-full transition-all"
                  title={`< 7 días: ${agingStats.recent} órdenes (${agingStats.pctRecent}%)`}
                />
                <div
                  style={{ width: `${agingStats.pctMid}%` }}
                  className="bg-warn h-full transition-all"
                  title={`7–15 días: ${agingStats.mid} órdenes (${agingStats.pctMid}%)`}
                />
                <div
                  style={{ width: `${agingStats.pctCritical}%` }}
                  className="bg-danger h-full transition-all"
                  title={`> 15 días: ${agingStats.critical} órdenes (${agingStats.pctCritical}%)`}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 pt-3 text-center">
                <div className="bg-surface-2/70 rounded-lg border border-line p-2">
                  <p className="font-display font-black text-xl text-ok leading-none">{agingStats.recent}</p>
                  <p className="font-mono text-[9px] uppercase tracking-wider text-ink-dim mt-1">&lt; 7 días</p>
                </div>
                <div className="bg-surface-2/70 rounded-lg border border-line p-2">
                  <p className="font-display font-black text-xl text-warn leading-none">{agingStats.mid}</p>
                  <p className="font-mono text-[9px] uppercase tracking-wider text-ink-dim mt-1">7–15 días</p>
                </div>
                <div className="bg-surface-2/70 rounded-lg border border-line p-2">
                  <p className="font-display font-black text-xl text-danger leading-none">{agingStats.critical}</p>
                  <p className="font-mono text-[9px] uppercase tracking-wider text-ink-dim mt-1">&gt; 15 días</p>
                </div>
              </div>
            </section>

            <section className="workspace-panel p-5" aria-label="Carga por requisitor">
              <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-line/60">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-accent" />
                  <h2 className="font-display font-semibold text-base tracking-tight">Carga por requisitor</h2>
                </div>
                <span className="font-mono text-[10px] text-ink-dim uppercase">Piezas</span>
              </div>
              {loadingOrders ? (
                <p className="font-mono text-[10px] text-ink-dim py-6 text-center">Calculando distribución…</p>
              ) : requisitorChartData.length === 0 ? (
                <p className="font-mono text-[10px] text-ink-dim py-6 text-center">Sin órdenes con requisitor.</p>
              ) : (
                <BarChart data={requisitorChartData} colorVar="--color-accent" />
              )}
              {!loadingOrders && noRequesterPieces > 0 && (
                <p className="mt-3 pt-2 border-t border-line/40 font-mono text-[10px] text-ink-dim">
                  {NO_REQUESTER}: {noRequesterPieces} {noRequesterPieces === 1 ? 'pieza' : 'piezas'}
                </p>
              )}
            </section>
          </div>
        </div>

        {/* ── KPIs en franja baja ── */}
        <section aria-label="Resumen operativo" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard icon={CloudDownload} value={show(pendingOrdersValue)} label="Órdenes pendientes" onClick={() => onNavigate('odoo')} />
          <StatCard icon={Boxes} value={show(totalPieces)} label="Piezas por entregar" tone="text-accent" onClick={() => onNavigate('odoo')} />
          <StatCard
            icon={FileWarning}
            value={show(sinOc)}
            label="Entregas sin OC"
            tone={sinOc ? 'text-warn' : undefined}
            onClick={() => onNavigate('entregas-sin-oc')}
          />
        </section>

        {/* ── Estado de sync en una línea ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-dim">
          <RefreshCw size={14} className={syncing ? 'animate-spin text-accent' : ''} />
          <span className={syncTone}>{syncLabel}</span>
          <span>{effectiveLastSyncDate ? formatRelativeTime(effectiveLastSyncDate) : '—'}</span>
          {analysisSummary && (
            <span>
              · Última auditoría: {analysisSummary.totalOrders} órdenes, {analysisSummary.totalAudited} auditadas, {analysisSummary.totalAnalyzed} planos
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleTriggerSync()}
            disabled={syncing}
            className="min-h-11 rounded-lg px-3 text-[10px] font-mono font-bold uppercase tracking-wider text-accent border border-accent/40 hover:bg-accent hover:text-white transition-colors"
            title="Disparar sincronización con Odoo ahora"
          >
            {syncing ? `${syncElapsed}s` : 'Sincronizar'}
          </Button>
        </div>
      </div>
    </PageFrame>
  );
}

function StatCard({ icon: Icon, value, label, tone = 'text-ink', onClick }: {
  icon: LucideIcon;
  value: string;
  label: string;
  tone?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between mb-2">
        <Icon size={16} className="text-ink-dim" />
        {onClick && (
          <ArrowRight size={14} className="text-ink-dim opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
      <p className={`font-display font-bold leading-none text-2xl sm:text-3xl truncate ${tone}`}>
        {value}
      </p>
      <p className="font-mono text-[8px] sm:text-[9px] uppercase tracking-[1.5px] sm:tracking-[2px] text-ink-dim mt-2 truncate">
        {label}
      </p>
    </>
  );

  if (!onClick) {
    return <div className="workspace-panel p-3 sm:p-4">{body}</div>;
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ y: 0 }}
      className="group workspace-panel min-h-24 p-3 sm:p-4 text-left transition-colors hover:border-accent/60 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      {body}
    </motion.button>
  );
}
