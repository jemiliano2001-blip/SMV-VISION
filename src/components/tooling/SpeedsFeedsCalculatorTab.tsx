import type { ReactElement } from 'react';
import { useSpeedsFeedsState } from './calculator/useSpeedsFeedsState';
import { CalculatorHeader } from './calculator/CalculatorHeader';
import { TurningInputs } from './calculator/TurningInputs';
import { MillingInputs } from './calculator/MillingInputs';
import { ResultsPanel } from './calculator/ResultsPanel';
import { CyclePanel } from './calculator/CyclePanel';
import { GcodePanel } from './calculator/GcodePanel';

/**
 * Calculadora de Velocidades y Avances (Fase 1 refactor): orquestador delgado
 * que solo compone los módulos de `./calculator/`. Todo el estado y la lógica
 * de cálculo viven en `useSpeedsFeedsState`.
 */
export function SpeedsFeedsCalculatorTab(): ReactElement {
  const state = useSpeedsFeedsState();

  return (
    <div className="space-y-4">
      <CalculatorHeader state={state} />

      {/* móvil: 1 columna · lg: 2 · 2xl: parámetros | diagrama | resultados */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
        <div className="lg:col-start-1 lg:row-start-1 lg:row-span-3 2xl:row-span-2">
          {state.operationMode === 'turning' ? <TurningInputs state={state} /> : <MillingInputs state={state} />}
        </div>

        <div className="lg:col-start-2 lg:row-start-1 2xl:col-start-2">
          <ResultsPanel state={state} section="diagram" />
        </div>

        <div className="lg:col-start-2 lg:row-start-2 2xl:col-start-3 2xl:row-start-1 2xl:row-span-2">
          <ResultsPanel state={state} section="metrics" />
        </div>

        <div className="lg:col-start-2 lg:row-start-3 2xl:col-start-2 2xl:row-start-2 space-y-4">
          <CyclePanel state={state} />
          <GcodePanel state={state} />
        </div>
      </div>
    </div>
  );
}
