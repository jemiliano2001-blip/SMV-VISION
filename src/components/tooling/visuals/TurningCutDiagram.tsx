import { useId, type ReactElement } from 'react';

interface TurningCutDiagramProps {
  /** Diámetro en bruto D (mm). */
  diameterMm: number;
  /** Profundidad radial de corte ap (mm). */
  depthOfCutMm: number;
  /** Avance por vuelta fn (mm/rev). */
  feedMm: number;
  /** Radio de punta del inserto r (mm). */
  noseRadiusMm: number;
  /** RPM que realmente girará el husillo. */
  rpm: number;
  /** Etiquetas ya formateadas en el sistema de unidades activo. */
  labels: {
    diameter: string;
    finalDiameter: string;
    depth: string;
    feed: string;
    radius: string;
  };
  className?: string;
}

const VB_W = 420;
const VB_H = 230;
const CY = 125; // eje de giro
const CHUCK_X = 44; // cara del chuck
const TOOL_X = 250; // punto de corte (hombro)
const PART_END_X = 386;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Vista lateral de un torneado exterior: chuck a la izquierda, pieza girando,
 * inserto cortando en el hombro entre el diámetro en bruto y el terminado.
 * Las proporciones siguen a los inputs (con ap, fn y r exagerados para que se
 * vean) — es un esquema didáctico, no un plano a escala.
 */
