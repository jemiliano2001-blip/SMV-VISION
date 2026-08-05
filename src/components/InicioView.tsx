/**
 * InicioView — portada / resumen.
 *
 * Contesta "¿qué hay hoy?" con tres cifras que ya viven en Firestore y ofrece
 * accesos rápidos a las demás vistas.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { motion } from 'motion/react';
import {
  ScanLine, Library, ArrowRight, CloudDownload, ShoppingCart, FileWarning, RefreshCw,
  type LucideIcon,
} from 'lucide-react';

import { listOrdersToInvoice, listEntregasSinOC } from '../lib/firebase/odooOrders';
import { formatRelativeTime } from '../lib/age';
import { useSyncMeta } from '../hooks/useSyncMeta';
import type { AnalysisRunSummary } from '../types';
import type { AppView } from './shell/AppShell';

export interface InicioViewProps {
  onNavigate: (view: AppView) => void;
  analysisSummary: AnalysisRunSummary | null;
}

/** Por cifra: `undefined` = cargando · `null` = la consulta falló · número = dato bueno. */
interface Counts {
  pendientes: number | null;
  sinOc: number | null;
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 30 } },
} as const;

function show(n: number | null | undefined): string {
  if (n === undefined) return '…';
  if (n === null) return '—';
  return String(n);
}

export function InicioView({ onNavigate, analysisSummary }: InicioViewProps): ReactElement {
  const now = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const { meta } = useSyncMeta();
  const [counts, setCounts] = useState<Counts | undefined>(undefined);

  // ponytail: relee en cada visita — App.tsx desmonta Inicio al navegar. Sin caché ni
  // auto-refresh. Si la doble lectura de listEntregasSinOC (hasta 1000 docs, filtra en
  // cliente) llega a molestar, subir el estado a App.tsx; hoy nadie lo ha medido.
  useEffect(() => {
    let alive = true;
    void Promise.all([listOrdersToInvoice(), listEntregasSinOC()]).then(([pend, sin]) => {
      if (!alive) return;
      setCounts({
        pendientes: pend.ok ? pend.value.length : null,
        sinOc: sin.ok ? sin.value.length : null,
      });
    });
    return () => { alive = false; };
  }, []);

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
          <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-1">Resumen</p>
          <h1 className="font-display font-black text-5xl lg:text-6xl uppercase italic tracking-[-2px] leading-none">
            Inicio
          </h1>
        </div>
        <p className="font-mono text-[11px] text-ink-dim capitalize">{now}</p>
      </motion.header>

      {/* ── Qué hay hoy ── */}
      <motion.section variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard
          icon={CloudDownload}
          value={show(counts?.pendientes)}
          label="Órdenes pendientes"
          onClick={() => onNavigate('odoo')}
        />
        <StatCard
          icon={FileWarning}
          value={show(counts?.sinOc)}
          label="Entregas sin OC"
          tone={counts?.sinOc ? 'text-warn' : undefined}
          onClick={() => onNavigate('entregas-sin-oc')}
        />
        <StatCard
          icon={RefreshCw}
          value={meta ? formatRelativeTime(meta.lastSyncAt) : '—'}
          label={meta?.status === 'error' ? 'Último sync · ERROR' : 'Último sync Odoo'}
          tone={meta?.status === 'error' ? 'text-danger' : undefined}
          small
        />
      </motion.section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Accesos rápidos ── */}
        <motion.section variants={item} className="space-y-3">
          <QuickAction icon={ScanLine} title="Generar Reporte" desc="Auditar planos y generar reporte PDF" onClick={() => onNavigate('reporte')} />
          <QuickAction icon={Library} title="Biblioteca" desc="Catálogo de planos Tool Crib" onClick={() => onNavigate('biblioteca')} />
          <QuickAction icon={ShoppingCart} title="Compras" desc="Catálogo de compras" onClick={() => onNavigate('compras')} />
        </motion.section>

        {/* ── Última corrida (solo si auditaste en esta sesión) ── */}
        <motion.section variants={item} className="space-y-3">
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

function StatCard({ icon: Icon, value, label, tone = 'text-ink', small = false, onClick }: {
  icon: LucideIcon;
  value: string;
  label: string;
  tone?: string;
  small?: boolean;
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
      <p className={`font-display font-black italic leading-none ${small ? 'text-2xl' : 'text-4xl'} ${tone}`}>
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
