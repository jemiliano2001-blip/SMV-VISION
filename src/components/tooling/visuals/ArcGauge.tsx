import type { ReactElement } from 'react';

interface ArcGaugeProps {
  /** Valor actual (misma unidad que `max`). */
  value: number;
  /** Límite real de la máquina (RPM máx, HP nominal, etc.). */
  max: number;
  label: string;
  unit: string;
  /** Texto debajo del valor, ej. "de 4,000 máx". */
  caption?: string;
  /** Fracción a partir de la cual se pinta ámbar (default 0.7) y rojo (default 0.85). */
  warnAt?: number;
  dangerAt?: number;
  formatValue?: (v: number) => string;
  className?: string;
}

const CX = 60;
const CY = 62;
const R = 46;
const ARC_LEN = Math.PI * R; // semicírculo

function polar(angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + R * Math.cos(a), y: CY - R * Math.sin(a) };
}

/**
 * Gauge semicircular "de tablero": muestra qué porcentaje del límite de la
 * máquina consume el corte. Verde = cómodo, ámbar = al límite, rojo = excede.
 */
export function ArcGauge({
  value,
  max,
  label,
  unit,
  caption,
  warnAt = 0.7,
  dangerAt = 0.85,
  formatValue = (v) => v.toLocaleString(),
  className = '',
}: ArcGaugeProps): ReactElement {
  const safeMax = Math.max(max, 0.0001);
  const ratio = Math.max(value, 0) / safeMax;
  const clamped = Math.min(ratio, 1);
  const over = ratio > 1;

  const tone = over || ratio >= dangerAt ? 'danger' : ratio >= warnAt ? 'warn' : 'ok';
  const strokeClass = tone === 'danger' ? 'stroke-danger' : tone === 'warn' ? 'stroke-warn' : 'stroke-ok';
  const textClass = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ok';

  const start = polar(180);
  const end = polar(0);
  const trackPath = `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const a = 180 - t * 180;
    const outer = polar(a);
    const inner = { x: CX + (R - 7) * Math.cos((a * Math.PI) / 180), y: CY - (R - 7) * Math.sin((a * Math.PI) / 180) };
    return { t, outer, inner };
  });

  return (
    <div className={`flex flex-col items-center ${className}`} role="img" aria-label={`${label}: ${formatValue(value)} ${unit} de ${formatValue(max)}`}>
      <svg viewBox="0 0 120 74" className="w-full max-w-[180px]">
        {/* pista */}
        <path d={trackPath} fill="none" strokeWidth="9" strokeLinecap="round" className="stroke-line" />
        {/* valor */}
        <path
          d={trackPath}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          className={`${strokeClass} transition-[stroke-dashoffset] duration-500 ease-out`}
          strokeDasharray={ARC_LEN}
          strokeDashoffset={ARC_LEN * (1 - clamped)}
        />
        {/* ticks */}
        {ticks.map(({ t, outer, inner }) => (
          <line
            key={t}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            strokeWidth={t === 0.5 || t === 1 || t === 0 ? 1.4 : 0.8}
            className="stroke-ink-dim"
            opacity={0.55}
          />
        ))}
        {/* valor central */}
        <text
          x={CX}
          y={CY - 6}
          textAnchor="middle"
          className={`${textClass} fill-current font-display`}
          fontSize="20"
          fontWeight="800"
        >
          {formatValue(value)}
        </text>
        <text x={CX} y={CY + 6} textAnchor="middle" fontSize="7.5" className="fill-ink-dim font-mono" fontWeight="700">
          {unit}{over ? ' · EXCEDE' : ` · ${Math.round(ratio * 100)}%`}
        </text>
      </svg>
      <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim font-bold -mt-1 text-center">
        {label}
      </span>
      {caption && <span className="font-mono text-[10px] text-ink text-center">{caption}</span>}
    </div>
  );
}
