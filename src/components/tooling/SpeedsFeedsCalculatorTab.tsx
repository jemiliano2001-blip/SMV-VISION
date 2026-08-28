import { useState, useMemo, type ReactElement } from 'react';
import {
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Cpu,
  Layers,
  Ruler,
} from 'lucide-react';
import { MATERIAL_DATABASE } from '../../lib/tooling/materialDatabase';
import { HAAS_MACHINE_PROFILES } from '../../lib/tooling/haasProfiles';
import {
  calculateTurningSpeedsFeeds,
  calculateMillingSpeedsFeeds,
} from '../../lib/tooling/speedsFeedsCalculator';
import { Input } from '../ui/input';

type UnitSystem = 'imperial' | 'metric';

export function SpeedsFeedsCalculatorTab(): ReactElement {
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial');
  const [operationMode, setOperationMode] = useState<'turning' | 'milling'>('turning');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('steel_4140');
  const [selectedHaasId, setSelectedHaasId] = useState<string>('haas_st20');

  // ── Inputs Torneado (Almacenados en Imperial/Métrico según sistema) ──
  const [turningDiameterInch, setTurningDiameterInch] = useState<number>(1.5); // 1.500"
  const [turningSfm, setTurningSfm] = useState<number>(450); // SFM
  const [turningFeedIpr, setTurningFeedIpr] = useState<number>(0.008); // in/rev
  const [turningApInch, setTurningApInch] = useState<number>(0.080); // in
  const [turningNoseRadiusInch, setTurningNoseRadiusInch] = useState<number>(0.0312); // 1/32"

  const [turningDiameterMm, setTurningDiameterMm] = useState<number>(38); // mm
  const [turningVc, setTurningVc] = useState<number>(140); // m/min
  const [turningFeedMm, setTurningFeedMm] = useState<number>(0.20); // mm/rev
  const [turningApMm, setTurningApMm] = useState<number>(2.0); // mm
  const [turningNoseRadiusMm, setTurningNoseRadiusMm] = useState<number>(0.8); // mm

  // ── Inputs Fresado ──
  const [millingToolDiaInch, setMillingToolDiaInch] = useState<number>(0.5); // 1/2"
  const [millingFlutes, setMillingFlutes] = useState<number>(4);
  const [millingSfm, setMillingSfm] = useState<number>(350);
  const [millingChipLoadInch, setMillingChipLoadInch] = useState<number>(0.003); // in/tooth
  const [millingApInch, setMillingApInch] = useState<number>(0.250); // in
  const [millingAeInch, setMillingAeInch] = useState<number>(0.125); // in

  const selectedMaterial = useMemo(() => {
    return MATERIAL_DATABASE.find(m => m.id === selectedMaterialId) || MATERIAL_DATABASE[0];
  }, [selectedMaterialId]);

  const handleMaterialChange = (matId: string) => {
    setSelectedMaterialId(matId);
    const mat = MATERIAL_DATABASE.find(m => m.id === matId);
    if (!mat) return;
    // Auto-ajustar velocidades recomendadas en ambos sistemas
    const sfmTurn = mat.sfmTurning ? mat.sfmTurning[0] : Math.round(mat.vcTurningMMin[0] * 3.28);
    setTurningSfm(sfmTurn);
    setTurningVc(mat.vcTurningMMin[0]);
    setTurningFeedIpr(mat.recommendedFeedTurningInch?.desbaste ?? 0.008);
    setTurningFeedMm(mat.recommendedFeedTurningMm.desbaste);

    setMillingSfm(mat.sfmMilling[0]);
    setMillingChipLoadInch(mat.recommendedChipLoadInch[0]);
    if (mat.group === 'N') {
      setMillingFlutes(3);
    } else if (mat.group === 'M') {
      setMillingFlutes(5);
    } else {
      setMillingFlutes(4);
    }
  };

  // Convertir valores para el cálculo según el sistema activo
  const turningResult = useMemo(() => {
    const dMm = unitSystem === 'imperial' ? turningDiameterInch * 25.4 : turningDiameterMm;
    const vcMMin = unitSystem === 'imperial' ? turningSfm / 3.28084 : turningVc;
    const fnMm = unitSystem === 'imperial' ? turningFeedIpr * 25.4 : turningFeedMm;
    const apMm = unitSystem === 'imperial' ? turningApInch * 25.4 : turningApMm;
    const rMm = unitSystem === 'imperial' ? turningNoseRadiusInch * 25.4 : turningNoseRadiusMm;

    return calculateTurningSpeedsFeeds({
      diameterMm: dMm,
      cuttingSpeedMMin: vcMMin,
      feedPerRevMm: fnMm,
      depthOfCutMm: apMm,
      noseRadiusMm: rMm,
      materialId: selectedMaterialId,
      haasMachineId: selectedHaasId,
    });
  }, [
    unitSystem,
    turningDiameterInch,
    turningDiameterMm,
    turningSfm,
    turningVc,
    turningFeedIpr,
    turningFeedMm,
    turningApInch,
    turningApMm,
    turningNoseRadiusInch,
    turningNoseRadiusMm,
    selectedMaterialId,
    selectedHaasId,
  ]);

  const millingResult = useMemo(() => {
    const apMm = millingApInch * 25.4;
    const aeMm = millingAeInch * 25.4;

    return calculateMillingSpeedsFeeds({
      toolDiameterInch: millingToolDiaInch,
      numberOfFlutes: millingFlutes,
      surfaceFeetPerMinute: millingSfm,
      chipLoadInch: millingChipLoadInch,
      axialDepthOfCutMm: apMm,
      radialDepthOfCutMm: aeMm,
      materialId: selectedMaterialId,
      haasMachineId: selectedHaasId,
    });
  }, [
    millingToolDiaInch,
    millingFlutes,
    millingSfm,
    millingChipLoadInch,
    millingApInch,
    millingAeInch,
    selectedMaterialId,
    selectedHaasId,
  ]);

  return (
    <div className="space-y-6">
      {/* Header Selector: Operación + Sistema de Unidades + Material & Haas Machine */}
      <div className="border-2 border-line bg-surface p-4 shadow-hard">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          {/* Tabs Operación */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOperationMode('turning');
                setSelectedHaasId('haas_st20');
              }}
              className={`px-3.5 py-2 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-2 border-line transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
                operationMode === 'turning'
                  ? 'bg-accent text-bg border-accent shadow-none translate-x-[2px] translate-y-[2px]'
                  : 'bg-surface-2 text-ink hover:bg-surface-2/80'
              }`}
            >
              <RotateCcw size={15} /> Torneado CNC (Haas ST)
            </button>
            <button
              type="button"
              onClick={() => {
                setOperationMode('milling');
                setSelectedHaasId('haas_vf2');
              }}
              className={`px-3.5 py-2 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-2 border-line transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
                operationMode === 'milling'
                  ? 'bg-accent text-bg border-accent shadow-none translate-x-[2px] translate-y-[2px]'
                  : 'bg-surface-2 text-ink hover:bg-surface-2/80'
              }`}
            >
              <Layers size={15} /> Fresado CNC (Haas VF)
            </button>
          </div>

          {/* Selector de Unidades: Imperial (Pulgadas) vs Métrico (mm) */}
          <div className="flex items-center border-2 border-line bg-surface-2 p-0.5 shadow-sm">
            <span className="font-mono text-[9px] uppercase font-bold text-ink-dim px-2 flex items-center gap-1">
              <Ruler size={11} className="text-accent" /> Unidades:
            </span>
            <button
              type="button"
              onClick={() => setUnitSystem('imperial')}
              className={`px-3 py-1 text-[11px] font-mono font-black uppercase tracking-wider transition-all ${
                unitSystem === 'imperial'
                  ? 'bg-accent text-bg font-bold shadow-sm'
                  : 'text-ink-dim hover:text-ink'
              }`}
            >
              Pulgadas (Imperial)
            </button>
            <button
              type="button"
              onClick={() => setUnitSystem('metric')}
              className={`px-3 py-1 text-[11px] font-mono font-black uppercase tracking-wider transition-all ${
                unitSystem === 'metric'
                  ? 'bg-accent text-bg font-bold shadow-sm'
                  : 'text-ink-dim hover:text-ink'
              }`}
            >
              Milímetros (Métrico)
            </button>
          </div>
        </div>

        {/* Fila de Selectores: Material y Máquina Haas */}
        <div className="mt-4 pt-3 border-t-2 border-line/40 flex flex-wrap items-center justify-between gap-4">
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

          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="bg-accent/20 text-accent font-bold px-2 py-0.5 border border-accent/40 text-[10px]">
              GRUPO {selectedMaterial.group}
            </span>
            <span className="text-ink-dim font-bold">
              Dureza: <span className="text-ink">{selectedMaterial.hardnessTypical}</span>
            </span>
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
            <span className="font-mono text-[10px] text-accent uppercase font-bold">
              {unitSystem === 'imperial' ? 'Pulgadas (Imperial)' : 'Métrico (mm)'}
            </span>
          </div>

          {operationMode === 'turning' ? (
            <>
              {/* Diámetro de la pieza */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="font-bold">Diámetro de la Pieza (D)</span>
                  <span className="text-accent font-bold">
                    {unitSystem === 'imperial'
                      ? `${turningDiameterInch.toFixed(3)}" (${(turningDiameterInch * 25.4).toFixed(1)} mm)`
                      : `${turningDiameterMm} mm (${(turningDiameterMm / 25.4).toFixed(3)}")`}
                  </span>
                </div>
                {unitSystem === 'imperial' ? (
                  <>
                    <Input
                      type="number"
                      step="0.05"
                      min="0.1"
                      max="10"
                      value={turningDiameterInch}
                      onChange={(e) => setTurningDiameterInch(Number(e.target.value))}
                      className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setTurningDiameterInch(d)}
                          className={`text-[9px] font-mono px-2 py-0.5 border ${
                            turningDiameterInch === d
                              ? 'bg-accent text-bg border-accent font-bold'
                              : 'bg-surface-2 border-line text-ink hover:border-accent'
                          }`}
                        >
                          {d}&quot;
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <Input
                      type="number"
                      step="0.5"
                      value={turningDiameterMm}
                      onChange={(e) => setTurningDiameterMm(Number(e.target.value))}
                      className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                    />
                    <input
                      type="range"
                      min="3"
                      max="150"
                      value={turningDiameterMm}
                      onChange={(e) => setTurningDiameterMm(Number(e.target.value))}
                      className="w-full mt-1 accent-accent"
                    />
                  </>
                )}
              </div>

              {/* Velocidad de corte */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="font-bold">
                    {unitSystem === 'imperial' ? 'Velocidad Superficial (SFM)' : 'Velocidad de Corte (Vc)'}
                  </span>
                  <span className="text-accent font-bold">
                    {unitSystem === 'imperial'
                      ? `${turningSfm} SFM (${(turningSfm / 3.28084).toFixed(0)} m/min)`
                      : `${turningVc} m/min (${(turningVc * 3.28084).toFixed(0)} SFM)`}
                  </span>
                </div>
                {unitSystem === 'imperial' ? (
                  <Input
                    type="number"
                    step="10"
                    value={turningSfm}
                    onChange={(e) => setTurningSfm(Number(e.target.value))}
                    className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                  />
                ) : (
                  <Input
                    type="number"
                    step="5"
                    value={turningVc}
                    onChange={(e) => setTurningVc(Number(e.target.value))}
                    className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                  />
                )}
              </div>

              {/* Avance por revolución */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="font-bold">
                    {unitSystem === 'imperial' ? 'Avance por Rev (IPR)' : 'Avance por Rev (fn)'}
                  </span>
                  <span className="text-accent font-bold">
                    {unitSystem === 'imperial'
                      ? `${turningFeedIpr.toFixed(4)}" IPR (${(turningFeedIpr * 25.4).toFixed(2)} mm/rev)`
                      : `${turningFeedMm} mm/rev (${(turningFeedMm / 25.4).toFixed(4)}" IPR)`}
                  </span>
                </div>
                {unitSystem === 'imperial' ? (
                  <>
                    <Input
                      type="number"
                      step="0.0005"
                      value={turningFeedIpr}
                      onChange={(e) => setTurningFeedIpr(Number(e.target.value))}
                      className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                    />
                    <div className="flex gap-2 mt-1.5">
                      <button
                        type="button"
                        onClick={() => setTurningFeedIpr(0.003)}
                        className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
                      >
                        Acabado (.003&quot;)
                      </button>
                      <button
                        type="button"
                        onClick={() => setTurningFeedIpr(0.007)}
                        className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
                      >
                        Medio (.007&quot;)
                      </button>
                      <button
                        type="button"
                        onClick={() => setTurningFeedIpr(0.012)}
                        className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
                      >
                        Desbaste (.012&quot;)
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <Input
                      type="number"
                      step="0.01"
                      value={turningFeedMm}
                      onChange={(e) => setTurningFeedMm(Number(e.target.value))}
                      className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                    />
                    <div className="flex gap-2 mt-1.5">
                      <button
                        type="button"
                        onClick={() => setTurningFeedMm(0.08)}
                        className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
                      >
                        Acabado (0.08)
                      </button>
                      <button
                        type="button"
                        onClick={() => setTurningFeedMm(0.18)}
                        className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
                      >
                        Medio (0.18)
                      </button>
                      <button
                        type="button"
                        onClick={() => setTurningFeedMm(0.28)}
                        className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
                      >
                        Desbaste (0.28)
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Profundidad de corte y Radio de punta */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono font-bold mb-1">
                    {unitSystem === 'imperial' ? 'Profundidad (DOC ap)' : 'Profundidad (ap)'}
                  </label>
                  {unitSystem === 'imperial' ? (
                    <>
                      <Input
                        type="number"
                        step="0.005"
                        value={turningApInch}
                        onChange={(e) => setTurningApInch(Number(e.target.value))}
                        className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                      />
                      <span className="text-[9px] font-mono text-ink-dim">
                        pulgadas ({(turningApInch * 25.4).toFixed(1)} mm)
                      </span>
                    </>
                  ) : (
                    <>
                      <Input
                        type="number"
                        step="0.1"
                        value={turningApMm}
                        onChange={(e) => setTurningApMm(Number(e.target.value))}
                        className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                      />
                      <span className="text-[9px] font-mono text-ink-dim">mm por pasada</span>
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-mono font-bold mb-1">Radio Punta (r)</label>
                  {unitSystem === 'imperial' ? (
                    <select
                      value={turningNoseRadiusInch}
                      onChange={(e) => setTurningNoseRadiusInch(Number(e.target.value))}
                      className="w-full h-9 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2"
                    >
                      <option value={0.0078}>.008&quot; (R02 - Fino)</option>
                      <option value={0.0156}>1/64&quot; (.016&quot; - R04)</option>
                      <option value={0.0312}>1/32&quot; (.031&quot; - R08)</option>
                      <option value={0.0468}>3/64&quot; (.047&quot; - R12)</option>
                    </select>
                  ) : (
                    <select
                      value={turningNoseRadiusMm}
                      onChange={(e) => setTurningNoseRadiusMm(Number(e.target.value))}
                      className="w-full h-9 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2"
                    >
                      <option value={0.2}>0.2 mm (R02 - Fino)</option>
                      <option value={0.4}>0.4 mm (R04 - Acabado)</option>
                      <option value={0.8}>0.8 mm (R08 - General)</option>
                      <option value={1.2}>1.2 mm (R12 - Desbaste)</option>
                    </select>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Controles de Fresado */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="font-bold">Diámetro de Fresa (D)</span>
                  <span className="text-accent font-bold">
                    {millingToolDiaInch}&quot; ({(millingToolDiaInch * 25.4).toFixed(2)} mm)
                  </span>
                </div>
                <select
                  value={millingToolDiaInch}
                  onChange={(e) => setMillingToolDiaInch(Number(e.target.value))}
                  className="w-full h-9 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2"
                >
                  <option value={0.125}>1/8&quot; (0.125&quot; - 3.17 mm)</option>
                  <option value={0.1875}>3/16&quot; (0.188&quot; - 4.76 mm)</option>
                  <option value={0.25}>1/4&quot; (0.250&quot; - 6.35 mm)</option>
                  <option value={0.3125}>5/16&quot; (0.313&quot; - 7.94 mm)</option>
                  <option value={0.375}>3/8&quot; (0.375&quot; - 9.52 mm)</option>
                  <option value={0.5}>1/2&quot; (0.500&quot; - 12.70 mm)</option>
                  <option value={0.625}>5/8&quot; (0.625&quot; - 15.87 mm)</option>
                  <option value={0.75}>3/4&quot; (0.750&quot; - 19.05 mm)</option>
                  <option value={1.0}>1.0&quot; (1.000&quot; - 25.40 mm)</option>
                  <option value={2.0}>2.0&quot; (2.000&quot; - Face Mill 50.8 mm)</option>
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
                  <span className="font-bold">Chip Load (IPT / FPT)</span>
                  <span className="text-accent font-bold">{millingChipLoadInch}&quot; / diente</span>
                </div>
                <Input
                  type="number"
                  step="0.0005"
                  value={millingChipLoadInch}
                  onChange={(e) => setMillingChipLoadInch(Number(e.target.value))}
                  className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono font-bold mb-1">Prof. Axial (ap / DOC)</label>
                  <Input
                    type="number"
                    step="0.025"
                    value={millingApInch}
                    onChange={(e) => setMillingApInch(Number(e.target.value))}
                    className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                  />
                  <span className="text-[9px] font-mono text-ink-dim">
                    pulgadas ({(millingApInch * 25.4).toFixed(1)} mm)
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold mb-1">Paso Radial (ae / WOC)</label>
                  <Input
                    type="number"
                    step="0.025"
                    value={millingAeInch}
                    onChange={(e) => setMillingAeInch(Number(e.target.value))}
                    className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
                  />
                  <span className="text-[9px] font-mono text-ink-dim">
                    pulgadas ({(millingAeInch * 25.4).toFixed(1)} mm)
                  </span>
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
              <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">
                Velocidad Husillo
              </span>
              <span className="font-display font-black text-2xl lg:text-3xl text-accent block mt-1">
                {(operationMode === 'turning' ? turningResult.rpm : millingResult.rpm).toLocaleString()}
              </span>
              <span className="font-mono text-[10px] text-ink-dim font-bold">RPM</span>
            </div>

            <div className="border-2 border-line bg-surface p-4 shadow-hard text-center">
              <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">
                Avance de Mesa (F)
              </span>
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
                    ? `Avance Ajust: ${millingResult.adjustedFeedIpm} IPM`
                    : 'Sin compensación'}
              </span>
            </div>

            <div className="border-2 border-line bg-surface p-4 shadow-hard text-center">
              <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim block">
                Potencia Requerida
              </span>
              <span className="font-display font-black text-2xl lg:text-3xl text-ink block mt-1">
                {operationMode === 'turning'
                  ? turningResult.motorPowerHpRequired
                  : millingResult.motorPowerHpRequired}
              </span>
              <span className="font-mono text-[10px] text-ink-dim font-bold">
                HP ({operationMode === 'turning' ? turningResult.netPowerKw : millingResult.netPowerKw} kW)
              </span>
            </div>
          </div>

          {/* Tarjeta de Tasa de Remoción (MRR) */}
          <div className="border-2 border-line bg-surface p-3 px-4 shadow-hard flex items-center justify-between flex-wrap gap-2">
            <span className="font-mono text-xs uppercase font-bold text-ink-dim">
              Tasa de Remoción de Material (MRR):
            </span>
            <span className="font-mono text-sm font-black text-accent">
              {operationMode === 'turning'
                ? `${turningResult.mrrIn3Min} in³/min (${turningResult.mrrCm3Min} cm³/min)`
                : `${millingResult.mrrIn3Min} in³/min (${millingResult.mrrCm3Min} cm³/min)`}
            </span>
          </div>

          {/* Fórmulas Aplicadas y Desglose Técnico */}
          <div className="border-2 border-line bg-surface p-4 shadow-hard">
            <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink mb-2 flex items-center gap-2">
              <Cpu size={14} className="text-accent" />
              Fórmulas Aplicadas en Tiempo Real (Sistema {unitSystem === 'imperial' ? 'Imperial' : 'Métrico'})
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono bg-surface-2 p-3 border border-line">
              <div>
                <span className="text-ink-dim block text-[10px]">Cálculo de RPM:</span>
                <code className="text-ink font-bold">
                  {operationMode === 'turning'
                    ? unitSystem === 'imperial'
                      ? `n = (SFM × 3.82) / D = (${turningSfm} × 3.82) / ${turningDiameterInch}" = ${turningResult.rpm} RPM`
                      : `n = (Vc × 1000) / (π × D) = (${turningVc} × 1000) / (π × ${turningDiameterMm}) = ${turningResult.rpm} RPM`
                    : `n = (SFM × 3.82) / D = (${millingSfm} × 3.82) / ${millingToolDiaInch}" = ${millingResult.rpm} RPM`}
                </code>
              </div>
              <div>
                <span className="text-ink-dim block text-[10px]">Avance de Mesa (Feed):</span>
                <code className="text-ink font-bold">
                  {operationMode === 'turning'
                    ? `vf = n × fn = ${turningResult.rpm} × ${unitSystem === 'imperial' ? `${turningFeedIpr}"` : `${turningFeedMm}mm`} = ${unitSystem === 'imperial' ? `${turningResult.feedRateIpm} IPM` : `${turningResult.feedRateMmMin} mm/min`}`
                    : `vf = n × fz × Z = ${millingResult.rpm} × ${millingChipLoadInch}" × ${millingFlutes} = ${millingResult.tableFeedIpm} IPM`}
                </code>
              </div>
              <div>
                <span className="text-ink-dim block text-[10px]">Potencia de Corte Estimada:</span>
                <code className="text-ink font-bold">
                  Pc = {operationMode === 'turning' ? turningResult.netPowerHp : millingResult.netPowerHp} HP netos (
                  {operationMode === 'turning' ? turningResult.motorPowerHpRequired : millingResult.motorPowerHpRequired} HP motor al 80% ef.)
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
