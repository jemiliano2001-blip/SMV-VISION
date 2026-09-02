import type { HaasG76Params, ThreadDepthResult, ThreadShimRecommendation } from './types';

/**
 * Cálculo de roscado CNC basado en las fórmulas públicas de ISO 68-1 (rosca métrica ISO) y
 * ASME B1.1 (Unificada UN/UNC/UNF), que son prácticamente idénticas en geometría (ambas son
 * un triángulo de 60° truncado):
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
  return 25.4 / Math.max(1, tpi);
}

/**
 * Número de pasadas de desbaste sugerido por paso — regla de taller probada para carburo.
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
 * de volumen de viruta constante: profundidad(i) = h_total × sqrt(i / n).
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
 */
export function threadLeadAngleDegrees(pitchMm: number, pitchDiameterMm: number): number {
  if (pitchDiameterMm <= 0) return 0;
  const radians = Math.atan(pitchMm / (Math.PI * pitchDiameterMm));
  return (radians * 180) / Math.PI;
}

/**
 * Recomienda la cuña / calce (Anvil / Shim) para el portaherramientas según el ángulo de hélice.
 * Evita que el filo astille o que el flanco roce contra la hélice en pasos gruesos o roscas izquierdas.
 */
export function calculateThreadingShim(
  leadAngleDegrees: number,
  isExternal = true,
  isRightHandThread = true,
): ThreadShimRecommendation {
  const prefix = isExternal ? 'AE16' : 'AI16';

  if (!isRightHandThread) {
    return {
      leadAngleDegrees,
      recommendedShimAngle: -1.5,
      shimCodeCarmexOrVardex: `${prefix}-1.5N`,
      reason: 'Rosca izquierda con porta derecho: requiere calce con ángulo de inclinación negativo para evitar rozamiento en el flanco opuesto.',
    };
  }

  if (leadAngleDegrees < 0.8) {
    return {
      leadAngleDegrees,
      recommendedShimAngle: 0.5,
      shimCodeCarmexOrVardex: `${prefix}-0.5`,
      reason: `Ángulo de hélice bajo (${leadAngleDegrees.toFixed(1)}°): cuña de 0.5° recomendada para que el flanco delantero no roce en diámetros grandes o pasos finos.`,
    };
  }

  if (leadAngleDegrees <= 2.0) {
    return {
      leadAngleDegrees,
      recommendedShimAngle: 1.5,
      shimCodeCarmexOrVardex: `${prefix}-1.5 (Estándar de fábrica)`,
      reason: `Ángulo de hélice normal (${leadAngleDegrees.toFixed(1)}°): la cuña estándar de 1.5° instalada de fábrica en el portaherramientas trabaja en su rango ideal.`,
    };
  }

  if (leadAngleDegrees <= 3.2) {
    return {
      leadAngleDegrees,
      recommendedShimAngle: 2.5,
      shimCodeCarmexOrVardex: `${prefix}-2.5`,
      reason: `Ángulo de hélice alto (${leadAngleDegrees.toFixed(1)}°): indispensable instalar cuña de 2.5° para evitar que el flanco trasero talle contra la pared de la rosca.`,
    };
  }

  return {
    leadAngleDegrees,
    recommendedShimAngle: 3.5,
    shimCodeCarmexOrVardex: `${prefix}-3.5`,
    reason: `Ángulo de hélice muy alto (${leadAngleDegrees.toFixed(1)}°): paso grueso en diámetro pequeño. Usa cuña de 3.5° y reduce velocidad de corte para no astillar la punta.`,
  };
}

export interface ThreadDepthInput {
  pitchMm: number;
  majorDiameterMm?: number;
  isExternal?: boolean;
}

export function calculateThreadDepths(input: ThreadDepthInput): ThreadDepthResult {
  const pitchMm = Math.max(input.pitchMm, 0.1);
  const isExternal = input.isExternal ?? true;
  const majorDiameterMm = input.majorDiameterMm && input.majorDiameterMm > 0 ? input.majorDiameterMm : undefined;

  const depthExternalMm = Number((0.6134 * pitchMm).toFixed(4));
  const depthInternalMm = Number((0.5413 * pitchMm).toFixed(4));
  const depthExternalInch = Number((depthExternalMm / 25.4).toFixed(4));
  const depthInternalInch = Number((depthInternalMm / 25.4).toFixed(4));

  const pitchDiameterOffsetMm = Number((0.6495 * pitchMm).toFixed(4));
  const minorDiameterOffsetMm = Number((1.0825 * pitchMm).toFixed(4));

  const pitchDiameterMm = majorDiameterMm ? majorDiameterMm - pitchDiameterOffsetMm : 10 * pitchMm;
  const leadAngleDegrees = Number(threadLeadAngleDegrees(pitchMm, pitchDiameterMm).toFixed(2));

  const suggestedPasses = suggestedPassCountForPitch(pitchMm);
  const targetDepthMm = isExternal ? depthExternalMm : depthInternalMm;
  const { percent, mm } = generateInfeedSchedule(targetDepthMm, suggestedPasses);
  const scheduleInch = mm.map((val) => Number((val / 25.4).toFixed(4)));

  const shimRecommendation = calculateThreadingShim(leadAngleDegrees, isExternal, true);

  const infeedMethod: ThreadDepthResult['infeedMethod'] =
    pitchMm < 1.0 ? 'radial' : pitchMm <= 3.0 ? 'flanco_modificado_29_30' : 'alternado';

  const warnings: string[] = [];
  const tips: string[] = [];

  warnings.push('⚠️ Programa el roscado SIEMPRE con G97 (RPM constante). G96 (velocidad de superficie constante) rompe la sincronía husillo-avance y arruina el paso.');

  if (leadAngleDegrees > 2.0) {
    tips.push(`Ángulo de avance pronunciado (${leadAngleDegrees}°): instala la cuña ${shimRecommendation.shimCodeCarmexOrVardex} para que ambos flancos del inserto corten parejo.`);
  }

  if (infeedMethod === 'radial') {
    tips.push('Paso fino: infeed radial (recto) es suficiente — la viruta es angosta y no hay riesgo de traqueteo.');
  } else if (infeedMethod === 'flanco_modificado_29_30') {
    tips.push('Infeed por flanco modificado (29°-30° en parámetro A): reparte la carga en el filo frontal y elimina el chatter.');
  } else {
    tips.push('Paso grueso: considera infeed alternado (zig-zag) para evitar sobrecarga en una sola arista del inserto.');
  }

  const tpiApprox = Number((25.4 / pitchMm).toFixed(1));

  return {
    unitSystem: 'inch',
    pitchMm,
    tpi: tpiApprox,
    majorDiameterMm,
    majorDiameterInch: majorDiameterMm ? Number((majorDiameterMm / 25.4).toFixed(4)) : undefined,
    depthExternalMm,
    depthExternalInch,
    depthInternalMm,
    depthInternalInch,
    pitchDiameterOffsetMm,
    minorDiameterOffsetMm,
    leadAngleDegrees,
    shimRecommendation,
    suggestedPasses,
    infeedSchedulePercent: percent,
    infeedScheduleMm: mm,
    infeedScheduleInch: scheduleInch,
    infeedMethod,
    warnings,
    tips,
  };
}

