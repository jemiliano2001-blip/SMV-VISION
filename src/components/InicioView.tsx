/**
 * InicioView — portada / resumen de producción.
 *
 * Lee el resumen de `useDashboardSummary` (solo lectura) y ofrece:
 *  - banda de KPIs (vencidas, críticas, urgentes, en proceso, pendientes, % a tiempo),
 *  - "atención inmediata" → salta a Control con el filtro de alerta puesto,
 *  - accesos rápidos a las demás vistas.
 */

import type { ReactElement } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle, Clock, Flame, Cog, Inbox, Gauge,
  ScanLine, ClipboardList, Library, ArrowRight, AlertCircle, Loader2,
} from 'lucide-react';

import type { DashboardSummary } from '../lib/useDashboardSummary';
import type { DueDateSeverity } from '../lib/workOrders/metrics';
import { getDueDateSeverity, dueDaysLabel } from '../lib/workOrders/metrics';
import type { AnalysisRunSummary } from '../types';
import type { AppView } from './shell/AppShell';

export type AlertSeverity = 'overdue' | 'critical' | 'warning';

export interface InicioViewProps {
  summary: DashboardSummary;
  onNavigate: (view: AppView) => void;
  onFocusAlert: (sev: AlertSeverity) => void;
  analysisSummary: AnalysisRunSummary | null;
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 30 } },
} as const;

interface KpiDef {
  key: string;
  label: string;
  value: number | string;
  icon: typeof Flame;
  tone: 'danger' | 'warn' | 'accent' | 'draft' | 'ink' | 'ok';
  onClick?: () => void;
}

const TONE: Record<KpiDef['tone'], { num: string; ring: string; icon: string }> = {
  danger: { num: 'text-danger', ring: 'hover:border-danger', icon: 'text-danger' },
  warn:   { num: 'text-warn',   ring: 'hover:border-warn',   icon: 'text-warn' },
  accent: { num: 'text-accent', ring: 'hover:border-accent', icon: 'text-accent' },
  draft:  { num: 'text-draft',  ring: 'hover:border-draft',  icon: 'text-draft' },
  ink:    { num: 'text-ink',    ring: 'hover:border-ink',    icon: 'text-ink-dim' },
  ok:     { num: 'text-ok',     ring: 'hover:border-ok',     icon: 'text-ok' },
};

const SEV_CHIP: Record<AlertSeverity, string> = {
  overdue: 'bg-danger/15 text-danger border-danger',
  critical: 'bg-accent/15 text-accent border-accent',
  warning: 'bg-warn/15 text-warn border-warn',
};

