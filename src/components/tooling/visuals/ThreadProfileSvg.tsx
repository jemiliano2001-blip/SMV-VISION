import { useId, type ReactElement } from 'react';
import { computeThreadFlankMm, clampNumber, APPROX_PITCH_LINE_FRACTION } from '../../../lib/tooling/threadProfileGeometry';

interface ThreadProfileSvgProps {
  isExternal: boolean;
  majorDiameterMm: number;
  pitchMm: number;
  threadDepthMm: number;
  infeedScheduleMm: number[];
  /** Ángulo de punta incluido, en grados. Default 60° (ISO / UN). */
  tipAngleDegrees?: number;
  unitSystem: 'imperial' | 'metric';
  /** Pasada resaltada, base 1 (coincide con el número de fila de la tabla de pasadas). */
  highlightedPass?: number;
  className?: string;
}

const VB_W = 420;
const VB_H = 220;
const CENTER_X = 150;
const CREST_Y = 52;
const TARGET_DEPTH_PX = 92;
const GUIDE_X_START = 14;
const GUIDE_X_END = 288;
const LABEL_X = 296;

/**
 * Corte transversal didáctico de UNA rosca en V (60° por defecto), NO un plano CAD.
 * Muestra las líneas guía de diámetro mayor / de paso (aproximado) / menor, el perfil
 * final truncado (cresta + raíz aplanadas según ISO 68-1: P/8 y P/4) y triángulos
 * anidados por cada pasada de `infeedScheduleMm` — la pasada 1 más clara/delgada, la
 * última más oscura/gruesa — para ilustrar cómo el G76 profundiza gradualmente.
 * Exterior vs interior invierte qué lado es material y cuál es aire.
 */
