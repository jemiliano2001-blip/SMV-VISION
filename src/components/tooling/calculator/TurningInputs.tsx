import type { ReactElement } from 'react';
import { Sliders, Timer } from 'lucide-react';
import { Input } from '../../ui/input';
import { INCH_TO_MM, MM_TO_INCH, MMIN_TO_SFM, SFM_TO_MMIN, parseInputNumber } from './formatters';
import type { SpeedsFeedsState } from './useSpeedsFeedsState';

interface TurningInputsProps {
  state: SpeedsFeedsState;
}

const DIAMETER_PRESETS_INCH = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];

const NOSE_RADIUS_OPTIONS_INCH: Array<{ value: number; label: string }> = [
  { value: 0.0078, label: '.008" (R02 - Fino)' },
  { value: 0.0156, label: '1/64" (.016" - R04)' },
  { value: 0.0312, label: '1/32" (.031" - R08)' },
  { value: 0.0468, label: '3/64" (.047" - R12)' },
];

const NOSE_RADIUS_OPTIONS_MM: Array<{ value: number; label: string }> = [
  { value: 0.2, label: '0.2 mm (R02 - Fino)' },
  { value: 0.4, label: '0.4 mm (R04 - Acabado)' },
  { value: 0.8, label: '0.8 mm (R08 - General)' },
  { value: 1.2, label: '1.2 mm (R12 - Desbaste)' },
];

