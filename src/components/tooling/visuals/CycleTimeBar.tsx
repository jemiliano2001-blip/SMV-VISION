import type { ReactElement } from 'react';
import { formatSecondsToTime } from '../../../lib/tooling/cycleTimeCalculator';

export interface CycleSegment {
  label: string;
  seconds: number;
  /** Clase Tailwind de fondo, ej. 'bg-accent'. */
  colorClass: string;
  /** Nota corta para el tooltip, ej. "aprox. 12 % del corte". */
  note?: string;
}

interface CycleTimeBarProps {
  segments: CycleSegment[];
  className?: string;
}

/**
 * Barra apilada del ciclo por pieza: cuánto es corte real y cuánto es tiempo
 * "muerto" (rápidos, cambios de herramienta, carga). Lo que conviene atacar
 * primero para bajar el costo se ve de un vistazo.
 */
export function CycleTimeBar({ segments, className = '' }: CycleTimeBarProps): ReactElement {
  const total = segments.reduce((acc, s) => acc + Math.max(s.seconds, 0), 0);
  const cutting = segments[0]?.seconds ?? 0;
  const cuttingShare = total > 0 ? Math.round((cutting / total) * 100) : 0;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim font-bold">Composición del ciclo</span>
        <span className="font-mono text-[10px] text-ink">
          Corte real <strong className="text-accent">{cuttingShare}%</strong> de {formatSecondsToTime(total)}
        </span>
      </div>
      <div className="flex h-5 w-full overflow-hidden rounded-md border border-line bg-surface-2" role="img" aria-label={`Ciclo ${formatSecondsToTime(total)}: ${segments.map((s) => `${s.label} ${formatSecondsToTime(s.seconds)}`).join(', ')}`}>
        {segments.map((s) => {
          const pct = total > 0 ? (Math.max(s.seconds, 0) / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <div
              key={s.label}
              className={`${s.colorClass} h-full transition-[width] duration-300`}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${formatSecondsToTime(s.seconds)} (${Math.round(pct)}%)${s.note ? ` · ${s.note}` : ''}`}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 font-mono text-[10px] text-ink-dim">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.colorClass}`} aria-hidden="true" />
            {s.label} <strong className="text-ink">{formatSecondsToTime(s.seconds)}</strong>
            {s.note && <span className="opacity-70">({s.note})</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
