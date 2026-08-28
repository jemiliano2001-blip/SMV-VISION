import type { TapDrillEntry } from './types';

/**
 * Brocas previas (tap drill) para machuelo de CORTE al ~75% de engrane de rosca — el estándar
 * de taller para uso general (más engrane = machuelo más forzado y mayor riesgo de rotura,
 * sin ganancia real de resistencia en la mayoría de aplicaciones).
 *
 * Fórmula general verificable: broca ≈ Diámetro Mayor − Paso (aprox. 75-77% de engrane para
 * roscas métricas). Los valores curados abajo son los tamaños de broca ESTÁNDAR de catálogo
 * (redondeados a un tamaño de broca real existente), la fórmula general sirve para cualquier
 * paso que no esté en la tabla.
 *
 * Machuelo de FORMADO (roll tap / forming tap): no corta, desplaza el material hacia arriba
 * para formar la cresta — por eso la broca es MÁS GRANDE que para un machuelo de corte del
 * mismo tamaño. Usar la broca de corte con un roll tap es un error común que lo rompe.
 * La regla aproximada usada aquí (broca ≈ Diámetro Mayor − 0.5 × Paso) es una referencia de
 * punto de partida — los roll taps varían más entre fabricantes que los de corte; confirma
 * siempre con la ficha técnica del fabricante del machuelo antes de perforar en producción.
 */

function metricRollTapDrill(majorMm: number, pitchMm: number, curated?: number): number {
  return curated ?? Number((majorMm - 0.5 * pitchMm).toFixed(2));
}

export const METRIC_TAP_DRILLS: TapDrillEntry[] = [
  { designation: 'M3 x 0.5', unitSystem: 'metric', majorDiameterMm: 3, pitchMm: 0.5, cutTapDrillMm: 2.5, cutTapDrillLabel: '2.5mm', rollTapDrillMm: metricRollTapDrill(3, 0.5, 2.8), rollTapDrillLabel: '2.8mm' },
  { designation: 'M4 x 0.7', unitSystem: 'metric', majorDiameterMm: 4, pitchMm: 0.7, cutTapDrillMm: 3.3, cutTapDrillLabel: '3.3mm', rollTapDrillMm: metricRollTapDrill(4, 0.7, 3.7), rollTapDrillLabel: '3.7mm' },
  { designation: 'M5 x 0.8', unitSystem: 'metric', majorDiameterMm: 5, pitchMm: 0.8, cutTapDrillMm: 4.2, cutTapDrillLabel: '4.2mm', rollTapDrillMm: metricRollTapDrill(5, 0.8, 4.7), rollTapDrillLabel: '4.7mm' },
  { designation: 'M6 x 1.0', unitSystem: 'metric', majorDiameterMm: 6, pitchMm: 1.0, cutTapDrillMm: 5.0, cutTapDrillLabel: '5.0mm', rollTapDrillMm: metricRollTapDrill(6, 1.0, 5.5), rollTapDrillLabel: '5.5mm' },
  { designation: 'M8 x 1.25', unitSystem: 'metric', majorDiameterMm: 8, pitchMm: 1.25, cutTapDrillMm: 6.8, cutTapDrillLabel: '6.8mm', rollTapDrillMm: metricRollTapDrill(8, 1.25, 7.4), rollTapDrillLabel: '7.4mm' },
  { designation: 'M10 x 1.5', unitSystem: 'metric', majorDiameterMm: 10, pitchMm: 1.5, cutTapDrillMm: 8.5, cutTapDrillLabel: '8.5mm', rollTapDrillMm: metricRollTapDrill(10, 1.5, 9.2), rollTapDrillLabel: '9.2mm' },
  { designation: 'M12 x 1.75', unitSystem: 'metric', majorDiameterMm: 12, pitchMm: 1.75, cutTapDrillMm: 10.2, cutTapDrillLabel: '10.2mm', rollTapDrillMm: metricRollTapDrill(12, 1.75, 11.0), rollTapDrillLabel: '11.0mm' },
  { designation: 'M14 x 2.0', unitSystem: 'metric', majorDiameterMm: 14, pitchMm: 2.0, cutTapDrillMm: 12.0, cutTapDrillLabel: '12.0mm', rollTapDrillMm: metricRollTapDrill(14, 2.0, 12.9), rollTapDrillLabel: '12.9mm' },
  { designation: 'M16 x 2.0', unitSystem: 'metric', majorDiameterMm: 16, pitchMm: 2.0, cutTapDrillMm: 14.0, cutTapDrillLabel: '14.0mm', rollTapDrillMm: metricRollTapDrill(16, 2.0, 14.9), rollTapDrillLabel: '14.9mm' },
  { designation: 'M20 x 2.5', unitSystem: 'metric', majorDiameterMm: 20, pitchMm: 2.5, cutTapDrillMm: 17.5, cutTapDrillLabel: '17.5mm', rollTapDrillMm: metricRollTapDrill(20, 2.5, 18.6), rollTapDrillLabel: '18.6mm' },
];

