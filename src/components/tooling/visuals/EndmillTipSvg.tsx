import { useId, type ReactElement } from 'react';
import type { EndmillTipGeometry } from '../../../lib/tooling/types';

interface EndmillTipSvgProps {
  geometry: EndmillTipGeometry;
  size?: number;
  className?: string;
}

const BODY_LEFT = 38;
const BODY_RIGHT = 82;
const BODY_TOP = 8;
const SHOULDER_Y = 92;
const TIP_BOTTOM = 132;
const CENTER_X = (BODY_LEFT + BODY_RIGHT) / 2;

/**
 * Corte lateral didáctico (NO a escala) de la punta de una fresa según su
 * geometría, para acompañar la selección en `TIP_GEOMETRY_GUIDE`. Mismo
 * lenguaje visual que `InsertGeometrySvg` / `ThreadProfileSvg`: SVG con
 * `useId` para gradientes únicos, trazos con clases Tailwind de color.
 */
export function EndmillTipSvg({ geometry, size = 96, className = '' }: EndmillTipSvgProps): ReactElement {
  const uid = useId().replace(/:/g, '');
  const gradId = `endmill-body-grad-${uid}`;

  const fluteLines = [BODY_LEFT + 8, BODY_LEFT + 22, BODY_RIGHT - 22, BODY_RIGHT - 8];

  let tipPath: string;
  let tipExtra: ReactElement | null = null;

  switch (geometry) {
    case 'square':
      // Punta plana a 90°: esquina viva.
      tipPath = `M ${BODY_LEFT} ${SHOULDER_Y} L ${BODY_LEFT} ${TIP_BOTTOM} L ${BODY_RIGHT} ${TIP_BOTTOM} L ${BODY_RIGHT} ${SHOULDER_Y} Z`;
      break;
    case 'corner_radius': {
      // Esquina reforzada con radio (bull nose).
      const r = 12;
      tipPath = `M ${BODY_LEFT} ${SHOULDER_Y} L ${BODY_LEFT} ${TIP_BOTTOM - r} A ${r} ${r} 0 0 0 ${BODY_LEFT + r} ${TIP_BOTTOM} L ${BODY_RIGHT - r} ${TIP_BOTTOM} A ${r} ${r} 0 0 0 ${BODY_RIGHT} ${TIP_BOTTOM - r} L ${BODY_RIGHT} ${SHOULDER_Y} Z`;
      break;
    }
    case 'ball_nose': {
      // Punta semiesférica continua.
      const r = (BODY_RIGHT - BODY_LEFT) / 2;
      tipPath = `M ${BODY_LEFT} ${SHOULDER_Y} L ${BODY_LEFT} ${TIP_BOTTOM - r} A ${r} ${r} 0 0 0 ${BODY_RIGHT} ${TIP_BOTTOM - r} L ${BODY_RIGHT} ${SHOULDER_Y} Z`;
      break;
    }
    case 'roughing_corncob': {
      // Dientes ondulados (corncob) en el filo.
      const waves = 4;
      const stepY = (TIP_BOTTOM - SHOULDER_Y) / waves;
      let left = `M ${BODY_LEFT} ${SHOULDER_Y} `;
      let right = `M ${BODY_RIGHT} ${SHOULDER_Y} `;
      for (let i = 0; i < waves; i++) {
        const yMid = SHOULDER_Y + stepY * (i + 0.5);
        const yEnd = SHOULDER_Y + stepY * (i + 1);
        left += `Q ${BODY_LEFT + 6} ${yMid} ${BODY_LEFT} ${yEnd} `;
        right += `Q ${BODY_RIGHT - 6} ${yMid} ${BODY_RIGHT} ${yEnd} `;
      }
      tipPath = `${left} L ${BODY_LEFT} ${TIP_BOTTOM} L ${BODY_RIGHT} ${TIP_BOTTOM} ${right}`;
      tipExtra = (
        <path
          d={`${left} L ${BODY_LEFT} ${TIP_BOTTOM} L ${BODY_RIGHT} ${TIP_BOTTOM} ${right}`}
          fill="none"
          className="stroke-ink"
          strokeWidth="1.5"
        />
      );
      break;
    }
    case 'chamfer': {
      // Herramienta cónica (chaflanador 45°/90°).
      tipPath = `M ${BODY_LEFT} ${SHOULDER_Y} L ${CENTER_X} ${TIP_BOTTOM} L ${BODY_RIGHT} ${SHOULDER_Y} Z`;
      break;
    }
    case 'thread_mill': {
      // Perfil con muescas en V que emulan la interpolación de rosca.
      const notches = 3;
      const stepY = (TIP_BOTTOM - SHOULDER_Y) / notches;
      tipPath = `M ${BODY_LEFT} ${SHOULDER_Y} L ${BODY_LEFT} ${TIP_BOTTOM} L ${BODY_RIGHT} ${TIP_BOTTOM} L ${BODY_RIGHT} ${SHOULDER_Y} Z`;
      tipExtra = (
        <g className="stroke-ink" strokeWidth="1.3" fill="none">
          {Array.from({ length: notches }).map((_, i) => {
            const y = SHOULDER_Y + stepY * (i + 0.5);
            return (
              <path
                key={i}
                d={`M ${BODY_LEFT + 3} ${y - 5} L ${CENTER_X} ${y} L ${BODY_LEFT + 3} ${y + 5} M ${BODY_RIGHT - 3} ${y - 5} L ${CENTER_X} ${y} L ${BODY_RIGHT - 3} ${y + 5}`}
              />
            );
          })}
        </g>
      );
      break;
    }
    default:
      tipPath = `M ${BODY_LEFT} ${SHOULDER_Y} L ${BODY_LEFT} ${TIP_BOTTOM} L ${BODY_RIGHT} ${TIP_BOTTOM} L ${BODY_RIGHT} ${SHOULDER_Y} Z`;
  }

  return (
    <div className={`inline-flex flex-col items-center justify-center bg-surface-2 border-2 border-line p-2 shadow-hard ${className}`}>
      <svg
        width={size}
        height={size * 1.4}
        viewBox="0 0 120 140"
        role="img"
        aria-label={`Esquema didáctico de geometría de punta de fresa: ${geometry.replace(/_/g, ' ')}`}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#94A3B8" />
            <stop offset="45%" stopColor="#E2E8F0" />
            <stop offset="55%" stopColor="#E2E8F0" />
            <stop offset="100%" stopColor="#64748B" />
          </linearGradient>
        </defs>

        {/* Zanco / cuerpo de la fresa */}
        <rect
          x={BODY_LEFT}
          y={BODY_TOP}
          width={BODY_RIGHT - BODY_LEFT}
          height={SHOULDER_Y - BODY_TOP}
          fill={`url(#${gradId})`}
          stroke="#1E293B"
          strokeWidth="2"
        />

        {/* Líneas de flauta (decorativas, indican filos helicoidales) */}
        {fluteLines.map((x, i) => (
          <line key={i} x1={x} y1={BODY_TOP + 4} x2={x} y2={SHOULDER_Y - 2} className="stroke-ink" strokeWidth="0.75" opacity="0.35" />
        ))}

        {/* Punta según geometría seleccionada */}
        <path d={tipPath} fill={`url(#${gradId})`} stroke="#1E293B" strokeWidth="2" strokeLinejoin="round" />
        {tipExtra}

        {/* Eje de simetría */}
        <line x1={CENTER_X} y1={BODY_TOP} x2={CENTER_X} y2={TIP_BOTTOM} strokeDasharray="2 3" className="stroke-ink-dim" strokeWidth="0.75" opacity="0.5" />
      </svg>
      <span className="mt-1 font-mono text-[8px] uppercase tracking-wider text-ink-dim text-center leading-tight">
        Esquema didáctico · no a escala
      </span>
    </div>
  );
}
