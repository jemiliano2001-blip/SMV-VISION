import type { ReactElement } from 'react';
import { Sliders, Timer } from 'lucide-react';
import { Input } from '../../ui/input';
import { INCH_TO_MM, MMIN_TO_SFM, SFM_TO_MMIN, parseInputNumber } from './formatters';
import type { SpeedsFeedsState } from './useSpeedsFeedsState';

interface MillingInputsProps {
  state: SpeedsFeedsState;
}

const TOOL_DIAMETER_OPTIONS_INCH: Array<{ value: number; label: string }> = [
  { value: 0.125, label: '1/8" (0.125" - 3.17 mm)' },
  { value: 0.1875, label: '3/16" (0.188" - 4.76 mm)' },
  { value: 0.25, label: '1/4" (0.250" - 6.35 mm)' },
  { value: 0.3125, label: '5/16" (0.313" - 7.94 mm)' },
  { value: 0.375, label: '3/8" (0.375" - 9.52 mm)' },
  { value: 0.5, label: '1/2" (0.500" - 12.70 mm)' },
  { value: 0.625, label: '5/8" (0.625" - 15.87 mm)' },
  { value: 0.75, label: '3/4" (0.750" - 19.05 mm)' },
  { value: 1.0, label: '1.0" (1.000" - 25.40 mm)' },
  { value: 2.0, label: '2.0" (2.000" - Face Mill 50.8 mm)' },
];

const FLUTE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 2, label: '2 Filos (Aluminio/Plásticos)' },
  { value: 3, label: '3 Filos (Aluminio Alta Vel.)' },
  { value: 4, label: '4 Filos (Aceros General)' },
  { value: 5, label: '5 Filos (Inox/Titanio)' },
  { value: 6, label: '6 Filos (Trocoidal / Duros)' },
];

