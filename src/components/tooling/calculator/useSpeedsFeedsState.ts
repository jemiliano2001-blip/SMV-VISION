import { useCallback, useEffect, useMemo, useState } from 'react';
import { MATERIAL_DATABASE, findMaterialById } from '../../../lib/tooling/materialDatabase';
import { findHaasMachineById } from '../../../lib/tooling/haasProfiles';
import {
  calculateTurningSpeedsFeeds,
  calculateMillingSpeedsFeeds,
} from '../../../lib/tooling/speedsFeedsCalculator';
import {
  calculateTurningCycleTime,
  calculateMillingCycleTime,
  generateHaasTurningGcode,
  generateHaasMillingGcode,
  type TurningCycleTimeResult,
  type MillingCycleTimeResult,
} from '../../../lib/tooling/cycleTimeCalculator';
import type {
  HaasMachineProfile,
  MaterialSpec,
  SpeedsFeedsTurningResult,
  SpeedsFeedsMillingResult,
} from '../../../lib/tooling/types';
import { INCH_TO_MM, MM_TO_INCH, MMIN_TO_SFM, SFM_TO_MMIN, formatMxn, toFinite, type OperationMode, type UnitSystem } from './formatters';

const TURNING_RATE_STORAGE_KEY = 'smv-vision.tooling.hourlyRateMxn.turning';
const MILLING_RATE_STORAGE_KEY = 'smv-vision.tooling.hourlyRateMxn.milling';

function readStoredRate(key: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStoredRate(key: string, value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Almacenamiento no disponible (modo privado, cuota, etc.) — no es crítico.
  }
}

export interface RangeBandData {
  value: number;
  min: number;
  max: number;
  unit: string;
}

/**
 * Estado y lógica completa de la calculadora de velocidades y avances.
 * Toda la UI (`CalculatorHeader`, `TurningInputs`, `MillingInputs`,
 * `ResultsPanel`, `CyclePanel`, `GcodePanel`) recibe este hook como prop
 * única `state`, evitando prop-drilling de docenas de campos individuales.
 */
