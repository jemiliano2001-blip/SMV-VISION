/**
 * InicioView — portada / resumen.
 *
 * Contesta "¿qué hay hoy?" con cifras en vivo de Firestore, métricas de carga
 * por requisitor, semáforo de antigüedad de órdenes y accesos rápidos.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { motion } from 'motion/react';
import {
  ScanLine,
  Library,
  ArrowRight,
  CloudDownload,
  ShoppingCart,
  FileWarning,
  RefreshCw,
  Clock,
  Users,
  Boxes,
  Activity,
  Building2,
  AlertCircle,
  X,
  type LucideIcon,
} from 'lucide-react';

import { listEntregasSinOC, listOrdersToInvoice, REPORT_PARTNER_KEY_PREFIX, type OdooOrderView } from '../lib/firebase/odooOrders';
import { triggerOdooSync } from '../lib/firebase/syncOdoo';
import { formatRelativeTime, getOrderAgeDays } from '../lib/age';
import { useSyncMeta } from '../hooks/useSyncMeta';
import { BarChart, type BarChartEntry } from './charts/BarChart';
import { Button } from './ui/button';
import type { AnalysisRunSummary } from '../types';
import type { AppView } from './shell/AppShell';

export interface InicioViewProps {
  onNavigate: (view: AppView) => void;
  analysisSummary: AnalysisRunSummary | null;
}

/** Por cifra: `undefined` = cargando · `null` = la consulta falló · número = dato bueno. */
function show(n: number | null | undefined): string {
  if (n === undefined) return '…';
  if (n === null) return '—';
  return String(n);
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 30 } },
} as const;

