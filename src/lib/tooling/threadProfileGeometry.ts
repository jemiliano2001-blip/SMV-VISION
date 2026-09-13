/**
 * Geometría pura (sin JSX) para el esquema didáctico de perfil de rosca en V
 * (`ThreadProfileSvg`). No reemplaza los cálculos reales de profundidad de
 * `threadingCalculator.ts` — es solo la aproximación visual del perfil truncado
 * en V para dibujar cresta / raíz / flancos a escala relativa.
 *
 * Convención estándar ISO 68-1 / ASME B1.1 para roscas en V de 60°: la cresta
 * (crest) y la raíz (root) del perfil final llevan un aplanado proporcional al
 * paso — P/8 en la cresta y P/4 en la raíz — mientras que los flancos corren
 * en línea recta al ángulo de punta dado, desplazándose horizontalmente
 * `profundidad × tan(ángulo/2)` por cada unidad de profundidad radial.
 */

export interface ThreadFlankMm {
  /** Aplanado de la cresta (P/8), en mm. */
  crestFlatMm: number;
  /** Aplanado de la raíz (P/4), en mm. */
  rootFlatMm: number;
  /** Recorrido horizontal de cada flanco para la profundidad radial dada, en mm. */
  flankRunMm: number;
}

export function computeThreadFlankMm(pitchMm: number, depthMm: number, tipAngleDegrees = 60): ThreadFlankMm {
  const safePitch = Math.max(pitchMm, 0.001);
  const safeDepth = Math.max(depthMm, 0);
  const halfAngleRad = (Math.max(tipAngleDegrees, 1) / 2) * (Math.PI / 180);

  return {
    crestFlatMm: safePitch / 8,
    rootFlatMm: safePitch / 4,
    flankRunMm: safeDepth * Math.tan(halfAngleRad),
  };
}

/**
 * Fracción aproximada (0–1) de la profundidad radial total a la que cae el
 * diámetro de paso, medida desde la cresta. Es una referencia visual, no el
 * offset exacto de `threadingCalculator.ts` (`pitchDiameterOffsetMm` usa
 * 0.6495×P sobre el diámetro, no sobre la profundidad radial mostrada aquí) —
 * `ThreadProfileSvg` no recibe esos offsets, así que se aproxima al punto medio
 * del filete cortado.
 */
export const APPROX_PITCH_LINE_FRACTION = 0.53;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
