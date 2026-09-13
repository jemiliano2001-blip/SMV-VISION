import { findMaterialById } from './materialDatabase';
import { findHaasMachineById } from './haasProfiles';
import type {
  HaasMachineProfile,
  MachineLimitCheck,
  SpeedsFeedsTurningInput,
  SpeedsFeedsTurningResult,
  SpeedsFeedsMillingInput,
  SpeedsFeedsMillingResult,
} from './types';

const MACHINE_EFFICIENCY = 0.80; // 80% de eficiencia mecánica de husillo Haas

/**
 * Potencia que el husillo puede entregar a `rpm` según su curva par/potencia.
 * Debajo de `maxTorqueAtRpm` el motor está en zona de par constante:
 * P(kW) = T(Nm) · n / 9549. Arriba entrega la potencia nominal.
 */
export function availableSpindleHpAtRpm(machine: HaasMachineProfile, rpm: number): number {
  const safeRpm = Math.max(rpm, 1);
  if (machine.maxTorqueNm && machine.maxTorqueAtRpm && safeRpm < machine.maxTorqueAtRpm) {
    const kw = (machine.maxTorqueNm * safeRpm) / 9549;
    return Number(Math.min(kw * 1.341, machine.horsepower).toFixed(2));
  }
  return machine.horsepower;
}

function buildMachineCheck(
  machine: HaasMachineProfile,
  rpm: number,
  diameterMm: number,
  motorPowerHpRequired: number
): MachineLimitCheck {
  const usableRpm = Math.min(rpm, machine.maxRpm);
  const rpmIsCapped = rpm > machine.maxRpm;
  const effectiveSurfaceSpeedMMin = Number(((Math.PI * diameterMm * usableRpm) / 1000).toFixed(1));
  const availableHpAtRpm = availableSpindleHpAtRpm(machine, usableRpm);
  return {
    machineId: machine.id,
    maxRpm: machine.maxRpm,
    ratedHp: machine.horsepower,
    usableRpm,
    rpmIsCapped,
    effectiveSurfaceSpeedMMin,
    availableHpAtRpm,
    powerUtilization: Number((motorPowerHpRequired / Math.max(availableHpAtRpm, 0.01)).toFixed(3)),
    rpmUtilization: Number((usableRpm / machine.maxRpm).toFixed(3)),
  };
}

/**
 * Calcula todos los parámetros de corte para Torneado CNC.
 */