/** Inputs de parámetros de corte de fresado + geometría/tiempos/tarifa. */
export function MillingInputs({ state }: MillingInputsProps): ReactElement {
  const {
    unitSystem,
    millingToolDiaInch,
    setMillingToolDiaInch,
    millingFlutes,
    setMillingFlutes,
    millingSfm,
    setMillingSfm,
    millingVcMMin,
    setMillingVcMMin,
    millingChipLoadInch,
    setMillingChipLoadInch,
    millingChipLoadMm,
    setMillingChipLoadMm,
    millingApInch,
    setMillingApInch,
    millingApMm,
    setMillingApMm,
    millingAeInch,
    setMillingAeInch,
    millingAeMm,
    setMillingAeMm,
    millingPocketLengthInch,
    setMillingPocketLengthInch,
    millingPocketWidthInch,
    setMillingPocketWidthInch,
    millingPocketDepthInch,
    setMillingPocketDepthInch,
    millingHourlyRateMxn,
    setMillingHourlyRateMxn,
    millingFixtureSec,
    setMillingFixtureSec,
  } = state;

  return (
    <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-4">
      <div className="flex items-center justify-between border-b-2 border-line pb-2 mb-3">
        <h3 className="font-display font-black text-sm uppercase tracking-wider flex items-center gap-2">
          <Sliders size={16} className="text-accent" />
          Parámetros de Corte (Fresa)
        </h3>
        <span className="font-mono text-[10px] text-accent uppercase font-bold">
          {unitSystem === 'imperial' ? 'Pulgadas (Imperial)' : 'Métrico (mm)'}
        </span>
      </div>

      {/* Diámetro de fresa */}
      <div>
        <div className="flex justify-between text-xs font-mono mb-1">
          <span className="font-bold">Diámetro de Fresa (D)</span>
          <span className="text-accent font-bold">
            {millingToolDiaInch}&quot; ({(millingToolDiaInch * INCH_TO_MM).toFixed(2)} mm)
          </span>
        </div>
        <select
          aria-label="Diámetro de fresa"
          value={millingToolDiaInch}
          onChange={(e) => setMillingToolDiaInch(Number(e.target.value))}
          className="w-full h-9 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2"
        >
          {TOOL_DIAMETER_OPTIONS_INCH.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sf-flutes" className="block text-xs font-mono font-bold mb-1">
            Número de Filos (Z)
          </label>
          <select
            id="sf-flutes"
            value={millingFlutes}
            onChange={(e) => setMillingFlutes(Number(e.target.value))}
            className="w-full h-9 border-2 border-line bg-surface-2 font-mono text-xs font-bold px-2"
          >
            {FLUTE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sf-milling-sfm" className="block text-xs font-mono font-bold mb-1">
            {unitSystem === 'imperial' ? 'SFM (Vel. Superficie)' : 'Vc (m/min)'}
          </label>
          {unitSystem === 'imperial' ? (
            <Input
              id="sf-milling-sfm"
              type="number"
              step="10"
              value={millingSfm}
              onChange={(e) => setMillingSfm(parseInputNumber(e.target.value, millingSfm))}
              className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
            />
          ) : (
            <Input
              id="sf-milling-sfm"
              type="number"
              step="5"
              value={Number(millingVcMMin.toFixed(1))}
              onChange={(e) => setMillingVcMMin(parseInputNumber(e.target.value, millingVcMMin))}
              className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
            />
          )}
          <span className="text-[9px] font-mono text-ink-dim">
            {unitSystem === 'imperial' ? `${Math.round(millingSfm * SFM_TO_MMIN)} m/min` : `${Math.round(millingVcMMin * MMIN_TO_SFM)} SFM`}
          </span>
        </div>
      </div>

      {/* Chip Load */}
      <div>
        <div className="flex justify-between text-xs font-mono mb-1">
          <span className="font-bold">Chip Load (IPT / FPT)</span>
          <span className="text-accent font-bold">
            {unitSystem === 'imperial' ? `${millingChipLoadInch}" / diente` : `${millingChipLoadMm.toFixed(3)} mm / diente`}
          </span>
        </div>
        {unitSystem === 'imperial' ? (
          <Input
            aria-label="Carga de viruta por diente en pulgadas"
            type="number"
            step="0.0005"
            value={millingChipLoadInch}
            onChange={(e) => setMillingChipLoadInch(parseInputNumber(e.target.value, millingChipLoadInch))}
            className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
          />
        ) : (
          <Input
            aria-label="Carga de viruta por diente en milímetros"
            type="number"
            step="0.01"
            value={Number(millingChipLoadMm.toFixed(3))}
            onChange={(e) => setMillingChipLoadMm(parseInputNumber(e.target.value, millingChipLoadMm))}
            className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
          />
        )}
      </div>

      {/* Profundidad axial y paso radial */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sf-axial-depth" className="block text-xs font-mono font-bold mb-1">
            Prof. Axial (ap / DOC)
          </label>
          {unitSystem === 'imperial' ? (
            <Input
              id="sf-axial-depth"
              type="number"
              step="0.025"
              value={millingApInch}
              onChange={(e) => setMillingApInch(parseInputNumber(e.target.value, millingApInch))}
              className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
            />
          ) : (
            <Input
              id="sf-axial-depth"
              type="number"
              step="0.5"
              value={Number(millingApMm.toFixed(1))}
              onChange={(e) => setMillingApMm(parseInputNumber(e.target.value, millingApMm))}
              className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
            />
          )}
          <span className="text-[9px] font-mono text-ink-dim">
            {unitSystem === 'imperial' ? `${millingApMm.toFixed(1)} mm` : `${millingApInch.toFixed(3)}"`}
          </span>
        </div>
        <div>
          <label htmlFor="sf-radial-step" className="block text-xs font-mono font-bold mb-1">
            Paso Radial (ae / WOC)
          </label>
          {unitSystem === 'imperial' ? (
            <Input
              id="sf-radial-step"
              type="number"
              step="0.025"
              value={millingAeInch}
              onChange={(e) => setMillingAeInch(parseInputNumber(e.target.value, millingAeInch))}
              className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
            />
          ) : (
            <Input
              id="sf-radial-step"
              type="number"
              step="0.5"
              value={Number(millingAeMm.toFixed(1))}
              onChange={(e) => setMillingAeMm(parseInputNumber(e.target.value, millingAeMm))}
              className="h-9 border-2 border-line bg-surface-2 font-mono text-sm font-bold"
            />
          )}
          <span className="text-[9px] font-mono text-ink-dim">
            {unitSystem === 'imperial' ? `${millingAeMm.toFixed(1)} mm` : `${millingAeInch.toFixed(3)}"`}
          </span>
        </div>
      </div>

      {/* Geometría & Tiempos de Pieza */}
      <div className="border-t-2 border-line/60 pt-4 mt-4 space-y-3">
        <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink flex items-center gap-1.5">
          <Timer size={14} className="text-accent" />
          Geometría & Tiempos de Pieza
        </h4>

        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <label htmlFor="sf-pocket-length" className="block text-[10px] font-mono font-bold mb-1">
              Largo (&quot;)
            </label>
            <Input
              id="sf-pocket-length"
              type="number"
              step="0.5"
              value={millingPocketLengthInch}
              onChange={(e) => setMillingPocketLengthInch(parseInputNumber(e.target.value, millingPocketLengthInch))}
              className="h-8 border-2 border-line bg-surface-2 font-mono text-xs font-bold"
            />
          </div>
          <div>
            <label htmlFor="sf-pocket-width" className="block text-[10px] font-mono font-bold mb-1">
              Ancho (&quot;)
            </label>
            <Input
              id="sf-pocket-width"
              type="number"
              step="0.5"
              value={millingPocketWidthInch}
              onChange={(e) => setMillingPocketWidthInch(parseInputNumber(e.target.value, millingPocketWidthInch))}
              className="h-8 border-2 border-line bg-surface-2 font-mono text-xs font-bold"
            />
          </div>
          <div>
            <label htmlFor="sf-pocket-depth" className="block text-[10px] font-mono font-bold mb-1">
              Prof (&quot;)
            </label>
            <Input
              id="sf-pocket-depth"
              type="number"
              step="0.1"
              value={millingPocketDepthInch}
              onChange={(e) => setMillingPocketDepthInch(parseInputNumber(e.target.value, millingPocketDepthInch))}
              className="h-8 border-2 border-line bg-surface-2 font-mono text-xs font-bold"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="sf-milling-rate" className="block text-[11px] font-mono font-bold mb-1">
              Tarifa (MXN/hr)
            </label>
            <Input
              id="sf-milling-rate"
              type="number"
              step="5"
              min="0"
              placeholder="0 = sin costo"
              value={millingHourlyRateMxn}
              onChange={(e) => setMillingHourlyRateMxn(parseInputNumber(e.target.value, millingHourlyRateMxn))}
              className="h-8 border-2 border-line bg-surface-2 font-mono text-xs font-bold"
            />
          </div>
          <div>
            <label htmlFor="sf-fixture-time" className="block text-[11px] font-mono font-bold mb-1">
              Fijación (seg)
            </label>
            <Input
              id="sf-fixture-time"
              type="number"
              step="5"
              value={millingFixtureSec}
              onChange={(e) => setMillingFixtureSec(parseInputNumber(e.target.value, millingFixtureSec))}
              className="h-8 border-2 border-line bg-surface-2 font-mono text-xs font-bold"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
