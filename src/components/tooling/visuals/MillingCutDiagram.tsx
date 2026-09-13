import { useId, type ReactElement } from 'react';

interface MillingCutDiagramProps {
  /** Diámetro de la fresa D (mm). */
  toolDiameterMm: number;
  numberOfFlutes: number;
  /** Paso radial ae (mm). */
  radialDepthMm: number;
  /** Profundidad axial ap (mm). */
  axialDepthMm: number;
  /** Ángulo de contacto θ (grados) ya calculado por el motor. */
  engagementAngleDeg: number;
  rpm: number;
  /** Etiquetas ya formateadas en el sistema de unidades activo. */
  labels: {
    diameter: string;
    radial: string;
    axial: string;
    feed: string;
  };
  className?: string;
}

const VB_W = 420;
const VB_H = 230;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Dos vistas del fresado periférico: planta (la fresa entrando `ae` en la
 * pared, con el arco de contacto resaltado) y alzado (la profundidad `ap`).
 * La fresa gira a una velocidad proporcional a las RPM (respeta
 * prefers-reduced-motion vía la regla global de index.css).
 */
export function MillingCutDiagram({
  toolDiameterMm,
  numberOfFlutes,
  radialDepthMm,
  axialDepthMm,
  engagementAngleDeg,
  rpm,
  labels,
  className = '',
}: MillingCutDiagramProps): ReactElement {
  const uid = useId().replace(/:/g, '');
  const arrowId = `arrow-${uid}`;
  const hatchId = `hatch-${uid}`;
  const clipId = `clip-${uid}`;

  const D = Math.max(toolDiameterMm, 0.5);
  const Z = clamp(Math.round(numberOfFlutes), 1, 8);
  const aeRatio = clamp(radialDepthMm / D, 0.02, 1);

  // ── Vista en planta (izquierda) ─────────────────────────────────────────
  const R = clamp(D * 2.6, 26, 62);
  const WALL_Y = 112; // borde superior de la pieza (pared que se está fresando)
  const CX = 150;
  const aePx = aeRatio * 2 * R;
  const CYtool = WALL_Y - R + aePx; // el centro baja conforme entra más ae
  // Intersección del círculo con la pared
  const dy = WALL_Y - CYtool;
  const halfChord = Math.sqrt(Math.max(R * R - dy * dy, 0));
  const xl = CX - halfChord;
  const xr = CX + halfChord;
  const largeArc = aePx > R ? 1 : 0;
  const engagementArc = `M ${xl} ${WALL_Y} A ${R} ${R} 0 ${largeArc} 0 ${xr} ${WALL_Y}`;

  const flutes = Array.from({ length: Z }, (_, i) => {
    const a = (i / Z) * Math.PI * 2;
    const a2 = a + 0.9; // hélice: el filo se curva
    const ix = CX + R * 0.18 * Math.cos(a);
    const iy = CYtool + R * 0.18 * Math.sin(a);
    const mx = CX + R * 0.62 * Math.cos(a + 0.45);
    const my = CYtool + R * 0.62 * Math.sin(a + 0.45);
    const ox = CX + R * Math.cos(a2);
    const oy = CYtool + R * Math.sin(a2);
    return `M ${ix} ${iy} Q ${mx} ${my} ${ox} ${oy}`;
  });

  // Duración de giro visual: más RPM = más rápido (acotado para que se lea).
  const spinSec = clamp(6000 / Math.max(rpm, 1), 0.6, 6);

  // ── Vista de alzado (derecha) ───────────────────────────────────────────
  const SX0 = 288;
  const SX1 = 412;
  const BLOCK_TOP = 118;
  const BLOCK_BOT = 210;
  const R2 = clamp(R * 0.45, 12, 28);
  const CX2 = SX0 + 46;
  const apPx = clamp(axialDepthMm * 5, 8, BLOCK_BOT - BLOCK_TOP - 12);
  const toolBottom = BLOCK_TOP + apPx;
  const aePx2 = clamp(aeRatio * 2 * R2, 3, 2 * R2);
  const toolLeft = CX2 - R2;
  const toolRight = CX2 + R2;
  // La fresa ya recorrió la pared: el escalón fresado queda a la izquierda.
  const pocketRight = toolLeft + aePx2;

  const rpmLabel = Number.isFinite(rpm) ? Math.round(rpm).toLocaleString() : '—';

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full h-auto select-none"
        role="img"
        aria-label={`Esquema de fresado: fresa ${labels.diameter} de ${Z} filos, paso radial ${labels.radial}, profundidad ${labels.axial}, contacto ${engagementAngleDeg}°, ${rpmLabel} rpm`}
      >
        <defs>
          <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" strokeWidth="1.2" className="stroke-ink-dim" opacity="0.35" />
          </pattern>
          <clipPath id={clipId}>
            <circle cx={CX} cy={CYtool} r={R} />
          </clipPath>
        </defs>

        {/* ── PLANTA ── */}
        <text x={20} y={16} fontSize="8.5" className="fill-ink-dim font-mono" fontWeight="800">
          VISTA EN PLANTA
        </text>
        {/* Pieza (pared superior en WALL_Y). La franja ya fresada queda a la izquierda de la fresa. */}
        <rect x={20} y={WALL_Y} width={250} height={100} className="fill-surface-2 stroke-ink" strokeWidth="1.5" />
        <rect x={20} y={WALL_Y} width={250} height={100} fill={`url(#${hatchId})`} />
        {/* Material que se lleva esta pasada (ae) */}
        <rect x={20} y={WALL_Y} width={CX - 20} height={aePx} className="fill-surface" />
        <rect x={CX} y={WALL_Y} width={270 - CX} height={aePx} className="fill-accent" opacity="0.2" />
        <line x1={20} y1={WALL_Y + aePx} x2={270} y2={WALL_Y + aePx} strokeWidth="1.2" strokeDasharray="4 3" className="stroke-accent" />

        {/* Fresa */}
        <circle cx={CX} cy={CYtool} r={R} className="fill-surface stroke-ink" strokeWidth="1.8" />
        <g
          className="motion-safe:animate-spin"
          style={{ transformOrigin: `${CX}px ${CYtool}px`, animationDuration: `${spinSec}s` }}
          clipPath={`url(#${clipId})`}
        >
          {flutes.map((d, i) => (
            <path key={i} d={d} fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-ink-dim" />
          ))}
        </g>
        <circle cx={CX} cy={CYtool} r={R * 0.16} className="fill-ink-dim stroke-ink" strokeWidth="1" />
        {/* Arco de contacto θ */}
        <path d={engagementArc} fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-accent" />
        <circle cx={xl} cy={WALL_Y} r="2.2" className="fill-accent" />
        <circle cx={xr} cy={WALL_Y} r="2.2" className="fill-accent" />
        {/* Giro */}
        <g className="text-ink">
          <path
            d={`M ${CX - R * 0.55} ${CYtool - R - 12} a ${R * 0.55} 8 0 0 1 ${R * 1.1} 0`}
            fill="none"
            strokeWidth="1.5"
            stroke="currentColor"
            markerEnd={`url(#${arrowId})`}
          />
        </g>
        <text x={CX} y={CYtool - R - 18} textAnchor="middle" fontSize="9" className="fill-ink font-mono" fontWeight="800">
          n = {rpmLabel} rpm · Z = {Z}
        </text>

        {/* Avance vf */}
        <g className="text-ink">
          <line x1={CX - R - 46} y1={WALL_Y + aePx / 2} x2={CX - R - 6} y2={WALL_Y + aePx / 2} strokeWidth="1.6" stroke="currentColor" markerEnd={`url(#${arrowId})`} />
        </g>
        <text x={CX - R - 46} y={WALL_Y + aePx / 2 - 5} fontSize="8.5" className="fill-ink font-mono" fontWeight="800">
          vf {labels.feed}
        </text>

        {/* Cota ae */}
        <g className="text-accent">
          <line x1={CX + R + 14} y1={WALL_Y} x2={CX + R + 14} y2={WALL_Y + aePx} strokeWidth="1.3" stroke="currentColor" markerStart={`url(#${arrowId})`} markerEnd={`url(#${arrowId})`} />
        </g>
        <text x={CX + R + 18} y={WALL_Y + aePx / 2 + 3} fontSize="9" className="fill-accent font-mono" fontWeight="800">
          ae {labels.radial}
        </text>
        {/* Cota D */}
        <g className="text-ink">
          <line x1={CX - R} y1={CYtool + R + 14} x2={CX + R} y2={CYtool + R + 14} strokeWidth="1.2" stroke="currentColor" markerStart={`url(#${arrowId})`} markerEnd={`url(#${arrowId})`} />
        </g>
        <rect x={CX - 34} y={CYtool + R + 18} width={68} height={14} rx={2} className="fill-surface" opacity="0.92" />
        <text x={CX} y={CYtool + R + 28} textAnchor="middle" fontSize="9" className="fill-ink font-mono" fontWeight="800">
          Ø {labels.diameter}
        </text>
        {/* θ */}
        <text x={CX} y={WALL_Y + aePx + 30 > CYtool + R + 12 ? CYtool + R + 46 : WALL_Y + aePx + 30} textAnchor="middle" fontSize="9.5" className="fill-accent font-mono" fontWeight="800">
          θ contacto = {engagementAngleDeg}°
        </text>

        {/* ── ALZADO ── */}
        <text x={SX0} y={16} fontSize="8.5" className="fill-ink-dim font-mono" fontWeight="800">
          ALZADO
        </text>
        {/* Bloque con el escalón ya fresado a la izquierda de la fresa */}
        <path
          d={`M ${SX0} ${toolBottom} L ${pocketRight} ${toolBottom} L ${pocketRight} ${BLOCK_TOP} L ${SX1} ${BLOCK_TOP} L ${SX1} ${BLOCK_BOT} L ${SX0} ${BLOCK_BOT} Z`}
          className="fill-surface-2 stroke-ink"
          strokeWidth="1.5"
        />
        <path
          d={`M ${SX0} ${toolBottom} L ${pocketRight} ${toolBottom} L ${pocketRight} ${BLOCK_TOP} L ${SX1} ${BLOCK_TOP} L ${SX1} ${BLOCK_BOT} L ${SX0} ${BLOCK_BOT} Z`}
          fill={`url(#${hatchId})`}
        />
        {/* Material de esta pasada */}
        <rect x={pocketRight} y={BLOCK_TOP} width={toolRight - pocketRight} height={apPx} className="fill-accent" opacity="0.2" />
        {/* Fresa (cuerpo + filos) */}
        <rect x={toolLeft} y={24} width={2 * R2} height={toolBottom - 24} rx={2} className="fill-surface stroke-ink" strokeWidth="1.6" />
        {Array.from({ length: 5 }, (_, i) => {
          const y = 40 + i * ((toolBottom - 48) / 5);
          return <line key={i} x1={toolLeft + 2} y1={y + 10} x2={toolRight - 2} y2={y} strokeWidth="1.2" className="stroke-ink-dim" opacity="0.7" />;
        })}
        {/* Portaherramienta */}
        <rect x={CX2 - R2 * 0.7} y={6} width={R2 * 1.4} height={18} className="fill-ink-dim stroke-ink" strokeWidth="1" opacity="0.75" />
        {/* Cota ap */}
        <g className="text-accent">
          <line x1={SX1 - 10} y1={BLOCK_TOP} x2={SX1 - 10} y2={toolBottom} strokeWidth="1.3" stroke="currentColor" markerStart={`url(#${arrowId})`} markerEnd={`url(#${arrowId})`} />
        </g>
        <text x={SX1 - 14} y={(BLOCK_TOP + toolBottom) / 2 + 3} textAnchor="end" fontSize="9" className="fill-accent font-mono" fontWeight="800">
          ap {labels.axial}
        </text>
      </svg>
      <span className="absolute bottom-1 right-2 font-mono text-[8px] uppercase tracking-wider text-ink-dim">
        Esquema · ae y ap exagerados
      </span>
    </div>
  );
}
