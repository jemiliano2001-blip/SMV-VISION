import type { ReactElement } from 'react';

export interface LineChartPoint {
  date: string;   // 'YYYY-MM-DD'
  value: number | null;
}

interface LineChartProps {
  data: LineChartPoint[];
  title?: string;
  unit?: string;
  minValue?: number;
  maxValue?: number;
}

const W = 300;
const H = 100;
const PAD = { top: 10, right: 28, bottom: 20, left: 24 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

export function LineChart({
  data,
  title,
  unit = '%',
  minValue = 0,
  maxValue = 100,
}: LineChartProps): ReactElement {
  const validPoints = data.filter((d) => d.value !== null);

  if (validPoints.length < 2) {
    return (
      <div>
        {title && (
          <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mb-2">{title}</p>
        )}
        <p className="font-mono text-[10px] text-ink-dim py-4 text-center">
          Acumulando datos históricos…
        </p>
      </div>
    );
  }

  const n = data.length;
  const range = maxValue - minValue || 1;

  const toX = (i: number) => PAD.left + (i / Math.max(n - 1, 1)) * INNER_W;
  const toY = (v: number) => PAD.top + INNER_H - ((v - minValue) / range) * INNER_H;

  const pathSegments: string[] = [];
  let inLine = false;
  data.forEach((d, i) => {
    if (d.value === null) { inLine = false; return; }
    const x = toX(i).toFixed(1);
    const y = toY(d.value).toFixed(1);
    pathSegments.push(`${inLine ? 'L' : 'M'} ${x} ${y}`);
    inLine = true;
  });

  const lastValid = [...data].reverse().find((d) => d.value !== null);
  const lastIdx = lastValid ? data.lastIndexOf(lastValid) : -1;

  const firstDate = data[0]?.date.slice(5) ?? '';
  const lastDate = data[n - 1]?.date.slice(5) ?? '';

  return (
    <div>
      {title && (
        <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mb-2">{title}</p>
      )}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} aria-label={title} role="img">
        {/* Axes */}
        <line
          x1={PAD.left} y1={PAD.top}
          x2={PAD.left} y2={PAD.top + INNER_H}
          stroke="currentColor" strokeOpacity={0.15}
        />
        <line
          x1={PAD.left} y1={PAD.top + INNER_H}
          x2={W - PAD.right} y2={PAD.top + INNER_H}
          stroke="currentColor" strokeOpacity={0.15}
        />
        {/* Y-axis labels */}
        <text x={PAD.left - 3} y={PAD.top + 4} textAnchor="end" fontSize={7} fontFamily="monospace" fill="currentColor" opacity={0.4}>{maxValue}{unit}</text>
        <text x={PAD.left - 3} y={PAD.top + INNER_H + 4} textAnchor="end" fontSize={7} fontFamily="monospace" fill="currentColor" opacity={0.4}>{minValue}</text>
        {/* X-axis labels */}
        <text x={PAD.left} y={H - 3} fontSize={7} fontFamily="monospace" fill="currentColor" opacity={0.4}>{firstDate}</text>
        <text x={W - PAD.right} y={H - 3} textAnchor="end" fontSize={7} fontFamily="monospace" fill="currentColor" opacity={0.4}>{lastDate}</text>
        {/* Line */}
        <path d={pathSegments.join(' ')} fill="none" stroke="var(--color-ok)" strokeWidth={2} strokeLinejoin="round" />
        {/* Dots */}
        {data.map((d, i) =>
          d.value !== null ? (
            <circle key={i} cx={toX(i)} cy={toY(d.value)} r={2.5} fill="var(--color-ok)" />
          ) : null,
        )}
        {/* Last value annotation */}
        {lastIdx >= 0 && lastValid?.value !== null && (
          <text
            x={toX(lastIdx) + 5}
            y={toY(lastValid!.value as number) + 4}
            fontSize={8}
            fontFamily="monospace"
            fill="currentColor"
            opacity={0.8}
          >
            {lastValid!.value}{unit}
          </text>
        )}
      </svg>
    </div>
  );
}
