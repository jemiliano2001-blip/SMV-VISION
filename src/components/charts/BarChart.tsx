import type { ReactElement } from 'react';

export interface BarChartEntry {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarChartEntry[];
  title?: string;
  /** CSS variable name for bar fill, e.g. '--color-accent'. Default: '--color-accent'. */
  colorVar?: string;
  emptyMessage?: string;
}

const BAR_H = 20;
const GAP = 6;
const LABEL_W = 105;
const VALUE_W = 28;
const CHART_W = 320;
const BAR_AREA_W = CHART_W - LABEL_W - VALUE_W;

export function BarChart({
  data,
  title,
  colorVar = '--color-accent',
  emptyMessage = '—',
}: BarChartProps): ReactElement {
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const svgH = data.length * (BAR_H + GAP) - GAP;

  return (
    <div>
      {title && (
        <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mb-2">{title}</p>
      )}
      {data.length === 0 ? (
        <p className="font-mono text-[10px] text-ink-dim">{emptyMessage}</p>
      ) : (
        <svg
          width="100%"
          viewBox={`0 0 ${CHART_W} ${Math.max(svgH, 20)}`}
          aria-label={title}
          role="img"
        >
          {data.map((d, i) => {
            const barW = Math.max((d.value / maxVal) * BAR_AREA_W, d.value > 0 ? 2 : 0);
            const y = i * (BAR_H + GAP);
            const displayLabel = d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label;
            return (
              <g key={d.label}>
                <title>{`${d.label}: ${d.value}`}</title>
                {/* label */}
                <text
                  x={LABEL_W - 6}
                  y={y + BAR_H / 2 + 3.5}
                  textAnchor="end"
                  fontSize={8.5}
                  fontFamily="monospace"
                  fill="currentColor"
                  opacity={0.7}
                >
                  {displayLabel}
                </text>
                {/* bar */}
                <rect
                  x={LABEL_W}
                  y={y}
                  width={barW}
                  height={BAR_H}
                  fill={`var(${colorVar})`}
                  opacity={0.8}
                  rx={2}
                />
                {/* value */}
                <text
                  x={LABEL_W + barW + 5}
                  y={y + BAR_H / 2 + 3.5}
                  fontSize={8.5}
                  fontFamily="monospace"
                  fill="currentColor"
                  opacity={0.9}
                  fontWeight="bold"
                >
                  {d.value}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
