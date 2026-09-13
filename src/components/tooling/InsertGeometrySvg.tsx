import { useId, type ReactElement } from 'react';
import type { InsertShapeCode } from '../../lib/tooling/types';

interface InsertGeometrySvgProps {
  shape: InsertShapeCode;
  points: { x: number; y: number }[];
  size?: number;
  hasHole?: boolean;
  className?: string;
  /** Ángulo de incidencia/desahogo ISO (posición 2 del código), en grados. */
  clearanceAngleDegrees?: number;
  clearanceType?: 'negative' | 'positive';
  /** Radio de punta en mm, si se conoce (posición de radio del código ISO/ANSI). */
  noseRadiusMm?: number;
  /** true si el radio fue estimado por heurística de rango, no por fórmula exacta. */
  noseRadiusIsEstimate?: boolean;
  /** Vértice activo (índice de `points`) para los callouts de desahogo/radio. Default: el más alejado del centro (o el último para C/D). */
  activeCornerIndex?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Elige el vértice "activo" (la esquina de corte que se ilustra con el callout
 * de desahogo y el arco de radio de punta). Para rombos (C/D) es la punta más
 * aguda, que por convención de `isoInsertDecoder.generateSvgPoints` queda al
 * final del arreglo; para el resto se usa el vértice más lejano del centro.
 */
function resolveActiveCornerIndex(
  shape: InsertShapeCode,
  points: { x: number; y: number }[],
  activeCornerIndex?: number
): number {
  if (activeCornerIndex !== undefined && activeCornerIndex >= 0 && activeCornerIndex < points.length) {
    return activeCornerIndex;
  }
  if ((shape === 'C' || shape === 'D') && points.length > 0) {
    return points.length - 1;
  }
  let bestIdx = 0;
  let bestDist = -Infinity;
  points.forEach((p, idx) => {
    const dist = Math.hypot(p.x - 50, p.y - 50);
    if (dist > bestDist) {
      bestDist = dist;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

export function InsertGeometrySvg({
  shape,
  points,
  size = 140,
  hasHole = true,
  className = '',
  clearanceAngleDegrees,
  clearanceType,
  noseRadiusMm,
  noseRadiusIsEstimate,
  activeCornerIndex,
}: InsertGeometrySvgProps): ReactElement {
  const uid = useId().replace(/:/g, '');
  const goldGradId = `goldCarbideGrad-${uid}`;
  const edgeHighlightId = `edgeHighlight-${uid}`;

  const pointsString = points.map(p => `${p.x},${p.y}`).join(' ');
  const isRound = shape === 'R';
  const activeIdx = points.length > 0 ? resolveActiveCornerIndex(shape, points, activeCornerIndex) : -1;
  const activePoint = activeIdx >= 0 ? points[activeIdx] : undefined;

  // ── Callout de ángulo de desahogo/incidencia (posición 2 ISO) ──
  let clearanceArc: { path: string; labelX: number; labelY: number; label: string } | undefined;
  if (!isRound && activePoint && clearanceAngleDegrees !== undefined) {
    const outwardAngleRad = Math.atan2(activePoint.y - 50, activePoint.x - 50);
    const clearanceRad = (clearanceAngleDegrees * Math.PI) / 180;
    const flankAngleRad = outwardAngleRad + Math.max(clearanceRad, (6 * Math.PI) / 180);
    const arcRadius = 10;
    const arcStart = { x: activePoint.x + arcRadius * Math.cos(outwardAngleRad), y: activePoint.y + arcRadius * Math.sin(outwardAngleRad) };
    const arcEnd = { x: activePoint.x + arcRadius * Math.cos(flankAngleRad), y: activePoint.y + arcRadius * Math.sin(flankAngleRad) };
    const labelAngle = outwardAngleRad + (flankAngleRad - outwardAngleRad) / 2;
    const labelRadius = arcRadius + 9;
    clearanceArc = {
      path: `M ${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)} A ${arcRadius} ${arcRadius} 0 0 1 ${arcEnd.x.toFixed(2)} ${arcEnd.y.toFixed(2)}`,
      labelX: activePoint.x + labelRadius * Math.cos(labelAngle),
      labelY: activePoint.y + labelRadius * Math.sin(labelAngle),
      label: clearanceType === 'negative' && clearanceAngleDegrees === 0 ? '0° neg' : `${clearanceAngleDegrees}°`,
    };
  }

  // ── Arco de radio de punta en el vértice activo ──
  const noseRadiusPx = noseRadiusMm !== undefined ? clamp(noseRadiusMm * 6, 2.5, 11) : undefined;

  // ── Filo de corte resaltado (segmento que entra al vértice activo) ──
  let highlightedEdge: { x1: number; y1: number; x2: number; y2: number } | undefined;
  if (!isRound && activePoint && points.length > 1 && activeIdx >= 0) {
    const prevIdx = (activeIdx - 1 + points.length) % points.length;
    const prevPoint = points[prevIdx];
    highlightedEdge = { x1: prevPoint.x, y1: prevPoint.y, x2: activePoint.x, y2: activePoint.y };
  }

  const radiusBadge = noseRadiusMm === undefined ? '' : noseRadiusIsEstimate ? ' · R?' : ` · R${noseRadiusMm.toFixed(1).replace(/\.0$/, '')}`;

  return (
    <div className={`relative inline-flex items-center justify-center bg-surface-2 border-2 border-line p-3 shadow-hard ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="overflow-visible drop-shadow-[0_4px_8px_rgba(0,0,0,0.15)]"
        role="img"
        aria-label={`Geometría de inserto forma ${shape}${clearanceAngleDegrees !== undefined ? `, desahogo ${clearanceAngleDegrees}°` : ''}${noseRadiusMm !== undefined ? `, radio de punta ${noseRadiusMm.toFixed(1)}mm` : ''}`}
      >
        <defs>
          <linearGradient id={goldGradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="40%" stopColor="#D97706" />
            <stop offset="80%" stopColor="#B45309" />
            <stop offset="100%" stopColor="#78350F" />
          </linearGradient>
          <linearGradient id={edgeHighlightId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FEF3C7" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#D97706" stopOpacity="0.25" />
          </linearGradient>
        </defs>

        {/* Cuerpo del Inserto */}
        {isRound ? (
          <circle
            cx="50"
            cy="50"
            r="38"
            fill={`url(#${goldGradId})`}
            stroke="#1E293B"
            strokeWidth="3"
          />
        ) : (
          <polygon
            points={pointsString}
            fill={`url(#${goldGradId})`}
            stroke="#1E293B"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        )}

        {/* Filo de corte activo resaltado */}
        {highlightedEdge && (
          <line
            x1={highlightedEdge.x1}
            y1={highlightedEdge.y1}
            x2={highlightedEdge.x2}
            y2={highlightedEdge.y2}
            stroke={`url(#${edgeHighlightId})`}
            strokeWidth="4.5"
            strokeLinecap="round"
            opacity="0.9"
          />
        )}

        {/* Agujero Central Torx / Clamp */}
        {hasHole && (
          <>
            <circle
              cx="50"
              cy="50"
              r="14"
              fill="#0F172A"
              stroke="#D97706"
              strokeWidth="1.5"
            />
            <circle
              cx="50"
              cy="50"
              r="8"
              fill="#020617"
            />
          </>
        )}

        {/* Resalte de filos de corte (vértices no activos) — omitido en insertos redondos */}
        {!isRound &&
          points.map((p, idx) =>
            idx === activeIdx ? null : (
              <circle
                key={idx}
                cx={p.x}
                cy={p.y}
                r="3.5"
                fill="#EF4444"
                stroke="#FFFFFF"
                strokeWidth="1"
              />
            )
          )}

        {/* Arco de radio de punta en el vértice activo (no aplica a forma R) */}
        {!isRound && activePoint && noseRadiusPx !== undefined && (
          <circle
            cx={activePoint.x}
            cy={activePoint.y}
            r={noseRadiusPx}
            fill="#FFFFFF"
            fillOpacity="0.15"
            className="stroke-ok"
            strokeWidth="1.6"
          />
        )}
        {!isRound && activePoint && noseRadiusPx === undefined && (
          <circle
            cx={activePoint.x}
            cy={activePoint.y}
            r="3.5"
            fill="#EF4444"
            stroke="#FFFFFF"
            strokeWidth="1"
          />
        )}

        {/* Callout del ángulo de desahogo/incidencia */}
        {clearanceArc && (
          <>
            <path d={clearanceArc.path} fill="none" className="stroke-ink" strokeWidth="1.4" />
            <text
              x={clearanceArc.labelX}
              y={clearanceArc.labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="7"
              fontWeight="800"
              className="fill-ink font-mono"
            >
              {clearanceArc.label}
            </text>
          </>
        )}
      </svg>
      <div className="absolute bottom-1 right-2 font-mono text-[9px] text-ink-dim uppercase tracking-wider font-bold">
        {shape} ISO{radiusBadge}
      </div>
    </div>
  );
}