/** Inputs de parámetros de corte de torneado + geometría/tiempos/tarifa. */
export function TurningInputs({ state }: TurningInputsProps): ReactElement {
  const {
    unitSystem,
    turningDiameterInch,
    setTurningDiameterInch,
    turningDiameterMm,
    setTurningDiameterMm,
    turningSfm,
    setTurningSfm,
    turningVc,
    setTurningVc,
    turningFeedIpr,
    setTurningFeedIpr,
    turningFeedMm,
    setTurningFeedMm,
    turningApInch,
    setTurningApInch,
    turningApMm,
    setTurningApMm,
    turningNoseRadiusInch,
    setTurningNoseRadiusInch,
    turningNoseRadiusMm,
    setTurningNoseRadiusMm,
    turningSpeedPresetsMMin,
    turningFeedPresetsMm,
    applyTurningSpeedPreset,
    applyTurningFeedPreset,
    turningCutLengthInch,
    setTurningCutLengthInch,
    turningRawDiaInch,
    setTurningRawDiaInch,
    turningFinalDiaInch,
    setTurningFinalDiaInch,
    turningHourlyRateMxn,
    setTurningHourlyRateMxn,
    turningChuckingSec,
    setTurningChuckingSec,
  } = state;

  return (
    <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-4">
      <div className="flex items-center justify-between border-b-2 border-line pb-2 mb-3">
        <h3 className="font-display font-black text-sm uppercase tracking-wider flex items-center gap-2">
          <Sliders size={16} className="text-accent" />
          Parámetros de Corte (Torno)
        </h3>
        <span className="font-mono text-[10px] text-accent uppercase font-bold">
          {unitSystem === 'imperial' ? 'Pulgadas (Imperial)' : 'Métrico (mm)'}
        </span>
      </div>

      {/* Diámetro de la pieza */}
      <div>
        <div className="flex justify-between text-xs font-mono mb-1">
          <span className="font-bold">Diámetro de la Pieza (D)</span>
          <span className="text-accent font-bold">
            {unitSystem === 'imperial'
              ? `${turningDiameterInch.toFixed(3)}" (${(turningDiameterInch * INCH_TO_MM).toFixed(1)} mm)`
              : `${turningDiameterMm} mm (${(turningDiameterMm * MM_TO_INCH).toFixed(3)}")`}
          </span>
        </div>
        {unitSystem === 'imperial' ? (
          <>
            <Input
              aria-label="Diámetro de la pieza en pulgadas"
              type="number"
              step="0.05"
              min="0.1"
              max="10"
              value={turningDiameterInch}
              onChange={(e) => setTurningDiameterInch(parseInputNumber(e.target.value, turningDiameterInch))}
              className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
            />
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {DIAMETER_PRESETS_INCH.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setTurningDiameterInch(d)}
                  className={`cursor-pointer text-[9px] font-mono px-2 py-0.5 border ${
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
              aria-label="Diámetro de la pieza en milímetros"
              type="number"
              step="0.5"
              value={turningDiameterMm}
              onChange={(e) => setTurningDiameterMm(parseInputNumber(e.target.value, turningDiameterMm))}
              className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
            />
            <input
              aria-label="Ajustar diámetro de la pieza en milímetros"
              type="range"
              min="3"
              max="150"
              value={turningDiameterMm}
              onChange={(e) => setTurningDiameterMm(Number(e.target.value))}
              className="w-full mt-1 accent-accent cursor-pointer"
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
              ? `${turningSfm} SFM (${Math.round(turningSfm * SFM_TO_MMIN)} m/min)`
              : `${turningVc} m/min (${Math.round(turningVc * MMIN_TO_SFM)} SFM)`}
          </span>
        </div>
        {unitSystem === 'imperial' ? (
          <Input
            aria-label="Velocidad superficial en SFM"
            type="number"
            step="10"
            value={turningSfm}
            onChange={(e) => setTurningSfm(parseInputNumber(e.target.value, turningSfm))}
            className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
          />
        ) : (
          <Input
            aria-label="Velocidad de corte en metros por minuto"
            type="number"
            step="5"
            value={turningVc}
            onChange={(e) => setTurningVc(parseInputNumber(e.target.value, turningVc))}
            className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
          />
        )}
        <div className="flex gap-2 mt-1.5">
          <button
            type="button"
            onClick={() => applyTurningSpeedPreset(turningSpeedPresetsMMin.min)}
            className="cursor-pointer text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
          >
            Mín ({unitSystem === 'imperial' ? `${Math.round(turningSpeedPresetsMMin.min * MMIN_TO_SFM)} SFM` : `${turningSpeedPresetsMMin.min} m/min`})
          </button>
          <button
            type="button"
            onClick={() => applyTurningSpeedPreset(turningSpeedPresetsMMin.mid)}
            className="cursor-pointer text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
          >
            Medio ({unitSystem === 'imperial' ? `${Math.round(turningSpeedPresetsMMin.mid * MMIN_TO_SFM)} SFM` : `${turningSpeedPresetsMMin.mid} m/min`})
          </button>
          <button
            type="button"
            onClick={() => applyTurningSpeedPreset(turningSpeedPresetsMMin.max)}
            className="cursor-pointer text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
          >
            Máx ({unitSystem === 'imperial' ? `${Math.round(turningSpeedPresetsMMin.max * MMIN_TO_SFM)} SFM` : `${turningSpeedPresetsMMin.max} m/min`})
          </button>
        </div>
      </div>

      {/* Avance por revolución */}
      <div>
        <div className="flex justify-between text-xs font-mono mb-1">
          <span className="font-bold">{unitSystem === 'imperial' ? 'Avance por Rev (IPR)' : 'Avance por Rev (fn)'}</span>
          <span className="text-accent font-bold">
            {unitSystem === 'imperial'
              ? `${turningFeedIpr.toFixed(4)}" IPR (${(turningFeedIpr * INCH_TO_MM).toFixed(2)} mm/rev)`
              : `${turningFeedMm} mm/rev (${(turningFeedMm * MM_TO_INCH).toFixed(4)}" IPR)`}
          </span>
        </div>
        {unitSystem === 'imperial' ? (
          <Input
            aria-label="Avance por revolución en pulgadas"
            type="number"
            step="0.0005"
            value={turningFeedIpr}
            onChange={(e) => setTurningFeedIpr(parseInputNumber(e.target.value, turningFeedIpr))}
            className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
          />
        ) : (
          <Input
            aria-label="Avance por revolución en milímetros"
            type="number"
            step="0.01"
            value={turningFeedMm}
            onChange={(e) => setTurningFeedMm(parseInputNumber(e.target.value, turningFeedMm))}
            className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
          />
        )}
        <div className="flex gap-2 mt-1.5">
          <button
            type="button"
            onClick={() => applyTurningFeedPreset(turningFeedPresetsMm.acabado)}
            className="cursor-pointer text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
          >
            Acabado ({unitSystem === 'imperial' ? `${(turningFeedPresetsMm.acabado * MM_TO_INCH).toFixed(4)}"` : `${turningFeedPresetsMm.acabado}`})
          </button>
          <button
            type="button"
            onClick={() => applyTurningFeedPreset(turningFeedPresetsMm.medio)}
            className="cursor-pointer text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
          >
            Medio ({unitSystem === 'imperial' ? `${(turningFeedPresetsMm.medio * MM_TO_INCH).toFixed(4)}"` : `${turningFeedPresetsMm.medio}`})
          </button>
          <button
            type="button"
            onClick={() => applyTurningFeedPreset(turningFeedPresetsMm.desbaste)}
            className="cursor-pointer text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
          >
            Desbaste ({unitSystem === 'imperial' ? `${(turningFeedPresetsMm.desbaste * MM_TO_INCH).toFixed(4)}"` : `${turningFeedPresetsMm.desbaste}`})
          </button>
        </div>
      </div>

      {/* Profundidad de corte y Radio de punta */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sf-turning-depth" className="block text-xs font-mono font-bold mb-1">
            {unitSystem === 'imperial' ? 'Profundidad (DOC ap)' : 'Profundidad (ap)'}
          </label>
          {unitSystem === 'imperial' ? (
            <>
              <Input
                id="sf-turning-depth"
                type="number"
                step="0.005"
                value={turningApInch}
                onChange={(e) => setTurningApInch(parseInputNumber(e.target.value, turningApInch))}
                className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
              />
              <span className="text-[9px] font-mono text-ink-dim">pulgadas ({(turningApInch * INCH_TO_MM).toFixed(1)} mm)</span>
            </>
          ) : (
            <>
              <Input
                id="sf-turning-depth"
                type="number"
                step="0.1"
                value={turningApMm}
                onChange={(e) => setTurningApMm(parseInputNumber(e.target.value, turningApMm))}
                className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
              />
              <span className="text-[9px] font-mono text-ink-dim">mm por pasada</span>
            </>
          )}
        </div>

        <div>
          <label htmlFor="sf-nose-radius" className="block text-xs font-mono font-bold mb-1">
            Radio Punta (r)
          </label>
          {unitSystem === 'imperial' ? (
            <select
              id="sf-nose-radius"
              value={turningNoseRadiusInch}
              onChange={(e) => setTurningNoseRadiusInch(Number(e.target.value))}
              className="w-full h-9 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2"
            >
              {NOSE_RADIUS_OPTIONS_INCH.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              id="sf-nose-radius"
              value={turningNoseRadiusMm}
              onChange={(e) => setTurningNoseRadiusMm(Number(e.target.value))}
              className="w-full h-9 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2"
            >
              {NOSE_RADIUS_OPTIONS_MM.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Geometría & Tiempos de Pieza */}
      <div className="border-t-2 border-line/60 pt-4 mt-4 space-y-3">
        <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink flex items-center gap-1.5">
          <Timer size={14} className="text-accent" />
          Geometría & Tiempos de Pieza
        </h4>

        <div>
          <div className="flex justify-between text-xs font-mono mb-1">
            <span className="font-bold">Longitud de Corte (Z)</span>
            <span className="text-accent font-bold">{turningCutLengthInch}&quot;</span>
          </div>
          <Input
            aria-label="Longitud de corte en torno"
            type="number"
            step="0.25"
            value={turningCutLengthInch}
            onChange={(e) => setTurningCutLengthInch(parseInputNumber(e.target.value, turningCutLengthInch))}
            className="h-8 border-2 border-line bg-surface-2 font-mono text-xs font-bold"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="sf-turning-initial-diameter" className="block text-[11px] font-mono font-bold mb-1">
              D. Inicial
            </label>
            <Input
              id="sf-turning-initial-diameter"
              type="number"
              step="0.125"
              value={turningRawDiaInch}
              onChange={(e) => setTurningRawDiaInch(parseInputNumber(e.target.value, turningRawDiaInch))}
              className="h-8 border-2 border-line bg-surface-2 font-mono text-xs font-bold"
            />
          </div>
          <div>
            <label htmlFor="sf-turning-final-diameter" className="block text-[11px] font-mono font-bold mb-1">
              D. Final
            </label>
            <Input
              id="sf-turning-final-diameter"
              type="number"
              step="0.125"
              value={turningFinalDiaInch}
              onChange={(e) => setTurningFinalDiaInch(parseInputNumber(e.target.value, turningFinalDiaInch))}
              className="h-8 border-2 border-line bg-surface-2 font-mono text-xs font-bold"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="sf-turning-rate" className="block text-[11px] font-mono font-bold mb-1">
              Tarifa (MXN/hr)
            </label>
            <Input
              id="sf-turning-rate"
              type="number"
              step="5"
              min="0"
              placeholder="0 = sin costo"
              value={turningHourlyRateMxn}
              onChange={(e) => setTurningHourlyRateMxn(parseInputNumber(e.target.value, turningHourlyRateMxn))}
              className="h-8 border-2 border-line bg-surface-2 font-mono text-xs font-bold"
            />
          </div>
          <div>
            <label htmlFor="sf-chucking-time" className="block text-[11px] font-mono font-bold mb-1">
              Chuck (seg)
            </label>
            <Input
              id="sf-chucking-time"
              type="number"
              step="5"
              value={turningChuckingSec}
              onChange={(e) => setTurningChuckingSec(parseInputNumber(e.target.value, turningChuckingSec))}
              className="h-8 border-2 border-line bg-surface-2 font-mono text-xs font-bold"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
