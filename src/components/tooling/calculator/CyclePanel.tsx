import type { ReactElement } from 'react';
import { Timer, Copy, Check } from 'lucide-react';
import { CycleTimeBar, type CycleSegment } from '../visuals/CycleTimeBar';
import { formatMxn } from './formatters';
import type { SpeedsFeedsState } from './useSpeedsFeedsState';

interface CyclePanelProps {
  state: SpeedsFeedsState;
}

/** Barra de composición del ciclo + KPIs de tiempo/costo + desglose de operaciones. */
export function CyclePanel({ state }: CyclePanelProps): ReactElement {
  const {
    operationMode,
    turningCycleTime,
    millingCycleTime,
    selectedMachine,
    hasHourlyRate,
    copiedSummary,
    handleCopySummary,
    turningApInch,
    millingResult,
    millingPocketLengthInch,
    millingPocketWidthInch,
    millingPocketDepthInch,
  } = state;

  const cycleTime = operationMode === 'turning' ? turningCycleTime : millingCycleTime;
  const toolChangeSec = selectedMachine?.toolChangeSec;

  const segments: CycleSegment[] =
    operationMode === 'turning'
      ? [
          { label: 'Corte', seconds: turningCycleTime.pureCutTimeSec, colorClass: 'bg-accent' },
          {
            label: 'Retroceso rápido G00',
            seconds: turningCycleTime.rapidRetractSec,
            colorClass: 'bg-warn',
            note: 'aprox. 12% del corte',
          },
          {
            label: 'Índice torreta',
            seconds: turningCycleTime.toolChangeTimeSec,
            colorClass: 'bg-ink-dim',
            note: 'aprox. 2.5s (Haas no publica índice de torreta)',
          },
          { label: 'Chuck', seconds: turningCycleTime.partHandlingSec, colorClass: 'bg-ok' },
        ]
      : [
          { label: 'Corte', seconds: millingCycleTime.pureCutTimeSec, colorClass: 'bg-accent' },
          {
            label: 'Movimientos en vacío',
            seconds: millingCycleTime.airCutTimeSec,
            colorClass: 'bg-warn',
            note: 'aprox. 15% del corte',
          },
          {
            label: 'Cambio herramienta ATC',
            seconds: millingCycleTime.toolChangeTimeSec,
            colorClass: 'bg-ink-dim',
            note:
              toolChangeSec === undefined
                ? 'aprox. 2.8s (sin dato oficial de la máquina)'
                : `${toolChangeSec}s chip-a-chip Haas`,
          },
          { label: 'Fijación', seconds: millingCycleTime.partHandlingSec, colorClass: 'bg-ok' },
        ];

  return (
    <div className="border-2 border-line bg-surface p-4 shadow-hard">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h4 className="font-display font-black text-sm uppercase tracking-wider text-ink flex items-center gap-2">
          <Timer size={16} className="text-accent" />
          Estimador de Ciclo & Costo Haas ({operationMode === 'turning' ? 'Torno ST' : 'Centro VF'})
        </h4>
        <button
          type="button"
          onClick={handleCopySummary}
          className="cursor-pointer px-2.5 py-1 text-[10px] font-mono font-bold uppercase border-2 border-line bg-surface hover:border-accent flex items-center gap-1.5 shadow-sm"
          title="Copiar resumen técnico al portapapeles"
        >
          {copiedSummary ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
          {copiedSummary ? 'Ficha Copiada' : 'Copiar Ficha'}
        </button>
      </div>

      <CycleTimeBar segments={segments} className="mb-4" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center mb-4">
        <div className="bg-[#0D2B4D] text-white p-3 border border-line">
          <span className="text-[9px] font-mono uppercase tracking-widest opacity-70 block">Tiempo Ciclo</span>
          <span className="font-display font-black text-xl lg:text-2xl text-accent block mt-0.5">{cycleTime.formattedCycleTime}</span>
          <span className="text-[9px] font-mono opacity-60">por pieza</span>
        </div>

        <div className="bg-surface-2 p-3 border border-line">
          <span className="text-[9px] font-mono uppercase tracking-widest text-ink-dim block">Piezas / Turno</span>
          <span className="font-display font-black text-xl lg:text-2xl text-ink block mt-0.5">{cycleTime.partsPer8hShift}</span>
          <span className="text-[9px] font-mono text-ink-dim">8h al 85% OEE</span>
        </div>

        <div className="bg-surface-2 p-3 border border-line">
          <span className="text-[9px] font-mono uppercase tracking-widest text-ink-dim block">Rendimiento</span>
          <span className="font-display font-black text-xl lg:text-2xl text-ink block mt-0.5">{cycleTime.partsPerHourTheoretical}</span>
          <span className="text-[9px] font-mono text-ink-dim">piezas / hora</span>
        </div>

        <div className="bg-surface-2 p-3 border border-line">
          <span className="text-[9px] font-mono uppercase tracking-widest text-ink-dim block">Costo Maquinado</span>
          <span className={`font-display font-black text-xl lg:text-2xl block mt-0.5 ${hasHourlyRate ? 'text-ok' : 'text-ink-dim'}`}>
            {hasHourlyRate ? formatMxn(cycleTime.machiningCostPerPart) : '—'}
          </span>
          <span className="text-[9px] font-mono text-ink-dim">{hasHourlyRate ? 'por pieza' : 'captura tu tarifa'}</span>
        </div>
      </div>

      <div className="bg-surface-2/60 p-3 border border-line text-xs font-mono space-y-1">
        {operationMode === 'turning' ? (
          <>
            <div className="flex justify-between">
              <span className="text-ink-dim">Pasadas calculadas de desbaste:</span>
              <span className="font-bold text-ink">
                {turningCycleTime.roughPasses} pasadas a {turningApInch}&quot; c/u
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-dim">Tiempo de corte continuo puro:</span>
              <span className="font-bold text-ink">{turningCycleTime.pureCutTimeSec}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-dim">Retrocesos en rápido G00 + Índice torreta:</span>
              <span className="font-bold text-ink">{turningCycleTime.rapidRetractSec + turningCycleTime.toolChangeTimeSec}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-dim">Amarre y desamarre de chuck hidráulico:</span>
              <span className="font-bold text-ink">{turningCycleTime.partHandlingSec}s</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-ink-dim">Volumen estimado a remover:</span>
              <span className="font-bold text-ink">
                {(millingPocketLengthInch * millingPocketWidthInch * millingPocketDepthInch).toFixed(2)} in³
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-dim">Tiempo de corte puro (MRR {millingResult.mrrIn3Min} in³/min):</span>
              <span className="font-bold text-ink">{millingCycleTime.pureCutTimeSec}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-dim">Movimientos en vacío y ATC:</span>
              <span className="font-bold text-ink">{millingCycleTime.airCutTimeSec + millingCycleTime.toolChangeTimeSec}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-dim">Fijación en prensa de precisión:</span>
              <span className="font-bold text-ink">{millingCycleTime.partHandlingSec}s</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