export function calculateTurningSpeedsFeeds(input: SpeedsFeedsTurningInput): SpeedsFeedsTurningResult {
  const {
    diameterMm,
    cuttingSpeedMMin,
    feedPerRevMm,
    depthOfCutMm,
    noseRadiusMm,
    materialId,
    haasMachineId,
  } = input;

  const material = findMaterialById(materialId);
  const kc = material ? material.kc : 2000;
  const haasMachine = haasMachineId ? findHaasMachineById(haasMachineId) : undefined;

  const warnings: string[] = [];
  const tips: string[] = [];

  const safeDiameter = Math.max(diameterMm, 0.1);
  const safeVc = Math.max(cuttingSpeedMMin, 1);
  const safeFn = Math.max(feedPerRevMm, 0.01);
  const safeAp = Math.max(depthOfCutMm, 0.05);
  const safeRadius = Math.max(noseRadiusMm, 0.1);

  // 1. RPM = (Vc * 1000) / (pi * D)
  const rpm = Math.round((safeVc * 1000) / (Math.PI * safeDiameter));

  // 2. Avance de mesa vf = n * fn (mm/min)
  const feedRateMmMin = Number((rpm * safeFn).toFixed(1));

  // 3. Tasa de remoción de material MRR = Vc * ap * fn (cm3/min)
  const mrrCm3Min = Number((safeVc * safeAp * safeFn).toFixed(2));

  // 4. Potencia neta de corte Pc (kW) = (Vc * ap * fn * Kc) / (60 * 10^3)
  const netPowerKw = Number(((safeVc * safeAp * safeFn * kc) / 60000).toFixed(2));
  const netPowerHp = Number((netPowerKw * 1.341).toFixed(2));
  const motorPowerHpRequired = Number((netPowerHp / MACHINE_EFFICIENCY).toFixed(2));

  // 5. Rugosidad Superficial Teórica Ra = (fn^2 / (32 * r)) * 1000 (micrómetros um)
  const theoreticalSurfaceRoughnessRaUm = Number(
    (((safeFn * safeFn) / (32 * safeRadius)) * 1000).toFixed(2)
  );
  const theoreticalSurfaceRoughnessRzUm = Number((theoreticalSurfaceRoughnessRaUm * 4).toFixed(2));

  // 6. Validaciones de Material
  if (material) {
    const [minVc, maxVc] = material.vcTurningMMin;
    if (safeVc < minVc) {
      warnings.push(`Velocidad de corte baja (${safeVc} m/min). Para ${material.name} se recomienda entre ${minVc} y ${maxVc} m/min para evitar filo recrecido (BUE).`);
    } else if (safeVc > maxVc) {
      warnings.push(`Velocidad de corte agresiva (${safeVc} m/min). El rango recomendado para ${material.name} es ${minVc} - ${maxVc} m/min para preservar la vida del inserto.`);
    }

    if (material.group === 'M' && safeFn < 0.06) {
      warnings.push('En acero inoxidable el avance mínimo debe ser ≥ 0.06 mm/rev para no frotar la capa endurecida (Work Hardening).');
    }
  }

  // 7. Validaciones de Máquina Haas
  let machine: MachineLimitCheck | undefined;
  if (haasMachine) {
    machine = buildMachineCheck(haasMachine, rpm, safeDiameter, motorPowerHpRequired);
    if (machine.rpmIsCapped) {
      warnings.push(`⚠️ RPM requeridas (${rpm.toLocaleString()}) exceden el límite de la ${haasMachine.name} (Máx: ${haasMachine.maxRpm.toLocaleString()} RPM). El husillo topará a ${haasMachine.maxRpm.toLocaleString()} RPM y la Vc real será ${machine.effectiveSurfaceSpeedMMin} m/min. Usa programación G96 con límite G50 S${haasMachine.maxRpm}.`);
    }
    if (machine.availableHpAtRpm < haasMachine.horsepower && motorPowerHpRequired > machine.availableHpAtRpm * 0.85) {
      warnings.push(`⚠️ A ${machine.usableRpm.toLocaleString()} RPM el husillo de la ${haasMachine.name} está en zona de par constante y solo entrega ~${machine.availableHpAtRpm} HP (par máx. a ${haasMachine.maxTorqueAtRpm} RPM). El corte pide ${motorPowerHpRequired} HP: reduce ap o sube la Vc.`);
    } else if (motorPowerHpRequired > haasMachine.horsepower * 0.85) {
      warnings.push(`⚠️ Potencia requerida (${motorPowerHpRequired} HP) está al límite o supera el 85% del motor de la ${haasMachine.name} (${haasMachine.horsepower} HP). Reduce la profundidad de corte (ap).`);
    }
  }

  // 8. Consejos Técnicos de Taller
  if (safeAp < safeRadius * 0.5) {
    tips.push(`La profundidad de corte (${safeAp} mm) es menor que la mitad del radio (${safeRadius} mm). En desbaste se recomienda ap ≥ radio para evitar empuje radial y vibración.`);
  }

  if (theoreticalSurfaceRoughnessRaUm <= 1.6) {
    tips.push(`Acabado fino logrado (Ra ~ ${theoreticalSurfaceRoughnessRaUm} µm). Cumple tolerancias de sellado y ajuste con baleros.`);
  } else {
    tips.push(`Para mejorar el acabado superficial a Ra < 1.6 µm, reduce el avance a ${(Math.sqrt(1.6 * 32 * safeRadius / 1000)).toFixed(2)} mm/rev o usa radio de punta mayor.`);
  }

  // Conversiones Imperiales
  const surfaceSpeedSfm = Number((safeVc * 3.28084).toFixed(1));
  const feedRateIpm = Number((feedRateMmMin / 25.4).toFixed(2));
  const mrrIn3Min = Number((mrrCm3Min / 16.387).toFixed(2));
  const theoreticalSurfaceRoughnessRaUin = Number((theoreticalSurfaceRoughnessRaUm * 39.37).toFixed(1));

  return {
    rpm,
    surfaceSpeedMMin: safeVc,
    surfaceSpeedSfm,
    feedRateMmMin,
    feedRateIpm,
    mrrCm3Min,
    mrrIn3Min,
    netPowerKw,
    netPowerHp,
    motorPowerHpRequired,
    theoreticalSurfaceRoughnessRaUm,
    theoreticalSurfaceRoughnessRaUin,
    theoreticalSurfaceRoughnessRzUm,
    machine,
    warnings,
    tips,
  };
}

