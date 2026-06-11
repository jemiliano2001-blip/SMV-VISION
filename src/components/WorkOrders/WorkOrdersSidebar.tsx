import React, { type ReactElement } from 'react';
import { BarChart2, Users, X, Plus } from 'lucide-react';
import type { Tornero } from '../../types';

interface MetricProps {
  label: string;
  value: string;
  tone: string;
}

function Metric({ label, value, tone }: MetricProps): ReactElement {
  return (
    <div className="border border-line bg-surface-2 p-2.5">
      <p className="text-[9px] font-mono uppercase tracking-wider text-ink-dim mb-1">{label}</p>
      <p className={`font-display font-black text-2xl italic leading-none ${tone}`}>{value}</p>
    </div>
  );
}

export interface WorkOrdersSidebarProps {
  showPanel: boolean;
  setShowPanel: (show: boolean) => void;
  metrics: {
    avgCycleDays: number | null;
    onTimePct: number | null;
    latePct: number | null;
    inProgressCount: number;
    deliveredCount: number;
  };
  activeTorneros: Tornero[];
  torneros: Tornero[];
  newTornero: string;
  setNewTornero: (val: string) => void;
  onAddTornero: () => void;
  onToggleTornero: (t: Tornero) => void;
}

export function WorkOrdersSidebar({
  showPanel,
  setShowPanel,
  metrics,
  activeTorneros,
  torneros,
  newTornero,
  setNewTornero,
  onAddTornero,
  onToggleTornero,
}: WorkOrdersSidebarProps): ReactElement | null {
  if (!showPanel) return null;

  return (
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
                onKeyDown={(e) => { if (e.key === 'Enter') void onAddTornero(); }}
                placeholder="Nombre del tornero"
                className="grow border border-line bg-surface-2 text-ink px-2 py-1.5 text-[12px] font-mono outline-none placeholder:text-ink-dim/70"
              />
              <button type="button" onClick={() => void onAddTornero()}
                className="border-2 border-accent bg-accent text-bg px-3 py-1.5 text-[10px] font-black uppercase flex items-center gap-1 hover:bg-accent/80 transition-colors">
                <Plus size={12} /> Agregar
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {torneros.map((t) => (
                <button key={t.id} type="button" onClick={() => void onToggleTornero(t)}
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
  );
}