export function ThreadProfileSvg({
  isExternal,
  majorDiameterMm,
  pitchMm,
  threadDepthMm,
  infeedScheduleMm,
  tipAngleDegrees = 60,
  unitSystem,
  highlightedPass,
  className = '',
}: ThreadProfileSvgProps): ReactElement {
  const uid = useId().replace(/:/g, '');
  const hatchId = `thread-hatch-${uid}`;

  const safeMajor = Math.max(majorDiameterMm, 0.1);
  const safePitch = Math.max(pitchMm, 0.01);
  const safeDepth = Math.max(threadDepthMm, 0.005);
  const halfAngleRad = (Math.max(tipAngleDegrees, 1) / 2) * (Math.PI / 180);

  const pxPerMm = TARGET_DEPTH_PX / safeDepth;
  const flank = computeThreadFlankMm(safePitch, safeDepth, tipAngleDegrees);
  const crestFlatPx = clampNumber(flank.crestFlatMm * pxPerMm, 6, 46);
  const rootFlatPx = clampNumber(flank.rootFlatMm * pxPerMm, 10, 80);
  const flankPx = clampNumber(flank.flankRunMm * pxPerMm, 14, 130);

  const dir = isExternal ? 1 : -1;
  const yCrest = CREST_Y;
  const yRoot = CREST_Y + dir * TARGET_DEPTH_PX;
  const edgeY = dir === 1 ? VB_H - 14 : 14;

  const halfRoot = rootFlatPx / 2;
  const x2 = CENTER_X - halfRoot;
  const x3 = CENTER_X + halfRoot;
  const x1 = x2 - flankPx;
  const x4 = x3 + flankPx;
  const x0 = x1 - crestFlatPx;
  const x5 = x4 + crestFlatPx;

  const profilePath = `M ${x0} ${yCrest} L ${x1} ${yCrest} L ${x2} ${yRoot} L ${x3} ${yRoot} L ${x4} ${yCrest} L ${x5} ${yCrest}`;
  const fillPath = `${profilePath} L ${x5} ${edgeY} L ${x0} ${edgeY} Z`;

  const passes = infeedScheduleMm.length > 0 ? infeedScheduleMm : [safeDepth];
  const passCount = passes.length;

  const passShapes = passes.map((depthMm, idx) => {
    const clampedDepthMm = clampNumber(depthMm, 0, safeDepth);
    const passDepthPx = clampNumber((clampedDepthMm / safeDepth) * TARGET_DEPTH_PX, 1.5, TARGET_DEPTH_PX);
    const passFlankPx = passDepthPx * Math.tan(halfAngleRad);
    const apexY = CREST_Y + dir * passDepthPx;
    const fraction = passCount > 1 ? idx / (passCount - 1) : 1;
    return {
      passNumber: idx + 1,
      depthMm: clampedDepthMm,
      points: `${CENTER_X - passFlankPx},${yCrest} ${CENTER_X},${apexY} ${CENTER_X + passFlankPx},${yCrest}`,
      fillOpacity: 0.05 + 0.14 * fraction,
      strokeOpacity: 0.3 + 0.55 * fraction,
      strokeWidth: 0.8 + 1.1 * fraction,
    };
  });

  const highlighted =
    highlightedPass !== undefined && highlightedPass >= 1 && highlightedPass <= passShapes.length
      ? passShapes[highlightedPass - 1]
      : undefined;

  // Etiquetas de Ø usan offsets ISO 68-1 / ASME (no 2×profundidad de infeed G76).
  const minorDiameterMm = Math.max(safeMajor - 1.0825 * safePitch, 0);
  const pitchDiameterApproxMm = Math.max(safeMajor - 0.6495 * safePitch, 0);

  const fmtDiameter = (mm: number): string =>
    unitSystem === 'imperial' ? `Ø ${(mm / 25.4).toFixed(3)}"` : `Ø ${mm.toFixed(2)} mm`;
  const fmtDepth = (mm: number): string =>
    unitSystem === 'imperial' ? `${(mm / 25.4).toFixed(4)}"` : `${mm.toFixed(3)} mm`;

  const majorY = isExternal ? yCrest : yRoot;
  const minorY = isExternal ? yRoot : yCrest;
  const pitchY = CREST_Y + dir * TARGET_DEPTH_PX * APPROX_PITCH_LINE_FRACTION;

  const tickHalf = 4;

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full h-auto select-none"
        role="img"
        aria-label={`Perfil de rosca ${isExternal ? 'exterior' : 'interior'} en V de ${tipAngleDegrees}°: diámetro mayor ${fmtDiameter(safeMajor)}, diámetro menor ${fmtDiameter(minorDiameterMm)}, profundidad ${fmtDepth(safeDepth)}, ${passCount} pasadas de infeed.`}
      >
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" strokeWidth="1" className="stroke-ink-dim" opacity="0.3" />
          </pattern>
        </defs>

        {/* Cuerpo de la pieza (material) */}
        <path d={fillPath} className="fill-surface-2 stroke-ink" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={fillPath} fill={`url(#${hatchId})`} stroke="none" />

        {/* Líneas guía: mayor / paso (aprox.) / menor */}
        <g>
          <line x1={GUIDE_X_START} y1={majorY} x2={GUIDE_X_END} y2={majorY} strokeWidth="1" strokeDasharray="6 3" className="stroke-ink" opacity="0.75" />
          <text x={LABEL_X} y={majorY - 4} fontSize="7" fontWeight="700" className="fill-ink-dim font-mono uppercase">
            mayor
          </text>
          <text x={LABEL_X} y={majorY + 8} fontSize="9.5" fontWeight="800" className="fill-ink font-mono">
            {fmtDiameter(safeMajor)}
          </text>

          <line x1={GUIDE_X_START} y1={pitchY} x2={GUIDE_X_END} y2={pitchY} strokeWidth="1" strokeDasharray="3 3" className="stroke-accent" opacity="0.6" />
          <text x={LABEL_X} y={pitchY - 4} fontSize="7" fontWeight="700" className="fill-accent font-mono uppercase opacity-90">
            paso (aprox.)
          </text>
          <text x={LABEL_X} y={pitchY + 8} fontSize="9" fontWeight="800" className="fill-accent font-mono">
            {fmtDiameter(pitchDiameterApproxMm)}
          </text>

          <line x1={GUIDE_X_START} y1={minorY} x2={GUIDE_X_END} y2={minorY} strokeWidth="1" strokeDasharray="6 3" className="stroke-ink" opacity="0.75" />
          <text x={LABEL_X} y={minorY - 4} fontSize="7" fontWeight="700" className="fill-ink-dim font-mono uppercase">
            menor
          </text>
          <text x={LABEL_X} y={minorY + 8} fontSize="9.5" fontWeight="800" className="fill-ink font-mono">
            {fmtDiameter(minorDiameterMm)}
          </text>
        </g>

        {/* Pasadas de infeed: triángulos anidados por profundidad radial acumulada */}
        {passShapes.map((pass) => (
          <polygon
            key={pass.passNumber}
            points={pass.points}
            className="fill-accent stroke-accent"
            fillOpacity={pass.fillOpacity}
            strokeOpacity={pass.strokeOpacity}
            strokeWidth={pass.strokeWidth}
            strokeLinejoin="round"
          />
        ))}

        {/* Perfil final (forma real de la rosca, cresta y raíz truncadas) */}
        <path d={profilePath} fill="none" strokeWidth="2" className="stroke-ok" strokeLinejoin="round" />
        <line x1={x0} y1={yCrest - tickHalf} x2={x0} y2={yCrest + tickHalf} strokeWidth="1" className="stroke-ink" />
        <line x1={x5} y1={yCrest - tickHalf} x2={x5} y2={yCrest + tickHalf} strokeWidth="1" className="stroke-ink" />

        {/* Pasada resaltada (hover/foco en la tabla), dibujada al final para quedar arriba */}
        {highlighted && (
          <>
            <polygon
              points={highlighted.points}
              className="fill-warn stroke-warn"
              fillOpacity={0.22}
              strokeOpacity={1}
              strokeWidth={2.6}
              strokeLinejoin="round"
            />
            <text
              x={CENTER_X}
              y={yCrest + dir * clampNumber((highlighted.depthMm / safeDepth) * TARGET_DEPTH_PX, 1.5, TARGET_DEPTH_PX) + dir * 14}
              textAnchor="middle"
              fontSize="8.5"
              fontWeight="800"
              className="fill-warn font-mono"
            >
              #{highlighted.passNumber} · {fmtDepth(highlighted.depthMm)}
            </text>
          </>
        )}
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-1 px-1">
        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-dim">
          {isExternal ? 'Rosca exterior' : 'Rosca interior'} · {tipAngleDegrees}° · {passCount} pasadas
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-dim flex items-center gap-1">
          <span className="inline-block w-2 h-2 bg-accent" style={{ opacity: 0.19 }} aria-hidden="true" />
          pasada 1
          <span className="inline-block w-2 h-2 bg-accent" style={{ opacity: 0.85 }} aria-hidden="true" />
          pasada {passCount}
        </span>
      </div>
      <span className="block text-right font-mono text-[8px] uppercase tracking-wider text-ink-dim mt-0.5 px-1">
        Esquema didáctico · flancos y aplanados ISO 68-1 · no a escala
      </span>
    </div>
  );
}
