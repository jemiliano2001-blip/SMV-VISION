/**
 * Helpers de formateo y conversión de unidades para la calculadora de
 * velocidades y avances. Torneado mantiene estado dual imperial/métrico;
 * fresado guarda canónico en pulgadas y convierte a mm solo para display.
 */

export type UnitSystem = 'imperial' | 'metric';
export type OperationMode = 'turning' | 'milling';

export const INCH_TO_MM = 25.4;
export const MM_TO_INCH = 1 / INCH_TO_MM;
export const SFM_TO_MMIN = 1 / 3.28084;
export const MMIN_TO_SFM = 3.28084;

/** Convierte un valor desconocido (número, string de un input, etc.) a número finito, o el fallback. */
export function toFinite(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Parser seguro para el `onChange` de inputs numéricos controlados: un campo
 * vacío conserva el último valor válido en vez de colapsar a 0 o NaN.
 */
export function parseInputNumber(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  return toFinite(raw, fallback);
}

type DimKind = 'length' | 'feed' | 'speed';

/**
 * Formatea un valor en unidad métrica canónica (mm para longitud/avance,
 * m/min para velocidad de corte) al sistema de unidades activo.
 */
export function formatDim(value: number, unitSystem: UnitSystem, kind: DimKind): string {
  switch (kind) {
    case 'length':
      return unitSystem === 'imperial' ? `${(value * MM_TO_INCH).toFixed(3)}"` : `${value.toFixed(2)} mm`;
    case 'feed':
      return unitSystem === 'imperial' ? `${(value * MM_TO_INCH).toFixed(4)}"/rev` : `${value.toFixed(2)} mm/rev`;
    case 'speed':
      return unitSystem === 'imperial'
        ? `${Math.round(value * MMIN_TO_SFM).toLocaleString()} SFM`
        : `${Math.round(value).toLocaleString()} m/min`;
    default:
      return `${value}`;
  }
}

export interface TurningDiagramLabels {
  diameter: string;
  finalDiameter: string;
  depth: string;
  feed: string;
  radius: string;
}

/** Construye las etiquetas ya formateadas que espera `TurningCutDiagram`. */
export function buildTurningDiagramLabels(params: {
  diameterMm: number;
  finalDiameterMm: number;
  depthOfCutMm: number;
  feedMm: number;
  noseRadiusMm: number;
  unitSystem: UnitSystem;
}): TurningDiagramLabels {
  const { diameterMm, finalDiameterMm, depthOfCutMm, feedMm, noseRadiusMm, unitSystem } = params;
  return {
    diameter: formatDim(diameterMm, unitSystem, 'length'),
    finalDiameter: formatDim(finalDiameterMm, unitSystem, 'length'),
    depth: formatDim(depthOfCutMm, unitSystem, 'length'),
    feed: formatDim(feedMm, unitSystem, 'feed'),
    radius: unitSystem === 'imperial' ? `${(noseRadiusMm * MM_TO_INCH).toFixed(4)}"` : `${noseRadiusMm.toFixed(2)} mm`,
  };
}

export interface MillingDiagramLabels {
  diameter: string;
  radial: string;
  axial: string;
  feed: string;
}

/** Construye las etiquetas ya formateadas que espera `MillingCutDiagram`. */
export function buildMillingDiagramLabels(params: {
  toolDiameterMm: number;
  radialDepthMm: number;
  axialDepthMm: number;
  tableFeedMmMin: number;
  unitSystem: UnitSystem;
}): MillingDiagramLabels {
  const { toolDiameterMm, radialDepthMm, axialDepthMm, tableFeedMmMin, unitSystem } = params;
  return {
    diameter: formatDim(toolDiameterMm, unitSystem, 'length'),
    radial: formatDim(radialDepthMm, unitSystem, 'length'),
    axial: formatDim(axialDepthMm, unitSystem, 'length'),
    feed:
      unitSystem === 'imperial'
        ? `${(tableFeedMmMin * MM_TO_INCH).toFixed(1)} ipm`
        : `${tableFeedMmMin.toFixed(0)} mm/min`,
  };
}

/** Formatea un monto en pesos mexicanos para las tarjetas de costo/ficha. */
export function formatMxn(value: number): string {
  return `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
}
