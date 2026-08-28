import { useState, useMemo, type ReactElement } from 'react';
import {
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Cpu,
  Layers,
} from 'lucide-react';
import { MATERIAL_DATABASE } from '../../lib/tooling/materialDatabase';
import { HAAS_MACHINE_PROFILES } from '../../lib/tooling/haasProfiles';
import {
  calculateTurningSpeedsFeeds,
  calculateMillingSpeedsFeeds,
} from '../../lib/tooling/speedsFeedsCalculator';
import { Input } from '../ui/input';

export function SpeedsFeedsCalculatorTab(): ReactElement {
  const [operationMode, setOperationMode] = useState<'turning' | 'milling'>('turning');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('steel_4140');
  const [selectedHaasId, setSelectedHaasId] = useState<string>('haas_st20');

  // ── Inputs Torneado ──
  const [turningDiameter, setTurningDiameter] = useState<number>(38); // mm
  const [turningVc, setTurningVc] = useState<number>(220); // m/min
  const [turningFeed, setTurningFeed] = useState<number>(0.25); // mm/rev
  const [turningAp, setTurningAp] = useState<number>(2.0); // mm
  const [turningNoseRadius, setTurningNoseRadius] = useState<number>(0.8); // mm

  // ── Inputs Fresado ──
  const [millingToolDiaInch, setMillingToolDiaInch] = useState<number>(0.5); // 1/2"
  const [millingFlutes, setMillingFlutes] = useState<number>(4);
  const [millingSfm, setMillingSfm] = useState<number>(350);
  const [millingChipLoad, setMillingChipLoad] = useState<number>(0.003); // in/tooth
  const [millingApMm, setMillingApMm] = useState<number>(6.0); // axial DOC mm
  const [millingAeMm, setMillingAeMm] = useState<number>(3.0); // radial WOC mm

  const selectedMaterial = useMemo(() => {
    return MATERIAL_DATABASE.find(m => m.id === selectedMaterialId) || MATERIAL_DATABASE[0];
  }, [selectedMaterialId]);

  const handleMaterialChange = (matId: string) => {
    setSelectedMaterialId(matId);
    const mat = MATERIAL_DATABASE.find(m => m.id === matId);
    if (!mat) return;
    // Auto-ajustar velocidades recomendadas
    setTurningVc(mat.vcTurningMMin[0] + 20);
    setTurningFeed(mat.recommendedFeedTurningMm.desbaste);
    setMillingSfm(mat.sfmMilling[0] + 50);
    setMillingChipLoad(mat.recommendedChipLoadInch[0]);
    if (mat.group === 'N') {
      setMillingFlutes(3);
    } else if (mat.group === 'M') {
      setMillingFlutes(5);
    } else {
      setMillingFlutes(4);
    }
  };

  const turningResult = useMemo(() => {
    return calculateTurningSpeedsFeeds({
      diameterMm: turningDiameter,
      cuttingSpeedMMin: turningVc,
      feedPerRevMm: turningFeed,
      depthOfCutMm: turningAp,
      noseRadiusMm: turningNoseRadius,
      materialId: selectedMaterialId,
      haasMachineId: selectedHaasId,
    });
  }, [turningDiameter, turningVc, turningFeed, turningAp, turningNoseRadius, selectedMaterialId, selectedHaasId]);

  const millingResult = useMemo(() => {
    return calculateMillingSpeedsFeeds({
      toolDiameterInch: millingToolDiaInch,
      numberOfFlutes: millingFlutes,
      surfaceFeetPerMinute: millingSfm,
      chipLoadInch: millingChipLoad,
      axialDepthOfCutMm: millingApMm,
      radialDepthOfCutMm: millingAeMm,
      materialId: selectedMaterialId,
      haasMachineId: selectedHaasId,
    });
  }, [millingToolDiaInch, millingFlutes, millingSfm, millingChipLoad, millingApMm, millingAeMm, selectedMaterialId, selectedHaasId]);

  return (
    <div className="space-y-6">
      {/* Header Selector: Torneado vs Fresado & Material & Haas Machine */}
      <div className="border-2 border-line bg-surface p-4 shadow-hard">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          {/* Tabs Operación */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setOperationMode('turning');
                setSelectedHaasId('haas_st20');
              }}
              className={`px-4 py-2 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-2 border-line transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
                operationMode === 'turning'
                  ? 'bg-accent text-bg border-accent shadow-none translate-x-[2px] translate-y-[2px]'
                  : 'bg-surface-2 text-ink hover:bg-surface-2/80'
              }`}
            >
              <RotateCcw size={15} /> Torneado CNC (Torno Haas ST)
            </button>
            <button
              onClick={() => {
                setOperationMode('milling');
                setSelectedHaasId('haas_vf2');
              }}
              className={`px-4 py-2 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-2 border-line transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
                operationMode === 'milling'
                  ? 'bg-accent text-bg border-accent shadow-none translate-x-[2px] translate-y-[2px]'
                  : 'bg-surface-2 text-ink hover:bg-surface-2/80'
              }`}
            >
              <Layers size={15} /> Fresado CNC (Haas VMC CAT40)
            </button>
          </div>

          {/* Selectores de Material y Máquina */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <div>
              <label className="block text-[9px] font-black uppercase tracking-widest text-ink-dim mb-1">
                Material de Pieza (Grupo ISO)
              </label>
              <select
                value={selectedMaterialId}
                onChange={(e) => handleMaterialChange(e.target.value)}
                className="h-9 px-3 border-2 border-line bg-surface-2 text-ink text-xs font-mono font-bold outline-none focus:border-accent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                {MATERIAL_DATABASE.map((mat) => (
                  <option key={mat.id} value={mat.id}>
                    [{mat.group}] {mat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] font-black uppercase tracking-widest text-ink-dim mb-1">
                Máquina Haas de Taller
              </label>
              <select
                value={selectedHaasId}
                onChange={(e) => setSelectedHaasId(e.target.value)}
                className="h-9 px-3 border-2 border-line bg-surface-2 text-ink text-xs font-mono font-bold outline-none focus:border-accent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                {HAAS_MACHINE_PROFILES.filter((m) =>
                  operationMode === 'turning' ? m.type === 'lathe' : m.type === 'mill'
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.horsepower} HP)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Resumen del Material Seleccionado */}
        <div className="mt-4 pt-3 border-t-2 border-line/50 flex flex-wrap items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="bg-accent/20 text-accent font-bold px-2 py-0.5 border border-accent/40 text-[10px]">
              GRUPO {selectedMaterial.group}
            </span>
            <span className="font-bold text-ink">{selectedMaterial.name}</span>
          </div>
          <div className="text-ink-dim">
            Dureza: <span className="text-ink font-bold">{selectedMaterial.hardnessTypical}</span>
          </div>
          <div className="text-ink-dim">
            Fuerza de corte Kc: <span className="text-accent font-bold">{selectedMaterial.kc} N/mm²</span>
          </div>
          <div className="text-ink-dim text-[11px] italic hidden sm:block">
            {selectedMaterial.chipCharacteristics}
          </div>
        </div>
      </div>

      {/* Panel Central: Inputs a la izquierda, Resultados de Alta Ingeniería a la derecha */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* COLUMNA IZQUIERDA: INPUTS */}
        <div className="lg:col-span-5 border-2 border-line bg-surface p-5 shadow-hard space-y-4">
          <div className="flex items-center justify-between border-b-2 border-line pb-2 mb-3">
            <h3 className="font-display font-black text-sm uppercase tracking-wider flex items-center gap-2">
              <Sliders size={16} className="text-accent" />
              Parámetros de Corte ({operationMode === 'turning' ? 'Torno' : 'Fresa'})
            </h3>
            <span className="font-mono text-[10px] text-ink-dim uppercase">Ajuste Dinámico</span>
          </div>

          {operationMode === 'turning' ? (
            <>
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="font-bold">Diámetro de la Pieza (D)</span>
                  <span className="text-accent font-bold">{turningDiameter} mm</span>
                </div>
                <Input
                  type="number"
                  step="0.5"
                  value={turningDiameter}
                  onChange={(e) => setTurningDiameter(Number(e.target.value))}
                  className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                />
                <input
                  type="range"
                  min="3"
                  max="150"
                  value={turningDiameter}
                  onChange={(e) => setTurningDiameter(Number(e.target.value))}
                  className="w-full mt-1 accent-accent"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="font-bold">Velocidad de Corte (Vc)</span>
                  <span className="text-accent font-bold">{turningVc} m/min</span>
                </div>
                <Input
                  type="number"
                  step="5"
                  value={turningVc}
                  onChange={(e) => setTurningVc(Number(e.target.value))}
                  className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                />
                <p className="text-[10px] font-mono text-ink-dim mt-0.5">
                  Rango recomendado para {selectedMaterial.name}: {selectedMaterial.vcTurningMMin[0]} - {selectedMaterial.vcTurningMMin[1]} m/min
                </p>
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="font-bold">Avance por Revolución (fn)</span>
                  <span className="text-accent font-bold">{turningFeed} mm/rev</span>
                </div>
                <Input
                  type="number"
                  step="0.01"
                  value={turningFeed}
                  onChange={(e) => setTurningFeed(Number(e.target.value))}
                  className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => setTurningFeed(0.08)}
                    className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
                  >
                    Acabado (0.08)
                  </button>
                  <button
                    onClick={() => setTurningFeed(0.18)}
                    className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
                  >
                    Medio (0.18)
                  </button>
                  <button
                    onClick={() => setTurningFeed(0.28)}
                    className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
                  >
                    Desbaste (0.28)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono font-bold mb-1">Profundidad (ap)</label>
                  <Input
                    type="number"
                    step="0.1"
                    value={turningAp}
                    onChange={(e) => setTurningAp(Number(e.target.value))}
                    className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                  />
                  <span className="text-[9px] font-mono text-ink-dim">mm por pasada</span>
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold mb-1">Radio Punta (r)</label>
                  <select
                    value={turningNoseRadius}
                    onChange={(e) => setTurningNoseRadius(Number(e.target.value))}
                    className="w-full h-9 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2"
                  >
                    <option value={0.2}>0.2 mm (R02 - Fino)</option>
                    <option value={0.4}>0.4 mm (R04 - Acabado)</option>
                    <option value={0.8}>0.8 mm (R08 - General)</option>
                    <option value={1.2}>1.2 mm (R12 - Desbaste)</option>
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Controles de Fresado */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="font-bold">Diámetro Fresa (D)</span>
                  <span className="text-accent font-bold">{millingToolDiaInch}" ({ (millingToolDiaInch * 25.4).toFixed(2) } mm)</span>
                </div>
                <select
                  value={millingToolDiaInch}
                  onChange={(e) => setMillingToolDiaInch(Number(e.target.value))}
                  className="w-full h-9 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2"
                >
                  <option value={0.125}>1/8" (3.17 mm)</option>
                  <option value={0.25}>1/4" (6.35 mm)</option>
                  <option value={0.375}>3/8" (9.52 mm)</option>
                  <option value={0.5}>1/2" (12.70 mm)</option>
                  <option value={0.625}>5/8" (15.87 mm)</option>
                  <option value={0.75}>3/4" (19.05 mm)</option>
                  <option value={1.0}>1.0" (25.40 mm)</option>
                  <option value={2.0}>2.0" (50.8 mm - Face Mill)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono font-bold mb-1">Número de Filos (Z)</label>
                  <select
                    value={millingFlutes}
                    onChange={(e) => setMillingFlutes(Number(e.target.value))}
                    className="w-full h-9 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2"
                  >
                    <option value={2}>2 Filos (Aluminio/Plásticos)</option>
                    <option value={3}>3 Filos (Aluminio Alta Vel.)</option>
                    <option value={4}>4 Filos (Aceros General)</option>
                    <option value={5}>5 Filos (Inox/Titanio)</option>
                    <option value={6}>6 Filos (Trocoidal / Duros)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold mb-1">SFM (Vel. Superficie)</label>
                  <Input
                    type="number"
                    step="10"
                    value={millingSfm}
                    onChange={(e) => setMillingSfm(Number(e.target.value))}
                    className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="font-bold">Chip Load (fz / FPT)</span>
                  <span className="text-accent font-bold">{millingChipLoad}"/diente</span>
                </div>
                <Input
                  type="number"
                  step="0.0005"
                  value={millingChipLoad}
                  onChange={(e) => setMillingChipLoad(Number(e.target.value))}
                  className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono font-bold mb-1">Prof. Axial (ap)</label>
                  <Input
                    type="number"
                    step="0.5"
                    value={millingApMm}
                    onChange={(e) => setMillingApMm(Number(e.target.value))}
                    className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                  />
                  <span className="text-[9px] font-mono text-ink-dim">mm profundidad</span>
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold mb-1">Paso Radial (ae)</label>
                  <Input
                    type="number"
                    step="0.5"
                    value={millingAeMm}
                    onChange={(e) => setMillingAeMm(Number(e.target.value))}
                    className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                  />
                  <span className="text-[9px] font-mono text-ink-dim">mm stepover</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* COLUMNA DERECHA: RESULTADOS TÉCNICOS & GAUGES */}
        <div className="lg:col-span-7 space-y-4">
          {/* Tarjetas Principales de Salida */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="border-2 border-line bg-surface p-4 shadow-hard text-center">
              <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">Velocidad Husillo</span>
              <span className="font-display font-black text-2xl lg:text-3xl text-accent block mt-1">
                {(operationMode === 'turning' ? turningResult.rpm : millingResult.rpm).toLocaleString()}
              </span>
              <span className="font-mono text-[10px] text-ink-dim font-bold">RPM</span>
            </div>

            <div className="border-2 border-line bg-surface p-4 shadow-hard text-center">
              <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">Avance de Mesa (F)</span>
              <span className="font-display font-black text-2xl lg:text-3xl text-ink block mt-1">
                {operationMode === 'turning' ? turningResult.feedRateMmMin : millingResult.tableFeedMmMin}
              </span>
              <span className="font-mono text-[10px] text-ink-dim font-bold">
                mm/min {operationMode === 'milling' ? `(${millingResult.tableFeedIpm} IPM)` : ''}
              </span>
            </div>

            <div className="border-2 border-line bg-surface p-4 shadow-hard text-center">
              <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">
                {operationMode === 'turning' ? 'Acabado Teórico Ra' : 'Chip Thinning (RCTF)'}
              </span>
              <span className="font-display font-black text-2xl lg:text-3xl text-ok block mt-1">
                {operationMode === 'turning'
                  ? `${turningResult.theoreticalSurfaceRoughnessRaUm} µm`
                  : `${millingResult.radialChipThinningFactor}x`}
              </span>
              <span className="font-mono text-[10px] text-ink-dim font-bold">
                {operationMode === 'turning'
                  ? `(Rz ~ ${turningResult.theoreticalSurfaceRoughnessRzUm} µm)`
                  : millingResult.radialChipThinningFactor > 1
                    ? `Avance Ajust: ${millingResult.adjustedFeedIpm} IPM`
                    : 'Sin compensación'}
              </span>
              {operationMode === 'milling' && (
                <span className="font-mono text-[9px] text-ink-dim/70 block mt-0.5">
                  Viruta real por diente: {millingResult.effectiveChipLoadInch}" (programada: {millingChipLoad}")
                </span>
              )}
            </div>

            <div className="border-2 border-line bg-surface p-4 shadow-hard text-center">
              <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">Potencia Requerida</span>
              <span className="font-display font-black text-2xl lg:text-3xl text-ink block mt-1">
                {operationMode === 'turning' ? turningResult.motorPowerHpRequired : millingResult.motorPowerHpRequired}
              </span>
              <span className="font-mono text-[10px] text-ink-dim font-bold">
                HP ({operationMode === 'turning' ? turningResult.netPowerKw : millingResult.netPowerKw} kW)
              </span>
            </div>
          </div>

          {/* Fórmulas Aplicadas y Desglose Técnico */}
          <div className="border-2 border-line bg-surface p-4 shadow-hard">
            <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink mb-2 flex items-center gap-2">
              <Cpu size={14} className="text-accent" />
              Fórmulas Aplicadas en Tiempo Real
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono bg-surface-2 p-3 border border-line">
              <div>
                <span className="text-ink-dim block text-[10px]">Cálculo de RPM:</span>
                <code className="text-ink font-bold">
                  {operationMode === 'turning'
                    ? `n = (Vc × 1000) / (π × D) = (${turningVc} × 1000) / (π × ${turningDiameter}) = ${turningResult.rpm} RPM`
                    : `n = (SFM × 3.82) / D = (${millingSfm} × 3.82) / ${millingToolDiaInch} = ${millingResult.rpm} RPM`}
                </code>
              </div>
              <div>
                <span className="text-ink-dim block text-[10px]">Tasa de Remoción (MRR):</span>
                <code className="text-ink font-bold">
                  {operationMode === 'turning'
                    ? `MRR = Vc × ap × fn = ${turningResult.mrrCm3Min} cm³/min`
                    : `MRR = ap × ae × vf = ${millingResult.mrrCm3Min} cm³/min`}
                </code>
              </div>
              <div>
                <span className="text-ink-dim block text-[10px]">Potencia de Corte:</span>
                <code className="text-ink font-bold">
                  Pc = (MRR × Kc) / (60 × 10³) = {operationMode === 'turning' ? turningResult.netPowerKw : millingResult.netPowerKw} kW (
                  {operationMode === 'turning' ? turningResult.motorPowerHpRequired : millingResult.motorPowerHpRequired} HP motor)
                </code>
              </div>
              <div>
                <span className="text-ink-dim block text-[10px]">
                  {operationMode === 'turning' ? 'Fórmula de Rugosidad Ra:' : 'Fórmula Chip Thinning (RCTF):'}
                </span>
                <code className="text-ink font-bold">
                  {operationMode === 'turning'
                    ? `Ra = fn² / (32 × r) = ${turningFeed}² / (32 × ${turningNoseRadius}) = ${turningResult.theoreticalSurfaceRoughnessRaUm} µm`
                    : `RCTF = 1 / √(1 - (1 - 2×ae/D)²) = ${millingResult.radialChipThinningFactor}`}
                </code>
              </div>
            </div>
          </div>

          {/* Alertas y Tips Técnicos de Taller */}
          {((operationMode === 'turning' ? turningResult.warnings : millingResult.warnings).length > 0 ||
            (operationMode === 'turning' ? turningResult.tips : millingResult.tips).length > 0) && (
            <div className="space-y-2">
              {(operationMode === 'turning' ? turningResult.warnings : millingResult.warnings).map((w, idx) => (
                <div key={idx} className="flex items-start gap-2 border-2 border-warn/70 bg-warn/10 p-3 text-xs font-mono text-ink">
                  <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}

              {(operationMode === 'turning' ? turningResult.tips : millingResult.tips).map((t, idx) => (
                <div key={idx} className="flex items-start gap-2 border-2 border-accent/60 bg-accent/5 p-3 text-xs font-mono text-ink">
                  <CheckCircle2 size={15} className="text-accent shrink-0 mt-0.5" />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
