import type { HaasG76Params, ThreadDepthResult } from './types';

/**
 * Cálculo de roscado CNC basado en las fórmulas públicas de ISO 68-1 (rosca métrica ISO) y
 * ASME B1.1 (Unificada UN/UNC/UNF), que son prácticamente idénticas en geometría (ambas son
 * un triángulo de 60° truncado). No se usan constantes de catálogo de ningún fabricante —
 * son relaciones geométricas estándar y públicas:
 *
 *   H  = (√3 / 2) × P               (altura del triángulo fundamental de 60°)
 *   Profundidad exterior h3 = 0.6134 × P
 *   Profundidad interior H1 = 0.5413 × P
 *   Diámetro de paso  = D − 0.6495 × P
 *   Diámetro menor    = D − 1.0825 × P
 */

const SQRT3_OVER_2 = Math.sqrt(3) / 2;

export function metricThreadHeight(pitchMm: number): number {
  return SQRT3_OVER_2 * pitchMm;
}

export function pitchFromTpi(tpi: number): number {
  return 25.4 / tpi;
}

/**
 * Número de pasadas de desbaste sugerido por paso — regla de taller ampliamente citada,
 * NO una norma. Es un punto de partida: si el filo se ve forzado o el acabado no cumple,
 * agrega pasadas; si el material es muy suave (aluminio), puedes reducir.
 */
export function suggestedPassCountForPitch(pitchMm: number): number {
  if (pitchMm <= 0.75) return 4;
  if (pitchMm <= 1.0) return 6;
  if (pitchMm <= 1.5) return 8;
  if (pitchMm <= 2.0) return 10;
  if (pitchMm <= 3.0) return 13;
  if (pitchMm <= 4.0) return 16;
  return 20;
}

/**
 * Genera el porcentaje de profundidad acumulada en cada pasada usando la progresión
 * de "volumen de viruta constante": profundidad(i) = h_total × sqrt(i / n).
 * Es el mismo método que usa el ciclo G76 de Fanuc/Haas cuando no se especifican
 * pasadas manuales — evita que la última pasada retire tanto material como la primera.
 */
export function generateInfeedSchedule(totalDepthMm: number, passes: number): { percent: number[]; mm: number[] } {
  const percent: number[] = [];
  const mm: number[] = [];
  for (let i = 1; i <= passes; i += 1) {
    const pct = Math.sqrt(i / passes);
    percent.push(Number((pct * 100).toFixed(1)));
    mm.push(Number((pct * totalDepthMm).toFixed(4)));
  }
  return { percent, mm };
}

/**
 * Ángulo de hélice (avance) de la rosca: λ = atan(paso / (π × diámetro de paso)).
 * Relación puramente geométrica (no depende de catálogo de ningún fabricante).
 */
export function threadLeadAngleDegrees(pitchMm: number, pitchDiameterMm: number): number {
  if (pitchDiameterMm <= 0) return 0;
  const radians = Math.atan(pitchMm / (Math.PI * pitchDiameterMm));
  return (radians * 180) / Math.PI;
}

export interface ThreadDepthInput {
  pitchMm: number;
  majorDiameterMm?: number;
}

