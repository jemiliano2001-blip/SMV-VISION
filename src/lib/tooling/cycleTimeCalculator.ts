/**
 * cycleTimeCalculator.ts
 *
 * Motor de cálculo de tiempos de ciclo de maquinado CNC y costos para
 * tornos Haas ST (ST-10, ST-15, ST-20, ST-25, ST-30) y centros de
 * maquinado Haas VF (VF-2, VF-3, VF-4, UMC).
 */

export interface TurningCycleTimeInput {
  /** Longitud axial de corte en pulgadas (ej. 2.500") o mm si unitSystem='metric' */
  cutLength: number;
  /** Diámetro en bruto del material (ej. 2.000") */
  rawDiameter: number;
  /** Diámetro terminado final (ej. 1.250") */
  finalDiameter: number;
  /** Profundidad de corte radial por pasada ap (ej. 0.080") */
  depthOfCutAp: number;
  /** Avance por revolución fn (ej. 0.010 in/rev o mm/rev) */
  feedPerRev: number;
  /** RPM promedio calculadas de corte (o constantes) */
  rpm: number;
  /** Tarifa horaria de la máquina en $/hr (ej. 65 USD/hr) */
  hourlyRate: number;
  /** Tiempo de carga/descarga de chuck hidráulico en segundos (default: 20s) */
  partHandlingSec?: number;
  /** Número de cambios de herramienta / indexados de torreta (default: 1) */
  toolChanges?: number;
  /** Sistema de unidades */
  unitSystem?: 'imperial' | 'metric';
}

export interface TurningCycleTimeResult {
  /** Número de pasadas de desbaste calculadas */
  roughPasses: number;
  /** Distancia total recorrida en corte continuo */
  totalCutDistance: number;
  /** Tiempo de corte puro en segundos */
  pureCutTimeSec: number;
  /** Tiempo de retrocesos en avance rápido G00 en segundos (~12% del corte) */
  rapidRetractSec: number;
  /** Tiempo de indexado de torreta Haas (2.5s por index) */
  toolChangeTimeSec: number;
  /** Tiempo de carga y descarga de pieza en chuck */
  partHandlingSec: number;
  /** Tiempo total de ciclo por pieza en segundos */
  totalCycleTimeSec: number;
  /** Tiempo formateado (ej. "1m 45s" o "42s") */
  formattedCycleTime: string;
  /** Piezas por hora al 100% de eficiencia */
  partsPerHourTheoretical: number;
  /** Piezas por turno de 8 horas con 85% OEE de taller */
  partsPer8hShift: number;
  /** Costo de maquinado por pieza ($) */
  machiningCostPerPart: number;
}

export interface MillingCycleTimeInput {
  /** Volumen total de material a remover en in³ (o cm³ si métrico) */
  materialVolumeToRemove: number;
  /** Tasa de remoción de material MRR en in³/min (o cm³/min si métrico) */
  mrr: number;
  /** Tarifa horaria de la máquina en $/hr */
  hourlyRate: number;
  /** Tiempo de montaje/sujeción en prensa en segundos (default: 30s) */
  partHandlingSec?: number;
  /** Número de cambios de herramienta ATC (side mount 2.8s c/u) */
  toolChanges?: number;
}

export interface MillingCycleTimeResult {
  /** Tiempo de corte puro en segundos */
  pureCutTimeSec: number;
  /** Tiempo de movimientos en vacío y posicionamiento (~15%) */
  airCutTimeSec: number;
  /** Tiempo de cambios de herramienta Haas Side-Mount (2.8s c/u) */
  toolChangeTimeSec: number;
  /** Tiempo de fijación en prensa */
  partHandlingSec: number;
  /** Tiempo total de ciclo por pieza en segundos */
  totalCycleTimeSec: number;
  /** Tiempo formateado (ej. "3m 15s") */
  formattedCycleTime: string;
  /** Piezas por hora teóricas */
  partsPerHourTheoretical: number;
  /** Piezas por turno de 8 horas al 85% OEE */
  partsPer8hShift: number;
  /** Costo de maquinado por pieza ($) */
  machiningCostPerPart: number;
}

/** Formatea segundos a "Xm Ys" o "Xs" */
export function formatSecondsToTime(sec: number): string {
  if (sec <= 0) return '0s';
  const minutes = Math.floor(sec / 60);
  const remainingSec = Math.round(sec % 60);
  if (minutes === 0) return `${remainingSec}s`;
  return `${minutes}m ${remainingSec.toString().padStart(2, '0')}s`;
}