export function InicioView({ onNavigate, analysisSummary }: InicioViewProps): ReactElement {
  const now = new Date().toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const { meta, isError, isStale, totalToInvoiceOrders, effectiveLastSyncDate } = useSyncMeta();
  const [sinOc, setSinOc] = useState<number | null | undefined>(undefined);
  const [orders, setOrders] = useState<OdooOrderView[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
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
          setError(null);
        } else {
          // Fallback a Suprajit si no trae prefijo vacío
          const fallback = await listOrdersToInvoice({ partnerKeyPrefix: REPORT_PARTNER_KEY_PREFIX });
          if (fallback.ok) {
            setOrders(fallback.value);
            setError(null);
          } else {
            setError('No fue posible cargar las órdenes. Los datos mostrados pueden estar desactualizados.');
          }
        }
      } else {
        const res = await listOrdersToInvoice({ partnerKey: partnerKeyFilter });
        if (res.ok) {
          setOrders(res.value);
          setError(null);
        } else {
          setError('No fue posible cargar las órdenes. Los datos mostrados pueden estar desactualizados.');
        }
      }
    } catch {
      setOrders([]);
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
    if (orders.length === 0) return loadingOrders ? undefined : 0;
    return orders.reduce((sum, o) => {
      return sum + o.order_lines.reduce((lSum, l) => lSum + Math.max(0, l.qty_pending), 0);
    }, 0);
  }, [orders, loadingOrders]);

  // Carga por requisitor (Top 5)
  const requisitorChartData = useMemo<BarChartEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const o of orders) {
      const req = o.requisitor?.trim() || 'Sin requisitor';
      const pieces = o.order_lines.reduce(
        (sum, l) => sum + (l.qty_pending > 0 ? l.qty_pending : 0),
        0,
      );
      counts.set(req, (counts.get(req) ?? 0) + (pieces > 0 ? pieces : 1));
    }
    return Array.from(counts.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [orders]);

  // Semáforo de antigüedad
  const agingStats = useMemo(() => {
    let recent = 0; // < 7 días
    let mid = 0; // 7 - 15 días
    let critical = 0; // > 15 días
    for (const o of orders) {
      const age = o.date_order ? getOrderAgeDays(o.date_order.split(' ')[0]) : 0;
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

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="bp-grid-lg min-h-full p-6 lg:p-10 max-w-[1400px]"
    >
      {/* ── Encabezado ── */}
      <motion.header variants={item} className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-1">Centro de Control</p>
          <h1 className="font-display font-black text-5xl lg:text-6xl uppercase italic tracking-[-2px] leading-none">
            Inicio
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="font-mono text-[11px] text-ink-dim capitalize">{now}</p>
        </div>
      </motion.header>

      {error && (
        <motion.div
          variants={item}
          className="mb-6 flex items-start gap-2 border-2 border-danger bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="grow font-mono text-xs">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-danger/70 hover:text-danger shrink-0"
            title="Cerrar"
            aria-label="Cerrar error"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}

      {/* ── Métricas Principales (KPI Cards) ── */}
      <motion.section variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={CloudDownload}
          value={show(totalToInvoiceOrders || (orders.length > 0 ? orders.length : undefined))}
          label="Órdenes pendientes"
          onClick={() => onNavigate('odoo')}
        />
        <StatCard
          icon={Boxes}
          value={show(totalPieces)}
          label="Piezas por entregar"
          tone="text-accent"
          onClick={() => onNavigate('odoo')}
        />
        <StatCard
          icon={FileWarning}
          value={show(sinOc)}
          label="Entregas sin OC"
          tone={sinOc ? 'text-warn' : undefined}
          onClick={() => onNavigate('entregas-sin-oc')}
        />
        <div className="corner-ticks bg-surface border-2 border-line p-4 flex flex-col justify-between">
          <div className="flex items-start justify-between mb-2">
            <RefreshCw size={16} className={`text-ink-dim ${syncing ? 'animate-spin text-accent' : ''}`} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleTriggerSync()}
              disabled={syncing}
              className="h-6 px-2 text-[9px] font-mono font-bold uppercase tracking-wider text-accent border border-accent/40 hover:bg-accent hover:text-bg transition-colors"
              title="Disparar sincronización con Odoo ahora"
            >
              {syncing ? `${syncElapsed}s` : 'Sincronizar'}
            </Button>
          </div>
          <div>
            <p className={`font-display font-black italic leading-none text-2xl ${isError ? 'text-danger' : isStale ? 'text-warn' : 'text-ink'}`}>
              {effectiveLastSyncDate ? formatRelativeTime(effectiveLastSyncDate) : '—'}
            </p>
            <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mt-2">
              {isError ? 'Sync Odoo · Fallo' : isStale ? 'Sync Odoo · Desactualizado' : 'Último sync Odoo'}
            </p>
          </div>
        </div>
      </motion.section>

      {/* ── Selector de Compañía para Widgets Analíticos ── */}
      {partnersList.length > 0 && (
        <motion.section variants={item} className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase font-bold tracking-widest text-ink-dim flex items-center gap-1.5 mr-2">
            <Building2 size={13} className="text-accent" />
            Filtrar análisis por:
          </span>
          <button
            type="button"
            onClick={() => setSelectedPartnerKey('ALL')}
            className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider border-2 transition-colors ${
              selectedPartnerKey === 'ALL'
                ? 'border-accent bg-accent text-bg'
                : 'border-line bg-surface text-ink hover:border-accent hover:text-accent'
            }`}
          >
            Todas ({totalToInvoiceOrders})
          </button>
          {partnersList.map((p) => {
            const isSelected = selectedPartnerKey === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setSelectedPartnerKey(p.key)}
                className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider border-2 transition-colors flex items-center gap-1.5 ${
                  isSelected
                    ? 'border-accent bg-accent text-bg'
                    : 'border-line bg-surface text-ink hover:border-accent hover:text-accent'
                }`}
              >
                <span className="max-w-[150px] truncate">{p.name}</span>
                <span
                  className={`font-mono text-[9px] px-1 py-0.2 ${
                    isSelected ? 'bg-bg text-accent font-bold' : 'bg-surface-2 text-ink-dim'
                  }`}
                >
                  {p.toInvoiceCount}
                </span>
              </button>
            );
          })}
        </motion.section>
      )}

      {/* ── Widgets Operativos: Carga por Requisitor & Semáforo de Antigüedad ── */}
      <motion.section variants={item} className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Widget 1: Carga de Piezas por Requisitor */}
        <div className="corner-ticks bg-surface border-2 border-line p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-4 pb-2 border-b border-line/60">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-accent" />
              <h2 className="font-display font-bold uppercase text-sm tracking-wide">
                Carga por Requisitor / Ingeniero
              </h2>
            </div>
            <span className="font-mono text-[10px] text-ink-dim uppercase">Piezas pendientes</span>
          </div>

          <div className="py-2">
            {loadingOrders ? (
              <p className="font-mono text-[10px] text-ink-dim py-6 text-center">Calculando distribución…</p>
            ) : requisitorChartData.length === 0 ? (
              <p className="font-mono text-[10px] text-ink-dim py-6 text-center">Sin órdenes activas.</p>
            ) : (
              <BarChart data={requisitorChartData} colorVar="--color-accent" />
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-line/40 flex items-center justify-between">
            <span className="font-mono text-[10px] text-ink-dim">
              Mostrando top {requisitorChartData.length} solicitantes
            </span>
            <button
              type="button"
              onClick={() => onNavigate('odoo')}
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase font-bold text-accent hover:underline"
            >
              <span>Ver en Órdenes</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </div>

        {/* Widget 2: Semáforo de Antigüedad (Aging) */}
        <div className="corner-ticks bg-surface border-2 border-line p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-4 pb-2 border-b border-line/60">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-accent" />
              <h2 className="font-display font-bold uppercase text-sm tracking-wide">
                Semáforo de Antigüedad (Aging)
              </h2>
            </div>
            <span className="font-mono text-[10px] text-ink-dim uppercase">
              {agingStats.totalOrders} {agingStats.totalOrders === 1 ? 'orden' : 'órdenes'}
            </span>
          </div>

          <div className="space-y-3 py-1">
            {/* Barra segmentada */}
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

            {/* Desglose de 3 columnas */}
            <div className="grid grid-cols-3 gap-2 pt-2 text-center">
              <div className="bg-surface-2 border border-line p-2.5">
                <span className="inline-block w-2 h-2 rounded-full bg-ok mb-1" />
                <p className="font-display font-black text-xl text-ok leading-none">{agingStats.recent}</p>
                <p className="font-mono text-[9px] uppercase tracking-wider text-ink-dim mt-1">&lt; 7 días</p>
                <p className="font-mono text-[9px] text-ink-dim/80">{agingStats.pctRecent}%</p>
              </div>

              <div className="bg-surface-2 border border-line p-2.5">
                <span className="inline-block w-2 h-2 rounded-full bg-warn mb-1" />
                <p className="font-display font-black text-xl text-warn leading-none">{agingStats.mid}</p>
                <p className="font-mono text-[9px] uppercase tracking-wider text-ink-dim mt-1">7–15 días</p>
                <p className="font-mono text-[9px] text-ink-dim/80">{agingStats.pctMid}%</p>
              </div>

              <div className="bg-surface-2 border border-line p-2.5">
                <span className="inline-block w-2 h-2 rounded-full bg-danger mb-1" />
                <p className="font-display font-black text-xl text-danger leading-none">{agingStats.critical}</p>
                <p className="font-mono text-[9px] uppercase tracking-wider text-ink-dim mt-1">&gt; 15 días</p>
                <p className="font-mono text-[9px] text-ink-dim/80">{agingStats.pctCritical}%</p>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-line/40 flex items-center justify-between">
            <span className="font-mono text-[10px] text-ink-dim">
              {agingStats.critical > 0 ? (
                <strong className="text-danger">{agingStats.critical} órdenes requieren atención urgente</strong>
              ) : (
                <span className="text-ok">Tiempos de entrega en rango normal</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('odoo')}
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase font-bold text-accent hover:underline"
            >
              <span>Ver Órdenes</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </motion.section>

      {/* ── Accesos Rápidos y Última Auditoría ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Accesos rápidos */}
        <motion.section variants={item} className="space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[2px] text-ink-dim mb-1">Módulos del Taller</p>
          <QuickAction
            icon={ScanLine}
            title="Generar Reporte"
            desc="Auditar planos y generar reporte PDF con recorte de isométricos"
            onClick={() => onNavigate('reporte')}
          />
          <QuickAction
            icon={Library}
            title="Biblioteca Tool Crib"
            desc="Catálogo de planos CAD/ISO, visor 3D STL e historial de impresiones"
            onClick={() => onNavigate('biblioteca')}
          />
          <QuickAction
            icon={ShoppingCart}
            title="Compras & Materiales"
            desc="Catálogo de metales, ensambles, herramientas e insumos"
            onClick={() => onNavigate('compras')}
          />
        </motion.section>

        {/* Resumen del sistema o última auditoría */}
        <motion.section variants={item} className="space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[2px] text-ink-dim mb-1">Estado de Sesión</p>
          {analysisSummary ? (
            <div className="corner-ticks bg-surface border-2 border-line p-5">
              <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mb-3">Última auditoría de visión</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat n={analysisSummary.totalOrders} l="Órdenes" />
                <Stat n={analysisSummary.totalAudited} l="Auditadas" tone="text-accent" />
                <Stat n={analysisSummary.totalAnalyzed} l="Planos" />
              </div>
            </div>
          ) : (
            <div className="corner-ticks bg-surface border-2 border-line p-5 flex flex-col justify-between h-[calc(100%-24px)]">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Activity size={16} className="text-ok" />
                  <h3 className="font-display font-bold uppercase text-sm">Flujo de Producción Activo</h3>
                </div>
                <p className="font-mono text-xs text-ink-dim leading-relaxed">
                  Sistema conectado a Firestore y Odoo. Puedes iniciar la auditoría de planos o consultar el catálogo de Tool Crib para imprimir órdenes de trabajo.
                </p>
              </div>

              <div className="pt-4 border-t border-line/60 flex items-center justify-between">
                <span className="font-mono text-[10px] text-ink-dim flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
                  Listo para auditar
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('reporte')}
                  className="font-mono text-[11px] font-bold text-accent uppercase hover:underline inline-flex items-center gap-1"
                >
                  <span>Iniciar reporte</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
          )}
        </motion.section>
      </div>
    </motion.div>
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
      <p className={`font-display font-black italic leading-none text-4xl ${tone}`}>
        {value}
      </p>
      <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mt-2">{label}</p>
    </>
  );

  if (!onClick) {
    return <div className="corner-ticks bg-surface border-2 border-line p-4">{body}</div>;
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2, boxShadow: '4px 4px 0px var(--color-accent)' }}
      whileTap={{ y: 0, boxShadow: '0px 0px 0px var(--color-accent)' }}
      className="group corner-ticks bg-surface border-2 border-line p-4 text-left transition-colors hover:border-accent outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {body}
    </motion.button>
  );
}