export function useSpeedsFeedsState() {
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial');
  const [operationMode, setOperationModeState] = useState<OperationMode>('turning');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('steel_4140');
  const [selectedHaasId, setSelectedHaasId] = useState<string>('haas_st20');

  // ── Geometría & Tiempos (Estimador de Ciclo y Costo Haas) ──
  const [turningCutLengthInch, setTurningCutLengthInch] = useState<number>(2.5);
  const [turningRawDiaInch, setTurningRawDiaInch] = useState<number>(2.0);
  const [turningFinalDiaInch, setTurningFinalDiaInch] = useState<number>(1.25);
  const [turningHourlyRateMxn, setTurningHourlyRateMxnState] = useState<number>(() => readStoredRate(TURNING_RATE_STORAGE_KEY));
  const [turningChuckingSec, setTurningChuckingSec] = useState<number>(20);

  const [millingPocketLengthInch, setMillingPocketLengthInch] = useState<number>(4.0);
  const [millingPocketWidthInch, setMillingPocketWidthInch] = useState<number>(3.0);
  const [millingPocketDepthInch, setMillingPocketDepthInch] = useState<number>(0.5);
  const [millingHourlyRateMxn, setMillingHourlyRateMxnState] = useState<number>(() => readStoredRate(MILLING_RATE_STORAGE_KEY));
  const [millingFixtureSec, setMillingFixtureSec] = useState<number>(30);

  const [copiedGcode, setCopiedGcode] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);

  // ── Torneado: parámetros de corte duales imperial/métrico ──
  const [turningDiameterInch, setTurningDiameterInch] = useState<number>(1.5);
  const [turningSfm, setTurningSfm] = useState<number>(450);
  const [turningFeedIpr, setTurningFeedIpr] = useState<number>(0.008);
  const [turningApInch, setTurningApInch] = useState<number>(0.08);
  const [turningNoseRadiusInch, setTurningNoseRadiusInch] = useState<number>(0.0312);

  const [turningDiameterMm, setTurningDiameterMm] = useState<number>(38);
  const [turningVc, setTurningVc] = useState<number>(140);
  const [turningFeedMm, setTurningFeedMm] = useState<number>(0.2);
  const [turningApMm, setTurningApMm] = useState<number>(2.0);
  const [turningNoseRadiusMm, setTurningNoseRadiusMm] = useState<number>(0.8);

  // ── Fresado: estado canónico siempre en pulgadas ──
  const [millingToolDiaInch, setMillingToolDiaInch] = useState<number>(0.5);
  const [millingFlutes, setMillingFlutes] = useState<number>(4);
  const [millingSfm, setMillingSfm] = useState<number>(350);
  const [millingChipLoadInch, setMillingChipLoadInch] = useState<number>(0.003);
  const [millingApInch, setMillingApInch] = useState<number>(0.25);
  const [millingAeInch, setMillingAeInch] = useState<number>(0.125);

  const [targetRaUm, setTargetRaUm] = useState<number | null>(null);

  // ── Persistencia de tarifa horaria (MXN) en localStorage ──
  useEffect(() => {
    writeStoredRate(TURNING_RATE_STORAGE_KEY, turningHourlyRateMxn);
  }, [turningHourlyRateMxn]);

  useEffect(() => {
    writeStoredRate(MILLING_RATE_STORAGE_KEY, millingHourlyRateMxn);
  }, [millingHourlyRateMxn]);

  const setTurningHourlyRateMxn = useCallback((value: number) => {
    setTurningHourlyRateMxnState(Math.max(toFinite(value, 0), 0));
  }, []);

  const setMillingHourlyRateMxn = useCallback((value: number) => {
    setMillingHourlyRateMxnState(Math.max(toFinite(value, 0), 0));
  }, []);

  const hasTurningHourlyRate = turningHourlyRateMxn > 0;
  const hasMillingHourlyRate = millingHourlyRateMxn > 0;
  const hasHourlyRate = operationMode === 'turning' ? hasTurningHourlyRate : hasMillingHourlyRate;

  // ── Material y máquina seleccionados ──
  const selectedMaterial: MaterialSpec = useMemo(
    () => findMaterialById(selectedMaterialId) ?? MATERIAL_DATABASE[0],
    [selectedMaterialId]
  );
  const selectedMachine: HaasMachineProfile | undefined = useMemo(
    () => findHaasMachineById(selectedHaasId),
    [selectedHaasId]
  );

  const setOperationMode = useCallback((mode: OperationMode) => {
    setOperationModeState(mode);
    setSelectedHaasId(mode === 'turning' ? 'haas_st20' : 'haas_vf2');
  }, []);

  const handleMaterialChange = useCallback((matId: string) => {
    setSelectedMaterialId(matId);
    const mat = findMaterialById(matId);
    if (!mat) return;
    // Auto-ajustar velocidades recomendadas en ambos sistemas.
    const sfmTurn = mat.sfmTurning ? mat.sfmTurning[0] : Math.round(mat.vcTurningMMin[0] * MMIN_TO_SFM);
    setTurningSfm(sfmTurn);
    setTurningVc(mat.vcTurningMMin[0]);
    setTurningFeedIpr(mat.recommendedFeedTurningInch?.desbaste ?? 0.008);
    setTurningFeedMm(mat.recommendedFeedTurningMm.desbaste);

    setMillingSfm(mat.sfmMilling[0]);
    setMillingChipLoadInch(mat.recommendedChipLoadInch[0]);
    if (mat.group === 'N') {
      setMillingFlutes(3);
    } else if (mat.group === 'M') {
      setMillingFlutes(5);
    } else {
      setMillingFlutes(4);
    }
  }, []);

  // ── Presets de torneado (a partir del material activo) ──
  const turningSpeedPresetsMMin = useMemo(() => {
    const [min, max] = selectedMaterial.vcTurningMMin;
    return { min, mid: Number(((min + max) / 2).toFixed(0)), max };
  }, [selectedMaterial]);

  const turningFeedPresetsMm = useMemo(() => {
    const { acabado, desbaste } = selectedMaterial.recommendedFeedTurningMm;
    return { acabado, medio: Number(((acabado + desbaste) / 2).toFixed(3)), desbaste };
  }, [selectedMaterial]);

  const applyTurningSpeedPreset = useCallback((mMin: number) => {
    setTurningVc(mMin);
    setTurningSfm(Math.round(mMin * MMIN_TO_SFM));
  }, []);

  const applyTurningFeedPreset = useCallback((mm: number) => {
    setTurningFeedMm(mm);
    setTurningFeedIpr(Number((mm * MM_TO_INCH).toFixed(4)));
  }, []);

  // ── Setters de fresado que aceptan el valor en la unidad de despliegue métrica ──
  const millingVcMMin = useMemo(() => millingSfm * SFM_TO_MMIN, [millingSfm]);
  const setMillingVcMMin = useCallback((vc: number) => setMillingSfm(vc * MMIN_TO_SFM), []);

  const millingChipLoadMm = useMemo(() => millingChipLoadInch * INCH_TO_MM, [millingChipLoadInch]);
  const setMillingChipLoadMm = useCallback((mm: number) => setMillingChipLoadInch(mm * MM_TO_INCH), []);

  const millingApMm = useMemo(() => millingApInch * INCH_TO_MM, [millingApInch]);
  const setMillingApMm = useCallback((mm: number) => setMillingApInch(mm * MM_TO_INCH), []);

  const millingAeMm = useMemo(() => millingAeInch * INCH_TO_MM, [millingAeInch]);
  const setMillingAeMm = useCallback((mm: number) => setMillingAeInch(mm * MM_TO_INCH), []);

  // ── Magnitudes activas en mm/m·min⁻¹ según el sistema de unidades ──
  const turningActiveMm = useMemo(
    () => ({
      diameterMm: unitSystem === 'imperial' ? turningDiameterInch * INCH_TO_MM : turningDiameterMm,
      cuttingSpeedMMin: unitSystem === 'imperial' ? turningSfm * SFM_TO_MMIN : turningVc,
      feedPerRevMm: unitSystem === 'imperial' ? turningFeedIpr * INCH_TO_MM : turningFeedMm,
      depthOfCutMm: unitSystem === 'imperial' ? turningApInch * INCH_TO_MM : turningApMm,
      noseRadiusMm: unitSystem === 'imperial' ? turningNoseRadiusInch * INCH_TO_MM : turningNoseRadiusMm,
    }),
    [
      unitSystem,
      turningDiameterInch,
      turningDiameterMm,
      turningSfm,
      turningVc,
      turningFeedIpr,
      turningFeedMm,
      turningApInch,
      turningApMm,
      turningNoseRadiusInch,
      turningNoseRadiusMm,
    ]
  );

  const turningResult: SpeedsFeedsTurningResult = useMemo(
    () =>
      calculateTurningSpeedsFeeds({
        ...turningActiveMm,
        materialId: selectedMaterialId,
        haasMachineId: selectedHaasId,
      }),
    [turningActiveMm, selectedMaterialId, selectedHaasId]
  );

  const millingActiveMm = useMemo(
    () => ({
      toolDiameterMm: millingToolDiaInch * INCH_TO_MM,
      axialDepthMm: millingApInch * INCH_TO_MM,
      radialDepthMm: millingAeInch * INCH_TO_MM,
    }),
    [millingToolDiaInch, millingApInch, millingAeInch]
  );

  const millingResult: SpeedsFeedsMillingResult = useMemo(
    () =>
      calculateMillingSpeedsFeeds({
        toolDiameterInch: millingToolDiaInch,
        numberOfFlutes: millingFlutes,
        surfaceFeetPerMinute: millingSfm,
        chipLoadInch: millingChipLoadInch,
        axialDepthOfCutMm: millingActiveMm.axialDepthMm,
        radialDepthOfCutMm: millingActiveMm.radialDepthMm,
        materialId: selectedMaterialId,
        haasMachineId: selectedHaasId,
      }),
    [millingToolDiaInch, millingFlutes, millingSfm, millingChipLoadInch, millingActiveMm, selectedMaterialId, selectedHaasId]
  );

  // ── Magnitudes listas para los diagramas (siempre en mm) ──
  const turningDiagramMm = useMemo(() => {
    const { diameterMm, depthOfCutMm, feedPerRevMm, noseRadiusMm } = turningActiveMm;
    return {
      diameterMm,
      finalDiameterMm: Math.max(diameterMm - 2 * depthOfCutMm, 0),
      depthOfCutMm,
      feedMm: feedPerRevMm,
      noseRadiusMm,
    };
  }, [turningActiveMm]);

  const millingDiagramMm = useMemo(
    () => ({
      toolDiameterMm: millingActiveMm.toolDiameterMm,
      radialDepthMm: millingActiveMm.radialDepthMm,
      axialDepthMm: millingActiveMm.axialDepthMm,
    }),
    [millingActiveMm]
  );

  // ── Banda de rango recomendado (RangeBand) según operación/unidad activa ──
  const speedRangeBand: RangeBandData = useMemo(() => {
    if (operationMode === 'turning') {
      const [minMMin, maxMMin] = selectedMaterial.vcTurningMMin;
      if (unitSystem === 'imperial') {
        return {
          value: turningSfm,
          min: Math.round(minMMin * MMIN_TO_SFM),
          max: Math.round(maxMMin * MMIN_TO_SFM),
          unit: 'SFM',
        };
      }
      return { value: turningVc, min: minMMin, max: maxMMin, unit: 'm/min' };
    }
    const [minSfm, maxSfm] = selectedMaterial.sfmMilling;
    if (unitSystem === 'imperial') {
      return { value: millingSfm, min: minSfm, max: maxSfm, unit: 'SFM' };
    }
    return {
      value: Number((millingSfm * SFM_TO_MMIN).toFixed(1)),
      min: Number((minSfm * SFM_TO_MMIN).toFixed(1)),
      max: Number((maxSfm * SFM_TO_MMIN).toFixed(1)),
      unit: 'm/min',
    };
  }, [operationMode, unitSystem, selectedMaterial, turningSfm, turningVc, millingSfm]);

  // ── Tiempos de ciclo y costo (tarifa en MXN; 0 = "sin costo" en la UI) ──
  const turningCycleTime: TurningCycleTimeResult = useMemo(
    () =>
      calculateTurningCycleTime({
        cutLength: turningCutLengthInch,
        rawDiameter: turningRawDiaInch,
        finalDiameter: turningFinalDiaInch,
        depthOfCutAp: turningApInch,
        feedPerRev: turningFeedIpr,
        rpm: turningResult.rpm,
        hourlyRate: Math.max(turningHourlyRateMxn, 0),
        partHandlingSec: turningChuckingSec,
        toolChanges: 1,
      }),
    [
      turningCutLengthInch,
      turningRawDiaInch,
      turningFinalDiaInch,
      turningApInch,
      turningFeedIpr,
      turningResult.rpm,
      turningHourlyRateMxn,
      turningChuckingSec,
    ]
  );

  const millingCycleTime: MillingCycleTimeResult = useMemo(() => {
    const volumeIn3 = millingPocketLengthInch * millingPocketWidthInch * millingPocketDepthInch;
    return calculateMillingCycleTime({
      materialVolumeToRemove: volumeIn3,
      mrr: millingResult.mrrIn3Min,
      hourlyRate: Math.max(millingHourlyRateMxn, 0),
      partHandlingSec: millingFixtureSec,
      toolChanges: 1,
      toolChangeSec: selectedMachine?.toolChangeSec,
    });
  }, [
    millingPocketLengthInch,
    millingPocketWidthInch,
    millingPocketDepthInch,
    millingResult.mrrIn3Min,
    millingHourlyRateMxn,
    millingFixtureSec,
    selectedMachine,
  ]);

  // ── G-Code de referencia Haas ──
  const haasGcode = useMemo(() => {
    if (operationMode === 'turning') {
      return generateHaasTurningGcode({
        programNumber: 1001,
        partName: selectedMaterial.name.replace(/\s+/g, '_').toUpperCase(),
        maxRpm: selectedMachine?.maxRpm ?? Math.min(turningResult.rpm + 500, 4000),
        sfm: turningSfm,
        feedIpr: turningFeedIpr,
        apInch: turningApInch,
        rawDiaInch: turningRawDiaInch,
        finalDiaInch: turningFinalDiaInch,
        cutLengthInch: turningCutLengthInch,
      });
    }
    return generateHaasMillingGcode({
      programNumber: 2001,
      partName: selectedMaterial.name.replace(/\s+/g, '_').toUpperCase(),
      rpm: millingResult.rpm,
      feedIpm: millingResult.tableFeedIpm,
      toolNumber: 1,
      toolDesc: `${millingToolDiaInch}" ${millingFlutes}F ENDMILL`,
    });
  }, [
    operationMode,
    selectedMaterial.name,
    selectedMachine,
    turningResult.rpm,
    turningSfm,
    turningFeedIpr,
    turningApInch,
    turningRawDiaInch,
    turningFinalDiaInch,
    turningCutLengthInch,
    millingResult.rpm,
    millingResult.tableFeedIpm,
    millingToolDiaInch,
    millingFlutes,
  ]);

  const handleCopyGcode = useCallback(() => {
    void navigator.clipboard.writeText(haasGcode);
    setCopiedGcode(true);
    setTimeout(() => setCopiedGcode(false), 2000);
  }, [haasGcode]);

  const handleCopySummary = useCallback(() => {
    const activeHasRate = operationMode === 'turning' ? hasTurningHourlyRate : hasMillingHourlyRate;
    const summary =
      operationMode === 'turning'
        ? `=== FICHA DE TORNEADO HAAS ST ===\nMaterial: ${selectedMaterial.name}\nMáquina: ${selectedMachine?.name ?? selectedHaasId}\nRPM: ${turningResult.rpm}\nSFM: ${turningSfm}\nAvance: ${turningFeedIpr}"/rev (${turningResult.feedRateIpm} IPM)\nProfundidad ap: ${turningApInch}"\nPotencia: ${turningResult.motorPowerHpRequired} HP\nRugosidad Ra: ${turningResult.theoreticalSurfaceRoughnessRaUin} µin\nTiempo de Ciclo: ${turningCycleTime.formattedCycleTime}\nPiezas/Turno (8h 85% OEE): ${turningCycleTime.partsPer8hShift}\nCosto Estimado: ${activeHasRate ? formatMxn(turningCycleTime.machiningCostPerPart) : '— (sin tarifa capturada)'}`
        : `=== FICHA DE FRESADO HAAS VF ===\nMaterial: ${selectedMaterial.name}\nMáquina: ${selectedMachine?.name ?? selectedHaasId}\nHerramienta: ${millingToolDiaInch}" (${millingFlutes}F)\nRPM: ${millingResult.rpm}\nSFM: ${millingSfm}\nChip Load: ${millingChipLoadInch}"/diente\nAvance: ${millingResult.tableFeedIpm} IPM\nMRR: ${millingResult.mrrIn3Min} in³/min\nPotencia: ${millingResult.motorPowerHpRequired} HP\nTiempo de Ciclo: ${millingCycleTime.formattedCycleTime}\nPiezas/Turno (8h 85% OEE): ${millingCycleTime.partsPer8hShift}\nCosto Estimado: ${activeHasRate ? formatMxn(millingCycleTime.machiningCostPerPart) : '— (sin tarifa capturada)'}`;
    void navigator.clipboard.writeText(summary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  }, [
    operationMode,
    hasTurningHourlyRate,
    hasMillingHourlyRate,
    selectedMaterial.name,
    selectedMachine,
    selectedHaasId,
    turningResult,
    turningSfm,
    turningFeedIpr,
    turningApInch,
    turningCycleTime,
    millingToolDiaInch,
    millingFlutes,
    millingResult,
    millingSfm,
    millingChipLoadInch,
    millingCycleTime,
  ]);

  return {
    // unidades y modo de operación
    unitSystem,
    setUnitSystem,
    operationMode,
    setOperationMode,

    // material y máquina
    selectedMaterialId,
    selectedMaterial,
    handleMaterialChange,
    selectedHaasId,
    setSelectedHaasId,
    selectedMachine,

    // torneado: parámetros de corte duales
    turningDiameterInch,
    setTurningDiameterInch,
    turningDiameterMm,
    setTurningDiameterMm,
    turningSfm,
    setTurningSfm,
    turningVc,
    setTurningVc,
    turningFeedIpr,
    setTurningFeedIpr,
    turningFeedMm,
    setTurningFeedMm,
    turningApInch,
    setTurningApInch,
    turningApMm,
    setTurningApMm,
    turningNoseRadiusInch,
    setTurningNoseRadiusInch,
    turningNoseRadiusMm,
    setTurningNoseRadiusMm,
    turningSpeedPresetsMMin,
    turningFeedPresetsMm,
    applyTurningSpeedPreset,
    applyTurningFeedPreset,

    // fresado: parámetros de corte (canónico en pulgadas + display métrico)
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

    // geometría, tiempos y tarifas
    turningCutLengthInch,
    setTurningCutLengthInch,
    turningRawDiaInch,
    setTurningRawDiaInch,
    turningFinalDiaInch,
    setTurningFinalDiaInch,
    turningChuckingSec,
    setTurningChuckingSec,
    turningHourlyRateMxn,
    setTurningHourlyRateMxn,
    hasTurningHourlyRate,

    millingPocketLengthInch,
    setMillingPocketLengthInch,
    millingPocketWidthInch,
    setMillingPocketWidthInch,
    millingPocketDepthInch,
    setMillingPocketDepthInch,
    millingFixtureSec,
    setMillingFixtureSec,
    millingHourlyRateMxn,
    setMillingHourlyRateMxn,
    hasMillingHourlyRate,

    hasHourlyRate,

    // resultados de motor de cálculo
    turningResult,
    millingResult,
    turningCycleTime,
    millingCycleTime,

    // magnitudes listas para diagramas/bandas
    turningDiagramMm,
    millingDiagramMm,
    speedRangeBand,

    // rugosidad objetivo del plano
    targetRaUm,
    setTargetRaUm,

    // g-code y portapapeles
    haasGcode,
    copiedGcode,
    copiedSummary,
    handleCopyGcode,
    handleCopySummary,
  };
}

export type SpeedsFeedsState = ReturnType<typeof useSpeedsFeedsState>;
