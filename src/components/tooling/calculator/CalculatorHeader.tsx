import type { ReactElement } from 'react';
import { RotateCcw, Layers, Ruler, ExternalLink } from 'lucide-react';
import { MATERIAL_DATABASE } from '../../../lib/tooling/materialDatabase';
import { listHaasMachinesByType } from '../../../lib/tooling/haasProfiles';
import type { SpeedsFeedsState } from './useSpeedsFeedsState';

interface CalculatorHeaderProps {
  state: SpeedsFeedsState;
}

/**
 * Selector de cabecera: operación (torno/fresa), sistema de unidades,
 * material ISO y máquina Haas activa, con mini-ficha técnica de la máquina.
 */
export function CalculatorHeader({ state }: CalculatorHeaderProps): ReactElement {
  const {
    operationMode,
    setOperationMode,
    unitSystem,
    setUnitSystem,
    selectedMaterialId,
    selectedMaterial,
    handleMaterialChange,
    selectedHaasId,
    setSelectedHaasId,
    selectedMachine,
  } = state;

  const machines = listHaasMachinesByType(operationMode === 'turning' ? 'lathe' : 'mill');

  return (
    <div className="border-2 border-line bg-surface p-4 shadow-hard">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        {/* Tabs Operación */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOperationMode('turning')}
            className={`cursor-pointer px-3.5 py-2 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-2 border-line transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
              operationMode === 'turning'
                ? 'bg-accent text-bg border-accent shadow-none translate-x-[2px] translate-y-[2px]'
                : 'bg-surface-2 text-ink hover:bg-surface-2/80'
            }`}
          >
            <RotateCcw size={15} /> Torneado CNC (Haas ST)
          </button>
          <button
            type="button"
            onClick={() => setOperationMode('milling')}
            className={`cursor-pointer px-3.5 py-2 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-2 border-line transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
              operationMode === 'milling'
                ? 'bg-accent text-bg border-accent shadow-none translate-x-[2px] translate-y-[2px]'
                : 'bg-surface-2 text-ink hover:bg-surface-2/80'
            }`}
          >
            <Layers size={15} /> Fresado CNC (Haas VF)
          </button>
        </div>

        {/* Selector de Unidades */}
        <div className="flex items-center border-2 border-line bg-surface-2 p-0.5 shadow-sm">
          <span className="font-mono text-[9px] uppercase font-bold text-ink-dim px-2 flex items-center gap-1">
            <Ruler size={11} className="text-accent" /> Unidades:
          </span>
          <button
            type="button"
            onClick={() => setUnitSystem('imperial')}
            className={`cursor-pointer px-3 py-1 text-[11px] font-mono font-black uppercase tracking-wider transition-all ${
              unitSystem === 'imperial' ? 'bg-accent text-bg font-bold shadow-sm' : 'text-ink-dim hover:text-ink'
            }`}
          >
            Pulgadas (Imperial)
          </button>
          <button
            type="button"
            onClick={() => setUnitSystem('metric')}
            className={`cursor-pointer px-3 py-1 text-[11px] font-mono font-black uppercase tracking-wider transition-all ${
              unitSystem === 'metric' ? 'bg-accent text-bg font-bold shadow-sm' : 'text-ink-dim hover:text-ink'
            }`}
          >
            Milímetros (Métrico)
          </button>
        </div>
      </div>

      {/* Fila de Selectores: Material y Máquina Haas */}
      <div className="mt-4 pt-3 border-t-2 border-line/40 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3 w-full lg:w-auto">
          <div>
            <label htmlFor="sf-material" className="block text-[9px] font-black uppercase tracking-widest text-ink-dim mb-1">
              Material de Pieza (Grupo ISO)
            </label>
            <select
              id="sf-material"
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
            <label htmlFor="sf-machine" className="block text-[9px] font-black uppercase tracking-widest text-ink-dim mb-1">
              Máquina Haas
            </label>
            <select
              id="sf-machine"
              value={selectedHaasId}
              onChange={(e) => setSelectedHaasId(e.target.value)}
              className="h-9 px-3 border-2 border-line bg-surface-2 text-ink text-xs font-mono font-bold outline-none focus:border-accent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.horsepower} HP)
                </option>
              ))}
            </select>
          </div>

          {selectedMachine && (
            <span
              className={`font-mono text-[9px] font-black uppercase px-2 py-1.5 border ${
                selectedMachine.inTaller ? 'bg-ok/15 text-ok border-ok/40' : 'bg-surface-2 text-ink-dim border-line'
              }`}
            >
              {selectedMachine.inTaller ? 'Taller SMV' : 'Referencia · catálogo Haas'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="bg-accent/20 text-accent font-bold px-2 py-0.5 border border-accent/40 text-[10px]">
            GRUPO {selectedMaterial.group}
          </span>
          <span className="text-ink-dim font-bold">
            Dureza: <span className="text-ink">{selectedMaterial.hardnessTypical}</span>
          </span>
          <span className="text-ink-dim font-bold">
            Kc: <span className="text-ink">{selectedMaterial.kc} N/mm²</span>
          </span>
        </div>
      </div>

      {/* Mini-ficha técnica de la máquina */}
      {selectedMachine && (
        <div className="mt-3 pt-3 border-t-2 border-line/40 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-ink-dim">
          <span>
            Máx. RPM: <strong className="text-ink">{selectedMachine.maxRpm.toLocaleString()}</strong>
          </span>
          <span>
            HP: <strong className="text-ink">{selectedMachine.horsepower}</strong>
          </span>
          {selectedMachine.maxTorqueNm && (
            <span>
              Par: <strong className="text-ink">{selectedMachine.maxTorqueNm} Nm</strong>
              {selectedMachine.maxTorqueAtRpm ? ` @ ${selectedMachine.maxTorqueAtRpm} rpm` : ''}
            </span>
          )}
          <span>
            Cono/husillo: <strong className="text-ink">{selectedMachine.taperOrSpindle}</strong>
          </span>
          {selectedMachine.workEnvelope && (
            <span>
              Envolvente: <strong className="text-ink">{selectedMachine.workEnvelope}</strong>
            </span>
          )}
          <a
            href={selectedMachine.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            Ficha Haas <ExternalLink size={10} />
          </a>
        </div>
      )}

      {selectedMaterial.source && (
        <p className="mt-2 font-mono text-[9px] text-ink-dim truncate" title={selectedMaterial.source}>
          Fuente material: {selectedMaterial.source}
        </p>
      )}
    </div>
  );
}
