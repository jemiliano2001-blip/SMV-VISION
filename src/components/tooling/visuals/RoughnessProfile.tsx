import type { ReactElement } from 'react';
import { ISO_ROUGHNESS_GRADES, classifyRa, theoreticalPeakToValleyUm } from '../../../lib/tooling/surfaceFinish';

interface RoughnessProfileProps {
  feedMm: number;
  noseRadiusMm: number;
  raUm: number;
  /** Ra que pide el plano (µm), opcional; se marca en la escala. */
  targetRaUm?: number;
  unitSystem: 'imperial' | 'metric';
  className?: string;
}

const W = 360;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Perfil teórico de la superficie torneada (las crestas que deja el avance
 * con el radio de punta) y dónde cae ese Ra en la escala ISO 1302 (N-grados),
 * que es lo que se lee en el plano.
 */
export function RoughnessProfile({
  feedMm,
  noseRadiusMm,
  raUm,
  targetRaUm,
  unitSystem,
  className = '',
}: RoughnessProfileProps): ReactElement {
  const rtUm = theoreticalPeakToValleyUm(feedMm, noseRadiusMm);
  const grade = classifyRa(raUm);

  // ── Perfil (arriba) ──
  const PROFILE_TOP = 14;
  const PROFILE_BASE = 56;
  const pitch = clamp(Math.max(feedMm, 0.02) * 110, 14, 64);
  const depth = clamp(rtUm * 1.1, 2, 24);
  const r = ((pitch * pitch) / 4 + depth * depth) / (2 * depth);
  const segs: string[] = [];
  for (let x = 0; x < W; x += pitch) {
    const x2 = Math.min(x + pitch, W);
    segs.push(`A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 0 ${x2.toFixed(2)} ${PROFILE_TOP}`);
  }
  const profile = `M 0 ${PROFILE_TOP} ${segs.join(' ')}`;
  const area = `${profile} L ${W} ${PROFILE_BASE} L 0 ${PROFILE_BASE} Z`;
  // Ra ≈ Rt/4 medido desde la línea media: la línea media queda ~Rt/2 abajo del pico.
  const meanY = PROFILE_TOP + depth / 2;

  // ── Escala N (abajo) ──
  const SCALE_Y = 70;
  const SCALE_H = 16;
  const grades = ISO_ROUGHNESS_GRADES;
  const cellW = W / grades.length;
  const gradeIdx = grades.findIndex((g) => g.grade === grade.grade);
  // Posición continua del Ra dentro de la escala (logarítmica, cada grado ×2)
  const logPos = (ra: number) => {
    const lo = grades[0].raUm / 2;
    const hi = grades[grades.length - 1].raUm;
    const t = (Math.log2(Math.max(ra, lo)) - Math.log2(lo)) / (Math.log2(hi) - Math.log2(lo));
    return clamp(t, 0, 1) * W;
  };
  const xRa = logPos(raUm);
  const xTarget = targetRaUm ? logPos(targetRaUm) : null;
  const meetsTarget = targetRaUm ? raUm <= targetRaUm : null;

  const fmtRa = (v: number) => (unitSystem === 'imperial' ? `${Math.round(v * 39.37)} µin` : `${v.toFixed(2)} µm`);

  return (
    <div className={className} role="img" aria-label={`Rugosidad teórica ${fmtRa(raUm)}, grado ${grade.grade}`}>
      <svg viewBox={`0 0 ${W} 100`} className="w-full">
        {/* Perfil */}
        <path d={area} className="fill-surface-2" />
        <path d={profile} fill="none" strokeWidth="1.6" className="stroke-ok" />
        <line x1={0} y1={meanY} x2={W} y2={meanY} strokeWidth="0.8" strokeDasharray="4 3" className="stroke-ink-dim" />
        <text x={W - 4} y={meanY - 3} textAnchor="end" fontSize="7.5" className="fill-ink-dim font-mono" fontWeight="700">
          línea media · Ra {fmtRa(raUm)}
        </text>
        {/* Cota Rt en la primera cresta */}
        <line x1={pitch / 2} y1={PROFILE_TOP} x2={pitch / 2} y2={PROFILE_TOP + depth} strokeWidth="1" className="stroke-accent" />
        <text x={pitch / 2 + 4} y={PROFILE_TOP + depth / 2 + 3} fontSize="7.5" className="fill-accent font-mono" fontWeight="800">
          Rt {fmtRa(rtUm)}
        </text>
        {/* Paso = fn */}
        <line x1={pitch} y1={PROFILE_BASE - 6} x2={pitch * 2} y2={PROFILE_BASE - 6} strokeWidth="1" className="stroke-ink" />
        <line x1={pitch} y1={PROFILE_BASE - 9} x2={pitch} y2={PROFILE_BASE - 3} strokeWidth="1" className="stroke-ink" />
        <line x1={pitch * 2} y1={PROFILE_BASE - 9} x2={pitch * 2} y2={PROFILE_BASE - 3} strokeWidth="1" className="stroke-ink" />
        <text x={pitch * 1.5} y={PROFILE_BASE - 11} textAnchor="middle" fontSize="7.5" className="fill-ink font-mono" fontWeight="700">
          fn
        </text>

        {/* Escala ISO 1302 */}
        {grades.map((g, i) => {
          const x = i * cellW;
          const active = i === gradeIdx;
          return (
            <g key={g.grade}>
              <rect
                x={x}
                y={SCALE_Y}
                width={cellW - 1}
                height={SCALE_H}
                className={active ? 'fill-ok' : 'fill-line'}
                opacity={active ? 0.95 : 0.6}
              />
              <text
                x={x + cellW / 2}
                y={SCALE_Y + 11}
                textAnchor="middle"
                fontSize="7.5"
                fontWeight="800"
                className={active ? 'fill-bg font-mono' : 'fill-ink-dim font-mono'}
              >
                {g.grade}
              </text>
              <text x={x + cellW / 2} y={SCALE_Y + SCALE_H + 9} textAnchor="middle" fontSize="6.5" className="fill-ink-dim font-mono">
                {unitSystem === 'imperial' ? g.raUin : g.raUm}
              </text>
            </g>
          );
        })}
        {/* Marcador Ra actual */}
        <polygon points={`${xRa},${SCALE_Y - 1} ${xRa - 5},${SCALE_Y - 8} ${xRa + 5},${SCALE_Y - 8}`} className="fill-ink" />
        {/* Objetivo del plano */}
        {xTarget !== null && (
          <>
            <line x1={xTarget} y1={SCALE_Y - 2} x2={xTarget} y2={SCALE_Y + SCALE_H + 2} strokeWidth="2" className={meetsTarget ? 'stroke-ok' : 'stroke-danger'} />
            <text
              x={xTarget}
              y={SCALE_Y + SCALE_H + 18}
              textAnchor="middle"
              fontSize="7"
              fontWeight="800"
              className={`${meetsTarget ? 'fill-ok' : 'fill-danger'} font-mono`}
            >
              plano
            </text>
          </>
        )}
      </svg>
      <div className="flex items-center justify-between gap-2 -mt-1">
        <span className="font-mono text-[10px] text-ink">
          Cumple <strong className="text-ok">{grade.grade}</strong> · {grade.typicalProcess}
        </span>
        {meetsTarget !== null && (
          <span className={`font-mono text-[10px] font-black ${meetsTarget ? 'text-ok' : 'text-danger'}`}>
            {meetsTarget ? '✓ Cumple el plano' : '✗ No cumple el plano'}
          </span>
        )}
      </div>
    </div>
  );
}