function Stat({ n, l, tone = 'text-ink' }: { n: number | string; l: string; tone?: string }) {
  return (
    <div>
      <p className={`font-display font-black text-2xl italic leading-none ${tone}`}>{n}</p>
      <p className="font-mono text-[9px] uppercase tracking-wider text-ink-dim mt-1">{l}</p>
    </div>
  );
}

function QuickAction({ icon: Icon, title, desc, onClick }: { icon: LucideIcon; title: string; desc: string; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.02, x: 4, boxShadow: '4px 4px 0px var(--color-accent)' }}
      whileTap={{ scale: 0.98, x: 0, boxShadow: '0px 0px 0px var(--color-accent)' }}
      className="w-full text-left bg-surface border-2 border-line p-4 flex items-center gap-4 transition-colors hover:border-accent group outline-none focus-visible:ring-2 focus-visible:ring-accent relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <span className="grid place-items-center w-10 h-10 bg-surface-2 border-2 border-line group-hover:border-accent group-hover:bg-accent group-hover:text-bg transition-colors shrink-0">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <h3 className="font-display font-black text-[15px] uppercase tracking-wide group-hover:text-accent transition-colors">{title}</h3>
        <p className="font-mono text-[10px] text-ink-dim truncate">{desc}</p>
      </div>
      <ArrowRight size={16} className="ml-auto text-ink-dim opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all group-hover:text-accent" />
    </motion.button>
  );
}