export function TurningCutDiagram({
  diameterMm,
  depthOfCutMm,
  feedMm,
  noseRadiusMm,
  rpm,
  labels,
  className = '',
}: TurningCutDiagramProps): ReactElement {
  const uid = useId().replace(/:/g, '');
  const arrowId = `arrow-${uid}`;
  const hatchId = `hatch-${uid}`;

  const D = Math.max(diameterMm, 0.5);
  // Alto de la pieza en px: crece con D pero acotado para que quepa siempre.
  const dPx = clamp(D * 2.2, 46, 150);
  const halfRaw = dPx / 2;
  // ap exagerado ×3 respecto a la proporción real para que sea visible.
  const apPx = clamp((Math.max(depthOfCutMm, 0.02) / D) * dPx * 3, 6, halfRaw - 8);
  const halfFinished = halfRaw - apPx;

  const yTopRaw = CY - halfRaw;
  const yTopFin = CY - halfFinished;
  const yBotRaw = CY + halfRaw;
  const yBotFin = CY + halfFinished;

  // Crestas del avance: paso ∝ fn, altura ∝ fn²/(8r) (Rt), ambas exageradas.
  const pitchPx = clamp(Math.max(feedMm, 0.02) * 42, 6, 26);
  const rtUm = ((feedMm * feedMm) / (8 * Math.max(noseRadiusMm, 0.05))) * 1000;
  const scallopPx = clamp(rtUm * 0.45, 1, 7);
  // Radio del arco a partir de cuerda (paso) y flecha (altura de cresta):
  // r = (c²/4 + s²) / (2s). Con sweep=0 el arco se hunde hacia el material.
  const scallopR = ((pitchPx * pitchPx) / 4 + scallopPx * scallopPx) / (2 * scallopPx);
  const scallops: string[] = [];
  for (let x = TOOL_X; x < PART_END_X; x += pitchPx) {
    const x2 = Math.min(x + pitchPx, PART_END_X);
    scallops.push(`A ${scallopR.toFixed(2)} ${scallopR.toFixed(2)} 0 0 0 ${x2.toFixed(2)} ${yTopFin}`);
  }
  const topFinishedEdge = `M ${TOOL_X} ${yTopFin} ${scallops.join(' ')}`;
  // La sección terminada (lado derecho) con crestas arriba y abajo.
  const finishedSection = `M ${TOOL_X} ${yTopFin} ${scallops.join(' ')} L ${PART_END_X} ${yBotFin} L ${TOOL_X} ${yBotFin} Z`;

  // Inserto romboidal 80° (tipo C) con la nariz en el punto de corte.
  const side = 34;
  const tilt = 10;
  const a1 = ((-130 + tilt) * Math.PI) / 180;
  const a2 = ((-50 + tilt) * Math.PI) / 180;
  const p1 = { x: TOOL_X + side * Math.cos(a1), y: yTopFin + side * Math.sin(a1) };
  const p2 = { x: TOOL_X + side * Math.cos(a2), y: yTopFin + side * Math.sin(a2) };
  const p3 = { x: p1.x + p2.x - TOOL_X, y: p1.y + p2.y - yTopFin };
  const insertPts = `${TOOL_X},${yTopFin} ${p1.x},${p1.y} ${p3.x},${p3.y} ${p2.x},${p2.y}`;
  const rPx = clamp(noseRadiusMm * 9, 2.5, 9);

  // Espiral de viruta saliendo del filo.
  const chip = `M ${TOOL_X - 2} ${yTopRaw - 2} c -6 -10, -20 -12, -22 -2 c -2 9, 9 13, 14 5 c 3 -5, -3 -9, -6 -5`;

  const feedArrowY = yTopRaw - 22;
  const rpmLabel = Number.isFinite(rpm) ? Math.round(rpm).toLocaleString() : '—';

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full h-auto select-none"
        role="img"
        aria-label={`Esquema de torneado: diámetro ${labels.diameter}, profundidad ${labels.depth}, avance ${labels.feed}, radio ${labels.radius}, ${rpmLabel} rpm`}
      >
        <defs>
          <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" strokeWidth="1.2" className="stroke-ink-dim" opacity="0.35" />
          </pattern>
        </defs>

        {/* Eje de giro */}
        <line x1={10} y1={CY} x2={VB_W - 10} y2={CY} strokeWidth="1" strokeDasharray="10 4 2 4" className="stroke-ink-dim" opacity="0.6" />

        {/* Chuck y mordazas */}
        <rect x={4} y={yTopRaw - 26} width={CHUCK_X - 4} height={dPx + 52} rx={3} className="fill-surface-2 stroke-line" strokeWidth="1.5" />
        <rect x={CHUCK_X - 18} y={yTopRaw - 14} width={22} height={14} className="fill-ink-dim stroke-ink" strokeWidth="1" opacity="0.8" />
        <rect x={CHUCK_X - 18} y={yBotRaw} width={22} height={14} className="fill-ink-dim stroke-ink" strokeWidth="1" opacity="0.8" />
        <text x={22} y={CY + 3} textAnchor="middle" fontSize="8" className="fill-ink-dim font-mono" fontWeight="700" transform={`rotate(-90 22 ${CY})`}>
          CHUCK
        </text>

        {/* Pieza: sección en bruto (izquierda) */}
        <rect x={CHUCK_X} y={yTopRaw} width={TOOL_X - CHUCK_X} height={dPx} className="fill-surface-2 stroke-ink" strokeWidth="1.5" />
        <rect x={CHUCK_X} y={yTopRaw} width={TOOL_X - CHUCK_X} height={dPx} fill={`url(#${hatchId})`} />
        {/* Material que se está quitando (arriba y abajo, exagerado) */}
        <rect x={TOOL_X} y={yTopRaw} width={PART_END_X - TOOL_X} height={apPx} className="fill-accent" opacity="0.18" />
        <rect x={TOOL_X} y={yBotFin} width={PART_END_X - TOOL_X} height={apPx} className="fill-accent" opacity="0.18" />
        <line x1={TOOL_X} y1={yTopRaw} x2={PART_END_X} y2={yTopRaw} strokeWidth="1" strokeDasharray="3 3" className="stroke-accent" opacity="0.7" />
        <line x1={TOOL_X} y1={yBotRaw} x2={PART_END_X} y2={yBotRaw} strokeWidth="1" strokeDasharray="3 3" className="stroke-accent" opacity="0.7" />

        {/* Pieza: sección terminada (derecha) con crestas del avance */}
        <path d={finishedSection} className="fill-surface-2 stroke-ink" strokeWidth="1.5" />
        <path d={finishedSection} fill={`url(#${hatchId})`} stroke="none" />
        <path d={topFinishedEdge} fill="none" strokeWidth="1.6" className="stroke-ok" />

        {/* Portaherramienta + inserto */}
        <path
          d={`M ${p3.x - 6} ${p3.y - 4} L ${p3.x + 18} ${p3.y - 30} L ${p3.x + 58} ${p3.y - 30} L ${p3.x + 58} ${p3.y + 4} L ${p2.x + 6} ${p2.y + 4} Z`}
          className="fill-ink-dim stroke-ink"
          strokeWidth="1.2"
          opacity="0.75"
        />
        <polygon points={insertPts} className="fill-warn stroke-ink" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx={p3.x} cy={p3.y} r="4" className="fill-ink" opacity="0.7" />
        {/* Radio de punta */}
        <circle cx={TOOL_X} cy={yTopFin} r={rPx} fill="none" strokeWidth="1.4" className="stroke-accent" />
        <circle cx={TOOL_X} cy={yTopFin} r="1.8" className="fill-accent" />

        {/* Viruta */}
        <path d={chip} fill="none" strokeWidth="2.2" strokeLinecap="round" className="stroke-accent" />

        {/* Flecha de avance (la herramienta viaja hacia el chuck) */}
        <g className="text-ink">
          <line x1={TOOL_X + 70} y1={feedArrowY} x2={TOOL_X + 18} y2={feedArrowY} strokeWidth="1.6" stroke="currentColor" markerEnd={`url(#${arrowId})`} />
          <text x={TOOL_X + 74} y={feedArrowY + 3} fontSize="9" className="fill-ink font-mono" fontWeight="800">
            fn = {labels.feed}
          </text>
        </g>

        {/* Cota: ap */}
        <g className="text-accent">
          <line x1={PART_END_X + 10} y1={yTopRaw} x2={PART_END_X + 10} y2={yTopFin} strokeWidth="1.3" stroke="currentColor" markerStart={`url(#${arrowId})`} markerEnd={`url(#${arrowId})`} />
          <line x1={PART_END_X} y1={yTopRaw} x2={PART_END_X + 16} y2={yTopRaw} strokeWidth="0.8" stroke="currentColor" />
          <text x={PART_END_X + 14} y={(yTopRaw + yTopFin) / 2 + 3} fontSize="9" className="fill-accent font-mono" fontWeight="800">
            ap {labels.depth}
          </text>
        </g>

        {/* Cota: Ø en bruto */}
        <g className="text-ink">
          <line x1={CHUCK_X + 28} y1={yTopRaw} x2={CHUCK_X + 28} y2={yBotRaw} strokeWidth="1.2" stroke="currentColor" markerStart={`url(#${arrowId})`} markerEnd={`url(#${arrowId})`} />
          <rect x={CHUCK_X + 32} y={CY - 8} width={78} height={15} rx={2} className="fill-surface" opacity="0.92" />
          <text x={CHUCK_X + 36} y={CY + 3} fontSize="9" className="fill-ink font-mono" fontWeight="800">
            Ø {labels.diameter}
          </text>
        </g>

        {/* Cota: Ø terminado */}
        <g className="text-ok">
          <line x1={PART_END_X - 28} y1={yTopFin} x2={PART_END_X - 28} y2={yBotFin} strokeWidth="1.2" stroke="currentColor" markerStart={`url(#${arrowId})`} markerEnd={`url(#${arrowId})`} />
          <rect x={PART_END_X - 104} y={CY - 8} width={72} height={15} rx={2} className="fill-surface" opacity="0.92" />
          <text x={PART_END_X - 100} y={CY + 3} fontSize="9" className="fill-ok font-mono" fontWeight="800">
            Ø {labels.finalDiameter}
          </text>
        </g>

        {/* Radio r */}
        <text x={TOOL_X - 6} y={yTopFin + 14 + rPx} textAnchor="end" fontSize="8.5" className="fill-accent font-mono" fontWeight="800">
          r {labels.radius}
        </text>

        {/* Giro / RPM */}
        <g className="text-ink">
          <path
            d={`M ${CHUCK_X + 62} ${yBotRaw + 22} a 22 12 0 1 1 30 0`}
            fill="none"
            strokeWidth="1.6"
            stroke="currentColor"
            markerEnd={`url(#${arrowId})`}
          />
          <text x={CHUCK_X + 100} y={yBotRaw + 26} fontSize="9.5" className="fill-ink font-mono" fontWeight="800">
            n = {rpmLabel} rpm
          </text>
        </g>
      </svg>
      <span className="absolute bottom-1 right-2 font-mono text-[8px] uppercase tracking-wider text-ink-dim">
        Esquema · ap, fn y r exagerados
      </span>
    </div>
  );
}