function toFinite(val: unknown, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

/**
 * Calcula tiempos de ciclo y costos para Torneado Haas ST.
 */
export function calculateTurningCycleTime(input: TurningCycleTimeInput): TurningCycleTimeResult {
  const {
    cutLength,
    rawDiameter,
    finalDiameter,
    depthOfCutAp,
    feedPerRev,
    rpm,
    hourlyRate,
    partHandlingSec = 20,
    toolChanges = 1,
  } = input;

  const safeLength = Math.max(toFinite(cutLength, 2.0), 0.05);
  const safeAp = Math.max(toFinite(depthOfCutAp, 0.080), 0.005);
  const safeFn = Math.max(toFinite(feedPerRev, 0.008), 0.001);
  const safeRpm = Math.max(toFinite(rpm, 1000), 50);
  const safeRate = Math.max(toFinite(hourlyRate, 65), 1);
  const safeHandling = Math.max(toFinite(partHandlingSec, 20), 0);
  const safeChanges = Math.max(toFinite(toolChanges, 1), 0);

  const rawDia = toFinite(rawDiameter, 2.0);
  const finalDia = toFinite(finalDiameter, 1.25);

  // Reducción total de radio
  const totalRadialReduction = Math.max((rawDia - finalDia) / 2, 0);

  // Número de pasadas de desbaste (mínimo 1 si hay reducción)
  const roughPasses = totalRadialReduction > 0 ? Math.max(Math.ceil(totalRadialReduction / safeAp), 1) : 1;

  // Distancia total de corte = longitud * número de pasadas
  const totalCutDistance = safeLength * roughPasses;

  // Avance en unidades por minuto (IPM o mm/min)
  const feedPerMin = safeRpm * safeFn;

  // Tiempo de corte puro en minutos = distancia / avance por minuto
  const pureCutTimeMin = feedPerMin > 0 ? totalCutDistance / feedPerMin : 0;
  const pureCutTimeSec = Math.round(pureCutTimeMin * 60);

  // Retornos en rápido G00 (~12% del tiempo de corte para retroceder la torreta)
  const rapidRetractSec = Math.round(pureCutTimeSec * 0.12);

  // Tiempo de indexado de torreta Haas ST (~2.5s por herramienta)
  const toolChangeTimeSec = Math.round(safeChanges * 2.5);

  // Tiempo total de ciclo
  const totalCycleTimeSec = pureCutTimeSec + rapidRetractSec + toolChangeTimeSec + safeHandling;

  const formattedCycleTime = formatSecondsToTime(totalCycleTimeSec);

  // Piezas por hora teóricas (3600 seg / ciclo)
  const partsPerHourTheoretical = totalCycleTimeSec > 0 ? Number((3600 / totalCycleTimeSec).toFixed(1)) : 0;

  // Piezas por turno de 8 horas con 85% OEE (8 * 3600 * 0.85 = 24480 seg útiles)
  const partsPer8hShift = totalCycleTimeSec > 0 ? Math.floor((24480 / totalCycleTimeSec)) : 0;

  // Costo por pieza = (Tarifa horaria / 3600) * tiempo total en segundos
  const machiningCostPerPart = Number(((safeRate / 3600) * totalCycleTimeSec).toFixed(2));

  return {
    roughPasses,
    totalCutDistance,
    pureCutTimeSec,
    rapidRetractSec,
    toolChangeTimeSec,
    partHandlingSec,
    totalCycleTimeSec,
    formattedCycleTime,
    partsPerHourTheoretical,
    partsPer8hShift,
    machiningCostPerPart,
  };
}

/**
 * Calcula tiempos de ciclo y costos para Fresado Haas VF.
 */
export function calculateMillingCycleTime(input: MillingCycleTimeInput): MillingCycleTimeResult {
  const {
    materialVolumeToRemove,
    mrr,
    hourlyRate,
    partHandlingSec = 30,
    toolChanges = 1,
  } = input;

  const safeVol = Math.max(toFinite(materialVolumeToRemove, 6.0), 0.01);
  const safeMrr = Math.max(toFinite(mrr, 1.5), 0.01);
  const safeRate = Math.max(toFinite(hourlyRate, 75), 1);
  const safeHandling = Math.max(toFinite(partHandlingSec, 30), 0);
  const safeChanges = Math.max(toFinite(toolChanges, 1), 0);

  // Tiempo de corte en minutos = volumen / MRR
  const cutTimeMin = safeVol / safeMrr;
  const pureCutTimeSec = Math.round(cutTimeMin * 60);

  // Movimientos en el aire, aproximaciones y salidas (~15%)
  const airCutTimeSec = Math.round(pureCutTimeSec * 0.15);

  // Tiempo de cambio de herramienta ATC Haas Side-Mount (2.8s por cambio)
  const toolChangeTimeSec = Math.round(safeChanges * 2.8);

  const totalCycleTimeSec = pureCutTimeSec + airCutTimeSec + toolChangeTimeSec + safeHandling;
  const formattedCycleTime = formatSecondsToTime(totalCycleTimeSec);

  const partsPerHourTheoretical = totalCycleTimeSec > 0 ? Number((3600 / totalCycleTimeSec).toFixed(1)) : 0;
  const partsPer8hShift = totalCycleTimeSec > 0 ? Math.floor(24480 / totalCycleTimeSec) : 0;
  const machiningCostPerPart = Number(((safeRate / 3600) * totalCycleTimeSec).toFixed(2));

  return {
    pureCutTimeSec,
    airCutTimeSec,
    toolChangeTimeSec,
    partHandlingSec,
    totalCycleTimeSec,
    formattedCycleTime,
    partsPerHourTheoretical,
    partsPer8hShift,
    machiningCostPerPart,
  };
}

/**
 * Genera un bloque de código G nativo para Torno Haas ST (G71 Desbaste Longitudinal).
 */
export function generateHaasTurningGcode(options: {
  programNumber?: number;
  partName?: string;
  maxRpm?: number;
  sfm?: number;
  feedIpr?: number;
  apInch?: number;
  rawDiaInch?: number;
  finalDiaInch?: number;
  cutLengthInch?: number;
}): string {
  const oNum = options.programNumber ?? 1001;
  const part = options.partName ?? 'PIEZA_HAAS_ST';
  const maxRpm = options.maxRpm ?? 3000;
  const sfm = options.sfm ?? 450;
  const feed = options.feedIpr ?? 0.008;
  const ap = options.apInch ?? 0.080;
  const rawDia = options.rawDiaInch ?? 2.0;
  const finalDia = options.finalDiaInch ?? 1.25;
  const cutLen = options.cutLengthInch ?? 2.0;

  return `%
O${oNum} (${part})
(HAAS ST LATHE - ROUGH & FINISH PROFILE)
G20 (INCH MODE)
G28 (RETURN HOME)
(TOOL 1: WNMG / CNMG OD TURNING)
T0101
G50 S${maxRpm} (MAX SPINDLE RPM)
G96 S${sfm} M03 (CONSTANT SURFACE SPEED)
G54 (WORK OFFSET)
M08 (COOLANT ON)
G00 X${(rawDia + 0.1).toFixed(3)} Z0.1
G01 Z0.0 F${feed.toFixed(4)}
G01 X-0.03 (FACE FRONT)
G00 X${(rawDia + 0.05).toFixed(3)} Z0.05
(CICLO G71 DESBASTE LONGITUDINAL)
G71 P10 Q20 U0.020 W0.005 D${ap.toFixed(3)} F${feed.toFixed(4)}
N10 G00 X${finalDia.toFixed(3)}
G01 Z-${cutLen.toFixed(3)} F${feed.toFixed(4)}
N20 G01 X${(rawDia + 0.02).toFixed(3)}
G70 P10 Q20 (ACABADO DE CONTORNO)
M09 (COOLANT OFF)
G28 (RETURN HOME)
M30 (END OF PROGRAM)
%`;
}

/**
 * Genera un bloque de código G nativo para Centro de Maquinado Haas VF.
 */
export function generateHaasMillingGcode(options: {
  programNumber?: number;
  partName?: string;
  rpm?: number;
  feedIpm?: number;
  toolNumber?: number;
  toolDesc?: string;
}): string {
  const oNum = options.programNumber ?? 2001;
  const part = options.partName ?? 'FRESADO_HAAS_VF';
  const rpm = options.rpm ?? 3500;
  const feed = options.feedIpm ?? 42.0;
  const tool = options.toolNumber ?? 1;
  const desc = options.toolDesc ?? '1/2 4F ENDMILL CARBIDE';

  return `%
O${oNum} (${part})
(HAAS VF MILL - SETUP & ROUGH PROFILE)
G20 (INCH MODE)
G17 G40 G80 G90 (SETUP CANCEL & ABSOLUTE)
G28 G91 Z0. (HOME Z)
G90
(TOOL ${tool}: ${desc})
T${tool} M06
G54 (WORK COORDINATE)
G00 G90 X0. Y0. S${rpm} M03
G43 H${tool} Z1.0 M08 (HEIGHT COMP & COOLANT)
Z0.1
G01 Z-0.250 F${(feed * 0.5).toFixed(1)} (PLUNGE / RAMP)
(TRAYECTORIA DE CORTE)
G01 X2.000 F${feed.toFixed(1)}
G01 Y2.000
G01 X0.
G01 Y0.
G00 Z1.0
M09 (COOLANT OFF)
G28 G91 Z0.
G28 Y0. (PRESENT PART)
M30 (END OF PROGRAM)
%`;
}