export function calculateThreadDepths(input: ThreadDepthInput): ThreadDepthResult {
  const pitchMm = Math.max(input.pitchMm, 0.1);
  const majorDiameterMm = input.majorDiameterMm && input.majorDiameterMm > 0 ? input.majorDiameterMm : undefined;

  const depthExternalMm = Number((0.6134 * pitchMm).toFixed(4));
  const depthInternalMm = Number((0.5413 * pitchMm).toFixed(4));
  const pitchDiameterOffsetMm = Number((0.6495 * pitchMm).toFixed(4));
  const minorDiameterOffsetMm = Number((1.0825 * pitchMm).toFixed(4));

  const pitchDiameterMm = majorDiameterMm ? majorDiameterMm - pitchDiameterOffsetMm : 10 * pitchMm;
  const leadAngleDegrees = Number(threadLeadAngleDegrees(pitchMm, pitchDiameterMm).toFixed(2));

  const suggestedPasses = suggestedPassCountForPitch(pitchMm);
  const { percent, mm } = generateInfeedSchedule(depthExternalMm, suggestedPasses);

  const infeedMethod: ThreadDepthResult['infeedMethod'] =
    pitchMm < 1.0 ? 'radial' : pitchMm <= 3.0 ? 'flanco_modificado_29_30' : 'alternado';

  const warnings: string[] = [];
  const tips: string[] = [];

  warnings.push('⚠️ Programa el roscado SIEMPRE con G97 (RPM constante). G96 (velocidad de superficie constante) rompe la sincronía husillo-avance y arruina el paso.');

  if (leadAngleDegrees > 3) {
    tips.push(`Ángulo de hélice alto (${leadAngleDegrees}°): considera un porta o calza (shim) orientado al ángulo de la hélice para que el filo trabaje parejo en ambos flancos, en vez del shim estándar de 0°-1°.`);
  }

  if (infeedMethod === 'radial') {
    tips.push('Paso fino (< 1.0mm): infeed radial (recto) es suficiente — la viruta es angosta y no hay riesgo real de que el filo trasero raspe.');
  } else if (infeedMethod === 'flanco_modificado_29_30') {
    tips.push('Infeed por flanco modificado (29°-30°, no los 30° completos de un solo lado): reparte la carga entre ambos filos y evita el traqueteo (chatter) típico del infeed radial puro en pasos medios.');
  } else {
    tips.push('Paso grueso (> 3.0mm): considera infeed alternado (zig-zag entre flancos) para evitar que un solo filo cargue toda la viruta.');
  }

  if (pitchMm >= 2.0) {
    tips.push('Con pasos gruesos, reduce la velocidad de corte a 60-70% de la del torneado normal del material y usa abundante refrigerante para no perder el filo en la última pasada.');
  }

  return {
    unitSystem: 'metric',
    pitchMm,
    majorDiameterMm,
    depthExternalMm,
    depthInternalMm,
    pitchDiameterOffsetMm,
    minorDiameterOffsetMm,
    leadAngleDegrees,
    suggestedPasses,
    infeedSchedulePercent: percent,
    infeedScheduleMm: mm,
    infeedMethod,
    warnings,
    tips,
  };
}

/**
 * Genera el bloque G76 (ciclo canónico de roscado, sintaxis Fanuc/Haas) a partir de los
 * parámetros ya calculados. IMPORTANTE: siempre verifica en el simulador gráfico de la
 * máquina antes de correrlo — la representación exacta de P/Q/R (micras vs. decimal) puede
 * variar entre versiones del control Haas; este bloque usa notación decimal estándar G21 (mm).
 */
export function generateHaasG76Block(params: HaasG76Params): string {
  const {
    majorDiameterMm,
    pitchMm,
    depthMm,
    finishingPasses,
    chamferCode,
    tipAngleDegrees,
    minDepthPerPassMm,
    finishAllowanceMm,
    firstPassDepthMm,
    startZMm,
    endZMm,
    isExternal,
  } = params;

  const finalDiameterMm = isExternal
    ? majorDiameterMm - 2 * depthMm
    : majorDiameterMm + 2 * depthMm;

  const m = String(Math.max(1, Math.round(finishingPasses))).padStart(2, '0');
  const r = String(Math.max(0, Math.round(chamferCode))).padStart(2, '0');
  const a = String(Math.max(0, Math.round(tipAngleDegrees))).padStart(2, '0');

  const line1 = `G76 P${m}${r}${a} Q${minDepthPerPassMm.toFixed(3)} R${finishAllowanceMm.toFixed(3)}`;
  const line2 = `G76 X${finalDiameterMm.toFixed(3)} Z${endZMm.toFixed(3)} P${depthMm.toFixed(3)} Q${firstPassDepthMm.toFixed(3)} F${pitchMm.toFixed(3)}`;

  return [
    `(ROSCADO ${isExternal ? 'EXTERIOR' : 'INTERIOR'} — VERIFICAR EN SIMULADOR ANTES DE CORRER)`,
    `G97 S___ (RPM FIJAS — NUNCA G96 EN ROSCADO)`,
    `G00 X${(isExternal ? majorDiameterMm + 2 : majorDiameterMm - 4).toFixed(3)} Z${startZMm.toFixed(3)}`,
    line1,
    line2,
    `G00 X___ Z___ (RETIRO SEGURO)`,
  ].join('\n');
}