export const UNC_TAP_DRILLS: TapDrillEntry[] = [
  { designation: '#4-40 UNC', unitSystem: 'inch', majorDiameterMm: 2.845, pitchMm: 25.4 / 40, cutTapDrillMm: 2.261, cutTapDrillLabel: '#43 (0.089")', rollTapDrillMm: 2.489, rollTapDrillLabel: '#37 (0.104")' },
  { designation: '#6-32 UNC', unitSystem: 'inch', majorDiameterMm: 3.505, pitchMm: 25.4 / 32, cutTapDrillMm: 2.705, cutTapDrillLabel: '#36 (0.1065")', rollTapDrillMm: 2.999, rollTapDrillLabel: '#31 (0.120")' },
  { designation: '#8-32 UNC', unitSystem: 'inch', majorDiameterMm: 4.166, pitchMm: 25.4 / 32, cutTapDrillMm: 3.454, cutTapDrillLabel: '#29 (0.136")', rollTapDrillMm: 3.658, rollTapDrillLabel: '#26 (0.147")' },
  { designation: '#10-24 UNC', unitSystem: 'inch', majorDiameterMm: 4.826, pitchMm: 25.4 / 24, cutTapDrillMm: 3.797, cutTapDrillLabel: '#25 (0.1495")', rollTapDrillMm: 4.216, rollTapDrillLabel: '#19 (0.166")' },
  { designation: '1/4-20 UNC', unitSystem: 'inch', majorDiameterMm: 6.35, pitchMm: 25.4 / 20, cutTapDrillMm: 5.105, cutTapDrillLabel: '#7 (0.201")', rollTapDrillMm: 5.639, rollTapDrillLabel: '17/64" (0.2656")' },
  { designation: '5/16-18 UNC', unitSystem: 'inch', majorDiameterMm: 7.938, pitchMm: 25.4 / 18, cutTapDrillMm: 6.528, cutTapDrillLabel: 'F (0.257")', rollTapDrillMm: 7.14, rollTapDrillLabel: '9/32" (0.28125")' },
  { designation: '3/8-16 UNC', unitSystem: 'inch', majorDiameterMm: 9.525, pitchMm: 25.4 / 16, cutTapDrillMm: 7.938, cutTapDrillLabel: '5/16" (0.3125")', rollTapDrillMm: 8.611, rollTapDrillLabel: '11/32" (0.34375")' },
  { designation: '1/2-13 UNC', unitSystem: 'inch', majorDiameterMm: 12.7, pitchMm: 25.4 / 13, cutTapDrillMm: 10.716, cutTapDrillLabel: '27/64" (0.4219")', rollTapDrillMm: 11.51, rollTapDrillLabel: '29/64" (0.4531")' },
];

export const UNF_TAP_DRILLS: TapDrillEntry[] = [
  { designation: '1/4-28 UNF', unitSystem: 'inch', majorDiameterMm: 6.35, pitchMm: 25.4 / 28, cutTapDrillMm: 5.41, cutTapDrillLabel: '#3 (0.213")', rollTapDrillMm: 5.867, rollTapDrillLabel: '#15 (0.180")→(ajustar)' },
  { designation: '5/16-24 UNF', unitSystem: 'inch', majorDiameterMm: 7.938, pitchMm: 25.4 / 24, cutTapDrillMm: 6.909, cutTapDrillLabel: 'I (0.272")', rollTapDrillMm: 7.408, rollTapDrillLabel: '9/32"+ (ajustar)' },
  { designation: '3/8-24 UNF', unitSystem: 'inch', majorDiameterMm: 9.525, pitchMm: 25.4 / 24, cutTapDrillMm: 8.433, cutTapDrillLabel: 'Q (0.332")', rollTapDrillMm: 8.996, rollTapDrillLabel: '23/64"+ (ajustar)' },
  { designation: '1/2-20 UNF', unitSystem: 'inch', majorDiameterMm: 12.7, pitchMm: 25.4 / 20, cutTapDrillMm: 11.51, cutTapDrillLabel: '29/64" (0.4531")', rollTapDrillMm: 12.065, rollTapDrillLabel: '15/32"+ (ajustar)' },
];

/**
 * Calcula la broca previa para CUALQUIER paso métrico no listado en la tabla curada,
 * usando la aproximación estándar de taller (~75% de engrane): broca ≈ Ø mayor − paso.
 */
export function estimateMetricCutTapDrillMm(majorDiameterMm: number, pitchMm: number): number {
  return Number((majorDiameterMm - pitchMm).toFixed(2));
}

export function estimateMetricRollTapDrillMm(majorDiameterMm: number, pitchMm: number): number {
  return Number((majorDiameterMm - 0.5 * pitchMm).toFixed(2));
}

export function findMetricTapDrill(designation: string): TapDrillEntry | undefined {
  return METRIC_TAP_DRILLS.find((e) => e.designation.replace(/\s/g, '').toUpperCase() === designation.replace(/\s/g, '').toUpperCase());
}
