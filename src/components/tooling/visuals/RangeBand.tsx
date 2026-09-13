import type { ReactElement } from 'react';

interface RangeBandProps {
  value: number;
  /** Rango recomendado [min, max] del catálogo para el material. */
  min: number;
  max: number;
  unit: string;
  label: string;
  /** Texto corto de la fuente del rango, ej. "Sandvik · 4140". */
  sourceHint?: string;
  formatValue?: (v: number) => string;
  className?: string;
}

const W = 320;
const TRACK_Y = 22;
const TRACK_H = 8;
const PAD_X = 8;

/**
 * Banda horizontal: muestra dónde cae el valor capturado respecto al rango
 * recomendado del material. Dentro = verde; fuera = ámbar con la dirección
 * en la que hay que moverse.
 */
export function RangeBand({
  value,
  min,
  max,
  unit,
  label,
  sourceHint,
  formatValue = (v) => v.toLocaleString(),
  className = '',
}: RangeBandProps): ReactElement {
  const safeMin = Math.max(0, Math.min(min, max));
  const safeMax = Math.max(max, safeMin + 0.0001);
  // Dominio: desde 0 hasta 1.35× el máximo, pero siempre incluye el valor.
  const domainHi = Math.max(safeMax * 1.35, value * 1.1, 1);
  const toX = (v: number) => PAD_X + (Math.max(0, Math.min(v, domainHi)) / domainHi) * (W - PAD_X * 2);

  const xMin = toX(safeMin);
  const xMax = toX(safeMax);
  const xVal = toX(value);
  const inRange = value >= safeMin && value <= safeMax;
  const tone = inRange ? 'ok' : 'warn';
  const fillClass = tone === 'ok' ? 'fill-ok' : 'fill-warn';
  const textClass = tone === 'ok' ? 'text-ok' : 'text-warn';
  const status = inRange ? 'EN RANGO' : value < safeMin ? 'BAJO ← subir' : 'ALTO → bajar';

  return (
    <div className={className} role="img" aria-label={`${label}: ${formatValue(value)} ${unit}; recomendado ${formatValue(safeMin)}–${formatValue(safeMax)} ${unit}`}>
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim font-bold">{label}</span>
        <span className={`font-mono text-[10px] font-black ${textClass}`}>{status}</span>
      </div>
      <svg viewBox={`0 0 ${W} 44`} className="w-full">
        {/* pista completa */}
        <rect x={PAD_X} y={TRACK_Y} width={W - PAD_X * 2} height={TRACK_H} rx={4} className="fill-line" />
        {/* banda recomendada */}
        <rect x={xMin} y={TRACK_Y} width={Math.max(xMax - xMin, 2)} height={TRACK_H} rx={4} className="fill-ok" opacity={0.85} />
        {/* límites */}
        <line x1={xMin} y1={TRACK_Y - 4} x2={xMin} y2={TRACK_Y + TRACK_H + 4} strokeWidth={1.2} className="stroke-ok" />
        <line x1={xMax} y1={TRACK_Y - 4} x2={xMax} y2={TRACK_Y + TRACK_H + 4} strokeWidth={1.2} className="stroke-ok" />
        <text x={xMin} y={TRACK_Y + TRACK_H + 14} textAnchor="middle" fontSize="8" className="fill-ink-dim font-mono" fontWeight="700">
          {formatValue(safeMin)}
        </text>
        <text x={xMax} y={TRACK_Y + TRACK_H + 14} textAnchor="middle" fontSize="8" className="fill-ink-dim font-mono" fontWeight="700">
          {formatValue(safeMax)}
        </text>
        {/* marcador del valor actual */}
        <polygon
          points={`${xVal},${TRACK_Y - 2} ${xVal - 6},${TRACK_Y - 11} ${xVal + 6},${TRACK_Y - 11}`}
          className={`${fillClass} transition-transform duration-300`}
        />
        <line x1={xVal} y1={TRACK_Y - 2} x2={xVal} y2={TRACK_Y + TRACK_H + 2} strokeWidth={2} className={tone === 'ok' ? 'stroke-ink' : 'stroke-warn'} />
        <text
          x={xVal}
          y={8}
          textAnchor={xVal > W - 50 ? 'end' : xVal < 50 ? 'start' : 'middle'}
          fontSize="9"
          className="fill-ink font-mono"
          fontWeight="800"
        >
          {formatValue(value)} {unit}
        </text>
      </svg>
      {sourceHint && (
        <p className="font-mono text-[9px] text-ink-dim -mt-1 truncate" title={sourceHint}>
          Rango: {sourceHint}
        </p>
      )}
    </div>
  );
}
