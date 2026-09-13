import type { ReactElement } from 'react';
import { AlertTriangle, CheckCircle2, Cpu } from 'lucide-react';
import { ArcGauge } from '../visuals/ArcGauge';
import { RangeBand } from '../visuals/RangeBand';
import { TurningCutDiagram } from '../visuals/TurningCutDiagram';
import { MillingCutDiagram } from '../visuals/MillingCutDiagram';
import { RoughnessProfile } from '../visuals/RoughnessProfile';
import { buildMillingDiagramLabels, buildTurningDiagramLabels, parseInputNumber } from './formatters';
import type { SpeedsFeedsState } from './useSpeedsFeedsState';

interface ResultsPanelProps {
  state: SpeedsFeedsState;
}

/** Diagrama de corte, gauges, KPIs, rugosidad/chip-thinning, warnings y fórmulas. */
export function ResultsPanel({ state }: ResultsPanelProps): ReactElement {
  const {
    operationMode,
    unitSystem,
    turningResult,
    millingResult,
    turningDiagramMm,
    millingDiagramMm,
    speedRangeBand,
    targetRaUm,
    setTargetRaUm,
    millingFlutes,
    selectedMaterial,
  } = state;

  const activeResult = operationMode === 'turning' ? turningResult : millingResult;
  const machine = activeResult.machine;

  const rpmValue = machine?.usableRpm ?? activeResult.rpm;
  const rpmMax = machine?.maxRpm ?? activeResult.rpm;
  const hpMax = machine?.availableHpAtRpm ?? machine?.ratedHp ?? activeResult.motorPowerHpRequired;

  return (
    <div className="space-y-4">
      {/* 1. Diagrama de corte */}
      <div className="border-2 border-line bg-surface p-4 shadow-hard">
        {operationMode === 'turning' ? (
          <TurningCutDiagram
            diameterMm={turningDiagramMm.diameterMm}
            depthOfCutMm={turningDiagramMm.depthOfCutMm}
            feedMm={turningDiagramMm.feedMm}
            noseRadiusMm={turningDiagramMm.noseRadiusMm}
            rpm={rpmValue}
            labels={buildTurningDiagramLabels({ ...turningDiagramMm, unitSystem })}
          />
        ) : (
          <MillingCutDiagram
            toolDiameterMm={millingDiagramMm.toolDiameterMm}
            numberOfFlutes={millingFlutes}
            radialDepthMm={millingDiagramMm.radialDepthMm}
            axialDepthMm={millingDiagramMm.axialDepthMm}
            engagementAngleDeg={millingResult.engagementAngleDeg}
            rpm={rpmValue}
            labels={buildMillingDiagramLabels({
              ...millingDiagramMm,
              tableFeedMmMin: millingResult.tableFeedMmMin,
              unitSystem,
            })}
          />
        )}
      </div>

      {/* 2. Gauges + banda de rango */}
      <div className="border-2 border-line bg-surface p-4 shadow-hard grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
        <ArcGauge
          value={rpmValue}
          max={rpmMax}
          label="Husillo"
          unit="RPM"
          caption={machine ? `usable ${machine.usableRpm.toLocaleString()}` : undefined}
        />
        <ArcGauge
          value={activeResult.motorPowerHpRequired}
          max={hpMax}
          label="Potencia Motor"
          unit="HP"
          formatValue={(v) => v.toFixed(1)}
        />
        <RangeBand
          value={speedRangeBand.value}
          min={speedRangeBand.min}
          max={speedRangeBand.max}
          unit={speedRangeBand.unit}
          label={operationMode === 'turning' ? 'Velocidad de Corte' : 'Velocidad Superficial'}
          sourceHint={selectedMaterial.source}
        />
      </div>

      {/* 3. KPI tiles + MRR */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="border-2 border-line bg-surface p-4 shadow-hard text-center">
          <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">Velocidad Husillo</span>
          <span className="font-display font-black text-2xl lg:text-3xl text-accent block mt-1">
            {activeResult.rpm.toLocaleString()}
          </span>
          <span className="font-mono text-[10px] text-ink-dim font-bold">RPM</span>
        </div>

        <div className="border-2 border-line bg-surface p-4 shadow-hard text-center">
          <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">Avance de Mesa (F)</span>
          <span className="font-display font-black text-2xl lg:text-3xl text-ink block mt-1">
            {unitSystem === 'imperial'
              ? operationMode === 'turning'
                ? `${turningResult.feedRateIpm} IPM`
                : `${millingResult.tableFeedIpm} IPM`
              : operationMode === 'turning'
                ? `${turningResult.feedRateMmMin} mm/min`
                : `${millingResult.tableFeedMmMin} mm/min`}
          </span>
          <span className="font-mono text-[10px] text-ink-dim font-bold">
            {unitSystem === 'imperial'
              ? operationMode === 'turning'
                ? `(${turningResult.feedRateMmMin} mm/min)`
                : `(${millingResult.tableFeedMmMin} mm/min)`
              : operationMode === 'turning'
                ? `(${turningResult.feedRateIpm} IPM)`
                : `(${millingResult.tableFeedIpm} IPM)`}
          </span>
        </div>

        <div className="border-2 border-line bg-surface p-4 shadow-hard text-center">
          <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">
            {operationMode === 'turning' ? 'Acabado Teórico Ra' : 'Chip Thinning (RCTF)'}
          </span>
          <span className="font-display font-black text-2xl lg:text-3xl text-ok block mt-1">
            {operationMode === 'turning'
              ? unitSystem === 'imperial'
                ? `${turningResult.theoreticalSurfaceRoughnessRaUin} µin`
                : `${turningResult.theoreticalSurfaceRoughnessRaUm} µm`
              : `${millingResult.radialChipThinningFactor}x`}
          </span>
          <span className="font-mono text-[10px] text-ink-dim font-bold">
            {operationMode === 'turning'
              ? unitSystem === 'imperial'
                ? `(${turningResult.theoreticalSurfaceRoughnessRaUm} µm)`
                : `(${turningResult.theoreticalSurfaceRoughnessRaUin} µin)`
              : millingResult.radialChipThinningFactor > 1
                ? unitSystem === 'imperial'
                  ? `Avance Ajust: ${millingResult.adjustedFeedIpm} IPM`
                  : `Avance Ajust: ${(millingResult.adjustedFeedIpm * 25.4).toFixed(1)} mm/min`
                : 'Sin compensación'}
          </span>
        </div>

        <div className="border-2 border-line bg-surface p-4 shadow-hard text-center">
          <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">Potencia Requerida</span>
          <span className="font-display font-black text-2xl lg:text-3xl text-ink block mt-1">
            {activeResult.motorPowerHpRequired}
          </span>
          <span className="font-mono text-[10px] text-ink-dim font-bold">HP ({activeResult.netPowerKw} kW)</span>
        </div>
      </div>

      <div className="border-2 border-line bg-surface p-3 px-4 shadow-hard flex items-center justify-between flex-wrap gap-2">
        <span className="font-mono text-xs uppercase font-bold text-ink-dim">Tasa de Remoción de Material (MRR):</span>
        <span className="font-mono text-sm font-black text-accent">
          {activeResult.mrrIn3Min} in³/min ({activeResult.mrrCm3Min} cm³/min)
        </span>
      </div>

      {/* 4. Rugosidad (torno) / ángulo de contacto (fresa) */}
      {operationMode === 'turning' ? (
        <div className="border-2 border-line bg-surface p-4 shadow-hard space-y-2">
          <RoughnessProfile
            feedMm={turningDiagramMm.feedMm}
            noseRadiusMm={turningDiagramMm.noseRadiusMm}
            raUm={turningResult.theoreticalSurfaceRoughnessRaUm}
            targetRaUm={targetRaUm ?? undefined}
            unitSystem={unitSystem}
          />
          <div className="flex items-center gap-2">
            <label htmlFor="sf-target-ra" className="font-mono text-[10px] font-bold text-ink-dim uppercase">
              Ra objetivo del plano (µm)
            </label>
            <input
              id="sf-target-ra"
              type="number"
              step="0.1"
              min="0"
              placeholder="opcional"
              value={targetRaUm ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw.trim() === '') {
                  setTargetRaUm(null);
                  return;
                }
                setTargetRaUm(parseInputNumber(raw, targetRaUm ?? 0));
              }}
              className="h-7 w-24 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2 outline-none focus:border-accent"
            />
          </div>
        </div>
      ) : (
        <div className="border-2 border-line bg-surface p-4 shadow-hard flex items-center justify-between flex-wrap gap-2">
          <span className="font-mono text-xs uppercase font-bold text-ink-dim">Ángulo de contacto (θ):</span>
          <span className="font-mono text-sm font-black text-accent">{millingResult.engagementAngleDeg}°</span>
        </div>
      )}

      {/* 5. Warnings / tips */}
      {(activeResult.warnings.length > 0 || activeResult.tips.length > 0) && (
        <div className="space-y-2">
          {activeResult.warnings.map((w, idx) => (
            <div key={idx} className="flex items-start gap-2 border-2 border-warn/70 bg-warn/10 p-3 text-xs font-mono text-ink">
              <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
          {activeResult.tips.map((t, idx) => (
            <div key={idx} className="flex items-start gap-2 border-2 border-accent/60 bg-accent/5 p-3 text-xs font-mono text-ink">
              <CheckCircle2 size={15} className="text-accent shrink-0 mt-0.5" />
              <span>{t}</span>
            </div>
          ))}
        </div>
      )}

      {/* 6. Fórmulas aplicadas */}
      <details className="border-2 border-line bg-surface p-4 shadow-hard">
        <summary className="font-display font-black text-xs uppercase tracking-wider text-ink flex items-center gap-2 cursor-pointer">
          <Cpu size={14} className="text-accent" />
          Fórmulas Aplicadas en Tiempo Real (Sistema {unitSystem === 'imperial' ? 'Imperial' : 'Métrico'})
        </summary>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono bg-surface-2 p-3 border border-line mt-2">
          <div>
            <span className="text-ink-dim block text-[10px]">Cálculo de RPM:</span>
            <code className="text-ink font-bold">
              {operationMode === 'turning'
                ? `n = (Vc × 1000) / (π × D) = ${turningResult.rpm} RPM`
                : `n = (SFM × 3.82) / D = ${millingResult.rpm} RPM`}
            </code>
          </div>
          <div>
            <span className="text-ink-dim block text-[10px]">Avance de Mesa (Feed):</span>
            <code className="text-ink font-bold">
              {operationMode === 'turning'
                ? `vf = n × fn = ${unitSystem === 'imperial' ? `${turningResult.feedRateIpm} IPM` : `${turningResult.feedRateMmMin} mm/min`}`
                : `vf = n × fz × Z = ${millingResult.tableFeedIpm} IPM`}
            </code>
          </div>
          <div>
            <span className="text-ink-dim block text-[10px]">Potencia de Corte Estimada:</span>
            <code className="text-ink font-bold">
              Pc = {activeResult.netPowerHp} HP netos ({activeResult.motorPowerHpRequired} HP motor al 80% ef.)
            </code>
          </div>
          <div>
            <span className="text-ink-dim block text-[10px]">
              {operationMode === 'turning' ? 'Fórmula de Rugosidad Ra:' : 'Fórmula Chip Thinning (RCTF):'}
            </span>
            <code className="text-ink font-bold">
              {operationMode === 'turning'
                ? `Ra = fn² / (32 × r) = ${turningResult.theoreticalSurfaceRoughnessRaUin} µin (${turningResult.theoreticalSurfaceRoughnessRaUm} µm)`
                : `RCTF = 1 / √(1 - (1 - 2×ae/D)²) = ${millingResult.radialChipThinningFactor}`}
            </code>
          </div>
        </div>
      </details>
    </div>
  );
}
