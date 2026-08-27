import { type ReactElement } from 'react';
import type { InsertShapeCode } from '../../lib/tooling/types';

interface InsertGeometrySvgProps {
  shape: InsertShapeCode;
  points: { x: number; y: number }[];
  size?: number;
  hasHole?: boolean;
  className?: string;
}

export function InsertGeometrySvg({
  shape,
  points,
  size = 140,
  hasHole = true,
  className = '',
}: InsertGeometrySvgProps): ReactElement {
  const pointsString = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div className={`relative inline-flex items-center justify-center bg-surface-2 border-2 border-line p-3 shadow-hard ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="overflow-visible drop-shadow-[0_4px_8px_rgba(0,0,0,0.15)]"
      >
        <defs>
          <linearGradient id="goldCarbideGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="40%" stopColor="#D97706" />
            <stop offset="80%" stopColor="#B45309" />
            <stop offset="100%" stopColor="#78350F" />
          </linearGradient>
          <linearGradient id="edgeHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FEF3C7" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#D97706" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Cuerpo del Inserto */}
        {shape === 'R' ? (
          <circle
            cx="50"
            cy="50"
            r="38"
            fill="url(#goldCarbideGrad)"
            stroke="#1E293B"
            strokeWidth="3"
          />
        ) : (
          <polygon
            points={pointsString}
            fill="url(#goldCarbideGrad)"
            stroke="#1E293B"
            strokeWidth="3"
            strokeLinejoin="round"
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

        {/* Resalte de filos de corte */}
        {points.map((p, idx) => (
          <circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r="3.5"
            fill="#EF4444"
            stroke="#FFFFFF"
            strokeWidth="1"
          />
        ))}
      </svg>
      <div className="absolute bottom-1 right-2 font-mono text-[9px] text-ink-dim uppercase tracking-wider font-bold">
        {shape} ISO
      </div>
    </div>
  );
}
