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
    <div className="space-y-6">
      <CalculatorHeader state={state} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4">
          {state.operationMode === 'turning' ? <TurningInputs state={state} /> : <MillingInputs state={state} />}
        </div>

        <div className="lg:col-span-8 space-y-4">
          <ResultsPanel state={state} />
          <CyclePanel state={state} />
          <GcodePanel state={state} />
        </div>
      </div>
    </div>
  );
}