/**
 * Calcula todos los parámetros de corte para Fresado CNC (Endmills & Face Mills).
 */
export function calculateMillingSpeedsFeeds(input: SpeedsFeedsMillingInput): SpeedsFeedsMillingResult {
  const {
    toolDiameterInch,
    numberOfFlutes,
    surfaceFeetPerMinute,
    chipLoadInch,
    axialDepthOfCutMm,
    radialDepthOfCutMm,
    materialId,
    haasMachineId,
  } = input;

  const material = findMaterialById(materialId);
  const kc = material ? material.kc : 2000;
  const haasMachine = haasMachineId ? findHaasMachineById(haasMachineId) : undefined;

  const warnings: string[] = [];
  const tips: string[] = [];

  const safeDInch = Math.max(toolDiameterInch, 0.03);
  const safeDMm = safeDInch * 25.4;
  const safeZ = Math.max(numberOfFlutes, 1);
  const safeSfm = Math.max(surfaceFeetPerMinute, 10);
  const safeFz = Math.max(chipLoadInch, 0.0002);
  const safeApMm = Math.max(axialDepthOfCutMm, 0.1);
  const safeAeMm = Math.max(radialDepthOfCutMm, 0.1);

  // 1. RPM = (SFM * 3.82) / D
  const rpm = Math.round((safeSfm * 3.82) / safeDInch);

  // 2. Chip Thinning Factor (RCTF) cuando el paso radial ae es menor al 50% del diámetro
  const radialRatio = Math.min(safeAeMm / safeDMm, 1.0);
  let radialChipThinningFactor = 1.0;

  if (radialRatio < 0.5 && radialRatio > 0.001) {
    // RCTF = 1 / sqrt(1 - (1 - 2 * (ae/D))^2)
    const denominator = Math.sqrt(1 - Math.pow(1 - 2 * radialRatio, 2));
    radialChipThinningFactor = denominator > 0 ? Number((1 / denominator).toFixed(3)) : 1.0;
  }

  // 3. Avances de mesa (IPM y mm/min)
  const tableFeedIpm = Number((rpm * safeFz * safeZ).toFixed(1));
  const tableFeedMmMin = Number((tableFeedIpm * 25.4).toFixed(1));

  // El chip load programado (fz) es el avance por diente que se captura en el CNC, pero con
  // engagement radial < 50% del diámetro la viruta REAL que arranca el filo es más delgada que
  // eso — por eso existe el chip thinning factor: efectivo = programado / RCTF.
  const effectiveChipLoadInch = Number((safeFz / radialChipThinningFactor).toFixed(5));
  const adjustedFeedIpm = Number((tableFeedIpm * radialChipThinningFactor).toFixed(1));
  const adjustedFeedMmMin = Number((adjustedFeedIpm * 25.4).toFixed(1));

  // 4. Tasa de remoción de material MRR = (ap * ae * vf) / 1000 (cm3/min)
  const activeFeedMmMin = radialChipThinningFactor > 1 ? adjustedFeedMmMin : tableFeedMmMin;
  const mrrCm3Min = Number(((safeApMm * safeAeMm * activeFeedMmMin) / 1000).toFixed(2));

  // 5. Potencia neta de corte Pc (kW) = (ap * ae * vf * Kc) / (60 * 10^6)
  const netPowerKw = Number(((safeApMm * safeAeMm * activeFeedMmMin * kc) / 60000000).toFixed(2));
  const netPowerHp = Number((netPowerKw * 1.341).toFixed(2));
  const motorPowerHpRequired = Number((netPowerHp / MACHINE_EFFICIENCY).toFixed(2));

  // 6. Validaciones de Material
  if (material) {
    const [minSfm, maxSfm] = material.sfmMilling;
    if (safeSfm < minSfm) {
      warnings.push(`SFM conservador (${safeSfm}). Para ${material.name} el rango óptimo es ${minSfm} - ${maxSfm} SFM.`);
    } else if (safeSfm > maxSfm) {
      warnings.push(`SFM alto (${safeSfm}). Podría sobrecalentar la fresa en ${material.name}. Rango sugerido: ${minSfm} - ${maxSfm} SFM.`);
    }

    if (material.group === 'N' && safeZ > 3) {
      tips.push('Para aluminio se recomiendan fresas de 2 o 3 filos (2F/3F) para un desalojo óptimo de viruta y evitar atascos.');
    } else if (material.group === 'M' && safeZ < 4) {
      tips.push('Para acero inoxidable se recomiendan fresas de 4 o 5 filos con recubrimiento nACo/AlCrN para fresado trocoidal.');
    }
  }

  // 7. Validaciones de Máquina Haas
  let machine: MachineLimitCheck | undefined;
  if (haasMachine) {
    machine = buildMachineCheck(haasMachine, rpm, safeDMm, motorPowerHpRequired);
    if (machine.rpmIsCapped) {
      warnings.push(`⚠️ RPM calculadas (${rpm.toLocaleString()}) superan el husillo de la ${haasMachine.name} (${haasMachine.maxRpm.toLocaleString()} RPM). A tope de husillo la Vc real baja a ${Math.round(machine.effectiveSurfaceSpeedMMin * 3.28084)} SFM: reduce SFM o incrementa el diámetro de fresa.`);
    }
    if (machine.availableHpAtRpm < haasMachine.horsepower && motorPowerHpRequired > machine.availableHpAtRpm * 0.85) {
      warnings.push(`⚠️ A ${machine.usableRpm.toLocaleString()} RPM el husillo de la ${haasMachine.name} está en zona de par constante y solo entrega ~${machine.availableHpAtRpm} HP (par máx. a ${haasMachine.maxTorqueAtRpm} RPM). Reduce ae/ap o sube las RPM.`);
    } else if (motorPowerHpRequired > haasMachine.horsepower * 0.85) {
      warnings.push(`⚠️ Potencia estimada (${motorPowerHpRequired} HP) supera el 85% de la ${haasMachine.name} (${haasMachine.horsepower} HP). Reduce el ancho de corte (ae) o profundidad (ap).`);
    }
  }

  // Ángulo de contacto radial: θ = arccos(1 − 2·ae/D). 180° = ranurado a todo el diámetro.
  const engagementAngleDeg = Number(((Math.acos(Math.max(-1, Math.min(1, 1 - 2 * radialRatio))) * 180) / Math.PI).toFixed(1));

  // 8. Consejos Técnicos de Fresado
  if (radialChipThinningFactor > 1.1) {
    tips.push(`Chip Thinning Activo (${radialChipThinningFactor}x): Al fresar con paso radial ligero (${(radialRatio * 100).toFixed(0)}% del diámetro), puedes aumentar el avance a ${adjustedFeedIpm} IPM (${adjustedFeedMmMin} mm/min) sin sobrecargar el filo.`);
  }

  const mrrIn3Min = Number((mrrCm3Min / 16.387).toFixed(2));

  return {
    rpm,
    tableFeedIpm,
    tableFeedMmMin,
    effectiveChipLoadInch,
    radialChipThinningFactor,
    adjustedFeedIpm,
    mrrCm3Min,
    mrrIn3Min,
    netPowerKw,
    netPowerHp,
    motorPowerHpRequired,
    machine,
    engagementAngleDeg,
    warnings,
    tips,
  };
}