export function InicioView({ summary, onNavigate, onFocusAlert, analysisSummary }: InicioViewProps): ReactElement {
  const { counts, metrics, attention, status, reason } = summary;

  const kpis: KpiDef[] = [
    { key: 'overdue', label: 'Vencidas', value: counts.overdue, icon: AlertTriangle, tone: 'danger', onClick: () => onFocusAlert('overdue') },
    { key: 'critical', label: 'Críticas ≤3d', value: counts.critical, icon: Clock, tone: 'warn', onClick: () => onFocusAlert('critical') },
    { key: 'urgent', label: 'Urgentes', value: counts.urgent, icon: Flame, tone: 'accent', onClick: () => onNavigate('control') },
    { key: 'inproc', label: 'En proceso', value: counts.enProceso, icon: Cog, tone: 'draft', onClick: () => onNavigate('control') },
    { key: 'pend', label: 'Pendientes', value: counts.pendiente, icon: Inbox, tone: 'ink', onClick: () => onNavigate('control') },
    { key: 'ontime', label: '% A tiempo', value: metrics.onTimePct !== null ? `${metrics.onTimePct}%` : '—', icon: Gauge, tone: 'ok' },
  ];

  const now = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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
          <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-1">Resumen de Producción</p>
          <h1 className="font-display font-black text-5xl lg:text-6xl uppercase italic tracking-[-2px] leading-none">
            Inicio
          </h1>
        </div>
        <p className="font-mono text-[11px] text-ink-dim capitalize">{now}</p>
      </motion.header>

      {/* ── Aviso de datos no disponibles ── */}
      {status === 'error' && (
        <motion.div variants={item} className="mb-6 flex items-start gap-2 border-2 border-warn/60 bg-warn/10 px-4 py-3 text-[12px] font-mono text-warn">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>
            {reason === 'not-configured'
              ? 'Firebase no está configurado: el resumen de control no está disponible. Completa VITE_FIREBASE_* en .env.local.'
              : reason === 'not-authenticated'
                ? 'Inicia sesión para ver el resumen de órdenes en producción.'
                : 'No fue posible cargar el resumen de órdenes. Revisa tu conexión.'}
          </span>
        </motion.div>
      )}
      {status === 'loading' && (
        <motion.div variants={item} className="mb-6 flex items-center gap-2 text-ink-dim font-mono text-[12px]">
          <Loader2 size={14} className="animate-spin" /> Cargando resumen…
        </motion.div>
      )}

      {/* ── KPIs ── */}
      <motion.section variants={item} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
        {kpis.map((kpi) => {
          const tone = TONE[kpi.tone];
          const Icon = kpi.icon;
          const clickable = !!kpi.onClick;
          return (
            <motion.button
              key={kpi.key}
              variants={item}
              type="button"
              onClick={kpi.onClick}
              disabled={!clickable}
              whileHover={clickable ? { y: -3 } : undefined}
              className={`corner-ticks text-left bg-surface border-2 border-line p-4 transition-colors ${tone.ring} ${
                clickable ? 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent' : 'cursor-default'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim">{kpi.label}</span>
                <Icon size={16} className={tone.icon} />
              </div>
              <p className={`font-display font-black text-5xl italic leading-none ${tone.num}`}>{kpi.value}</p>
            </motion.button>
          );
        })}
      </motion.section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Atención inmediata ── */}
        <motion.section variants={item} className="lg:col-span-2 bg-surface border-2 border-line">
          <header className="flex items-center justify-between px-4 py-3 border-b-2 border-line">
            <h2 className="font-display font-black text-[15px] uppercase tracking-wide flex items-center gap-2">
              <AlertTriangle size={16} className="text-accent" /> Atención inmediata
            </h2>
            <span className="font-mono text-[10px] text-ink-dim">{attention.length} órdenes</span>
          </header>
          <div className="divide-y divide-line max-h-[440px] overflow-y-auto">
            {attention.length === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-[11px] text-ink-dim">
                {status === 'ready' ? 'Nada urgente. Todo bajo control. ✓' : '—'}
              </p>
            ) : (
              attention.slice(0, 12).map((o) => {
                const sev = getDueDateSeverity(o.dueDate, o.status) as DueDateSeverity;
                const sevKey: AlertSeverity = sev === 'overdue' ? 'overdue' : sev === 'critical' ? 'critical' : 'warning';
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onFocusAlert(sevKey)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-surface-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {o.prioridad === 'URGENTE' && (
                          <span className="bg-accent text-bg px-1 text-[8px] font-black uppercase shrink-0">URG</span>
                        )}
                        <p className="text-[13px] font-bold uppercase tracking-tight truncate" title={o.pieza}>{o.pieza}</p>
                      </div>
                      <p className="font-mono text-[10px] text-ink-dim truncate">
                        SO {o.soNumber || '—'} · {o.numeroParte || 's/parte'}
                      </p>
                    </div>
                    <span className={`shrink-0 font-mono text-[9px] font-bold uppercase px-2 py-1 border ${SEV_CHIP[sevKey]}`}>
                      {dueDaysLabel(o.dueDate) || 'sin fecha'}
                    </span>
                    <ArrowRight size={14} className="text-ink-dim shrink-0" />
                  </button>
                );
              })
            )}
          </div>
        </motion.section>

        {/* ── Accesos rápidos + última corrida ── */}
        <motion.section variants={item} className="space-y-3">
          <QuickAction icon={ScanLine} title="Subir pedidos" desc="Generar reporte y auditar planos" onClick={() => onNavigate('reporte')} />
          <QuickAction icon={ClipboardList} title="Ver control" desc="Tablero de órdenes en producción" onClick={() => onNavigate('control')} />
          <QuickAction icon={Library} title="Biblioteca" desc="Catálogo de planos Tool Crib" onClick={() => onNavigate('biblioteca')} />

          {analysisSummary && (
            <div className="corner-ticks bg-surface border-2 border-line p-4">
              <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mb-3">Última auditoría</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat n={analysisSummary.totalOrders} l="Órdenes" />
                <Stat n={analysisSummary.totalAudited} l="Auditadas" tone="text-accent" />
                <Stat n={analysisSummary.totalAnalyzed} l="Planos" />
              </div>
            </div>
          )}
        </motion.section>
      </div>
    </motion.div>
  );
}

function QuickAction({ icon: Icon, title, desc, onClick }: { icon: typeof ScanLine; title: string; desc: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left bg-surface border-2 border-line hover:border-accent p-4 flex items-center gap-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="grid place-items-center w-11 h-11 bg-surface-2 border-2 border-line group-hover:border-accent group-hover:text-accent transition-colors shrink-0">
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display font-black text-[14px] uppercase tracking-wide">{title}</p>
        <p className="font-mono text-[10px] text-ink-dim truncate">{desc}</p>
      </div>
      <ArrowRight size={18} className="text-ink-dim group-hover:text-accent group-hover:translate-x-1 transition-all shrink-0" />
    </button>
  );
}

function Stat({ n, l, tone = 'text-ink' }: { n: number; l: string; tone?: string }): ReactElement {
  return (
    <div>
      <p className={`font-display font-black text-2xl italic leading-none ${tone}`}>{n}</p>
      <p className="font-mono text-[8px] uppercase tracking-widest text-ink-dim mt-1">{l}</p>
    </div>
  );
}