/**
 * Genera el bloque CNC G76 para torno Haas ST/TL o Fanuc.
 * Soportando formato Haas Single-Line (el más usado en piso de taller en México y EE.UU.)
 * o Fanuc Two-Line, en pulgadas (G20) o métrico (G21).
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
    format = 'haas_single',
    unitSystem = 'inch',
  } = params;

  const isInch = unitSystem === 'inch';
  const majorDia = isInch ? (params.majorDiameterInch ?? majorDiameterMm / 25.4) : majorDiameterMm;
  const depth = isInch ? (params.depthInch ?? depthMm / 25.4) : depthMm;
  const firstPass = isInch ? (params.firstPassDepthInch ?? firstPassDepthMm / 25.4) : firstPassDepthMm;
  const startZ = isInch ? (params.startZInch ?? startZMm / 25.4) : startZMm;
  const endZ = isInch ? (params.endZInch ?? endZMm / 25.4) : endZMm;
  const feed = isInch ? (params.tpi ? 1 / params.tpi : pitchMm / 25.4) : pitchMm;
  const minDepth = isInch ? (params.minDepthPerPassInch ?? minDepthPerPassMm / 25.4) : minDepthPerPassMm;
  const finishAllow = isInch ? (params.finishAllowanceInch ?? finishAllowanceMm / 25.4) : finishAllowanceMm;

  // Diámetro final cortado en X
  const finalDiameter = isExternal ? majorDia - 2 * depth : majorDia + 2 * depth;
  const safeX = isExternal ? majorDia + (isInch ? 0.100 : 2.0) : majorDia - (isInch ? 0.150 : 4.0);

  const decUnits = isInch ? 4 : 3;

  if (format === 'haas_single') {
    // Formato Canónico Haas Clásico (1 Línea):
    // G76 X... Z... K... D... F... A...
    const kParam = depth.toFixed(decUnits);
    const dParam = firstPass.toFixed(decUnits);
    const xParam = finalDiameter.toFixed(decUnits);
    const zParam = endZ.toFixed(decUnits);
    const fParam = feed.toFixed(decUnits);
    const aParam = Math.round(tipAngleDegrees);

    return [
      `(ROSCADO ${isExternal ? 'EXTERIOR' : 'INTERIOR'} — FORMATO HAAS LATHE SINGLE-LINE)`,
      isInch ? 'G20 (MODO PULGADAS)' : 'G21 (MODO MÉTRICO)',
      'G97 S650 M03 (RPM CONSTANTE — NUNCA G96)',
      `G00 X${safeX.toFixed(decUnits)} Z${startZ.toFixed(decUnits)} M08`,
      `G76 X${xParam} Z${zParam} K${kParam} D${dParam} F${fParam} A${aParam}`,
      'G00 X2.0000 Z2.0000 M09 (RETIRO SEGURO)',
    ].join('\n');
  }

  // Formato Fanuc Two-Line (cuando Setting 33 = Fanuc):
  const m = String(Math.max(1, Math.round(finishingPasses))).padStart(2, '0');
  const r = String(Math.max(0, Math.round(chamferCode))).padStart(2, '0');
  const a = String(Math.max(0, Math.round(tipAngleDegrees))).padStart(2, '0');

  const line1 = `G76 P${m}${r}${a} Q${minDepth.toFixed(decUnits)} R${finishAllow.toFixed(decUnits)}`;
  const line2 = `G76 X${finalDiameter.toFixed(decUnits)} Z${endZ.toFixed(decUnits)} P${depth.toFixed(decUnits)} Q${firstPass.toFixed(decUnits)} F${feed.toFixed(decUnits)}`;

  return [
    `(ROSCADO ${isExternal ? 'EXTERIOR' : 'INTERIOR'} — FORMATO FANUC / HAAS TWO-LINE)`,
    isInch ? 'G20 (MODO PULGADAS)' : 'G21 (MODO MÉTRICO)',
    'G97 S650 M03 (RPM CONSTANTE — NUNCA G96)',
    `G00 X${safeX.toFixed(decUnits)} Z${startZ.toFixed(decUnits)} M08`,
    line1,
    line2,
    'G00 X2.0000 Z2.0000 M09 (RETIRO SEGURO)',
  ].join('\n');
}
