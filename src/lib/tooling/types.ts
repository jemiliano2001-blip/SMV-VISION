/**
 * Tipos y contratos para el módulo de Herramental CNC y Cálculo Técnico.
 */

export type IsoMaterialGroup = 'P' | 'M' | 'K' | 'N' | 'S' | 'H';

export interface MaterialSpec {
  id: string;
  name: string;
  category: string;
  group: IsoMaterialGroup;
  description: string;
  /** Velocidad de corte recomendada en torneado con carburo (m/min) [min, max] */
  vcTurningMMin: [number, number];
  /** Velocidad de corte recomendada en fresado con carburo (SFM) [min, max] */
  sfmMilling: [number, number];
  /** Velocidad de corte recomendada en torneado con carburo (SFM) [min, max] */
  sfmTurning?: [number, number];
  /** Fuerza de corte específica Kc (N/mm²) para cálculo de potencia */
  kc: number;
  /** Chip load recomendado para endmill de 1/2" en fresado (pulgadas / diente) [min, max] */
  recommendedChipLoadInch: [number, number];
  /** Avance recomendado en torneado (mm/rev) */
  recommendedFeedTurningMm: { desbaste: number; acabado: number };
  /** Avance recomendado en torneado (pulgadas/rev - IPR) */
  recommendedFeedTurningInch?: { desbaste: number; acabado: number };
  hardnessTypical: string;
  chipCharacteristics: string;
}

export type HaasMachineType = 'mill' | 'lathe';

export interface HaasMachineProfile {
  id: string;
  name: string;
  type: HaasMachineType;
  description: string;
  maxRpm: number;
  horsepower: number;
  kw: number;
  maxTorqueNm?: number;
  taperOrSpindle: string; // ej. 'CAT40', 'A2-6'
  chuckOrTableSize?: string;
  barCapacityInch?: number;
  notes: string;
}

export interface SpeedsFeedsTurningInput {
  diameterMm: number;
  cuttingSpeedMMin: number; // Vc
  feedPerRevMm: number; // fn
  depthOfCutMm: number; // ap
  noseRadiusMm: number; // r (ej. 0.8, 0.4)
  materialId: string;
  haasMachineId?: string;
}

export interface SpeedsFeedsTurningResult {
  rpm: number;
  surfaceSpeedMMin: number;
  surfaceSpeedSfm: number;
  feedRateMmMin: number;
  feedRateIpm: number;
  mrrCm3Min: number;
  mrrIn3Min: number;
  netPowerKw: number;
  netPowerHp: number;
  motorPowerHpRequired: number; // con 80% eficiencia
  theoreticalSurfaceRoughnessRaUm: number; // Ra en micrómetros
  theoreticalSurfaceRoughnessRaUin: number; // Ra en micro-pulgadas (µin)
  theoreticalSurfaceRoughnessRzUm: number; // Rz aprox 4 * Ra
  warnings: string[];
  tips: string[];
}

export interface SpeedsFeedsMillingInput {
  toolDiameterInch: number;
  numberOfFlutes: number; // Z
  surfaceFeetPerMinute: number; // SFM
  chipLoadInch: number; // fz (FPT)
  axialDepthOfCutMm: number; // ap (DOC)
  radialDepthOfCutMm: number; // ae (WOC / Stepover)
  materialId: string;
  haasMachineId?: string;
}

export interface SpeedsFeedsMillingResult {
  rpm: number;
  tableFeedIpm: number;
  tableFeedMmMin: number;
  effectiveChipLoadInch: number;
  radialChipThinningFactor: number; // RCTF
  adjustedFeedIpm: number;
  mrrCm3Min: number;
  mrrIn3Min: number;
  netPowerKw: number;
  netPowerHp: number;
  motorPowerHpRequired: number;
  warnings: string[];
  tips: string[];
}

// ─── ISO 1832 Decodificador ──────────────────────────────────────────────────

export type InsertShapeCode = 'C' | 'D' | 'W' | 'T' | 'S' | 'R' | 'V' | 'A' | 'K';
export type InsertClearanceCode = 'N' | 'C' | 'P' | 'B' | 'D' | 'E' | 'F' | 'G' | 'O';
export type InsertToleranceCode = 'M' | 'G' | 'E' | 'C' | 'A' | 'F' | 'H' | 'J' | 'K' | 'L' | 'U';
export type InsertFixingCode = 'G' | 'M' | 'T' | 'W' | 'N' | 'R' | 'X' | 'A' | 'F';

export interface DecodedInsert {
  rawCode: string;
  normalizedCode: string;
  shape: {
    letter: InsertShapeCode;
    name: string;
    angleDegrees: number;
    description: string;
    cuttingEdges: number;
  };
  clearance: {
    letter: InsertClearanceCode;
    angleDegrees: number;
    type: 'negative' | 'positive';
    description: string;
  };
  tolerance: {
    letter: InsertToleranceCode;
    description: string;
  };
  fixing: {
    letter: InsertFixingCode;
    description: string;
    hole: boolean;
    countersinkAngle?: string;
  };
  size: {
    code: string;
    cuttingEdgeLengthMm: number;
    inscribedCircleMm: number;
    inscribedCircleInch: string;
    /** true: derivado de la fórmula ANSI de 3 dígitos (exacto). false: heurística por rango — confirmar con el proveedor. */
    isEstimate: boolean;
  };
  thickness: {
    code: string;
    thicknessMm: number;
    thicknessInch: string;
    isEstimate: boolean;
  };
  noseRadius: {
    code: string;
    radiusMm: number;
    radiusInch: string;
    idealFinish: string;
    isEstimate: boolean;
  };
  chipbreaker?: string;
  recommendedOperations: string[];
  compatibleHolders: string[];
  svgPoints: { x: number; y: number }[];
}

// ─── Endmill Guide Types ─────────────────────────────────────────────────────

export type EndmillFluteCount = 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type EndmillTipGeometry = 'square' | 'corner_radius' | 'ball_nose' | 'roughing_corncob' | 'chamfer' | 'thread_mill';
export type EndmillCoating = 'altin' | 'naco' | 'zrn' | 'dlc' | 'tisin' | 'uncoated';

export interface EndmillRecommendation {
  materialGroup: IsoMaterialGroup;
  idealFlutes: EndmillFluteCount[];
  idealCoating: EndmillCoating;
  coatingName: string;
  tipGeometry: EndmillTipGeometry;
  helixAngle: string;
  reasons: string[];
  topBrands: string[];
}

// ─── Carbide Grade Cross-Reference ──────────────────────────────────────────

export interface CarbideGradeEntry {
  isoGroup: IsoMaterialGroup;
  subGroup: string; // ej. 'P25', 'M20'
  application: string;
  sandvik: string;
  kennametal: string;
  iscar: string;
  korloy: string;
  haasTooling: string;
  mitsubishi: string;
  walter: string;
  kyocera: string;
  seco: string;
  yg1: string;
}

// ─── Bóveda de Herramental en Firestore ─────────────────────────────────────

export type ToolingCategory =
  | 'inserto_torneado'
  | 'inserto_fresado'
  | 'inserto_roscado'
  | 'inserto_ranurado'
  | 'endmill'
  | 'porta_torno'
  | 'cono_fresadora'
  | 'boquilla_collet'
  | 'broca'
  | 'machuelo'
  | 'refaccion_torx';

export interface ToolingPurchaseItem {
  id: string;
  codigoISO: string;
  descripcion: string;
  categoria: ToolingCategory;
  marca: string;
  grado?: string;
  rompevirutas?: string;
  materialISO?: IsoMaterialGroup | 'Universal';
  proveedor: string;
  precioUnitario: number;
  precioCaja?: number;
  moneda: 'MXN' | 'USD';
  linkCompra: string;
  maquinaAsignada?: string; // ej. 'Haas VF-2', 'Haas ST-20'
  calificacion?: number; // 1-5 estrellas
  rendimientoNotas?: string;
  stockActual?: number;
  stockMinimo?: number;
  createdAtUTC: string | null;
  updatedAtUTC: string | null;
}

// ─── Blueprint Tooling Advisor ──────────────────────────────────────────────

export interface RecommendedTool {
  role: 'desbaste_exterior' | 'acabado_exterior' | 'mandrinado_interior' | 'ranurado' | 'roscado' | 'desbaste_fresado' | 'acabado_fresado' | 'barrenado' | 'machuelado';
  roleLabel: string;
  toolType: string;
  codeSuggestion: string;
  gradeSuggestion: string;
  holderSuggestion: string;
  speedsFeedsSuggestion: {
    rpm: number;
    feed: string;
    depthOfCut: string;
    cuttingSpeed: string;
  };
  inVaultMatch?: ToolingPurchaseItem | null;
  searchUrl: string;
  notes: string;
}

export interface BlueprintToolingPackage {
  blueprintName: string;
  detectedMaterial: string;
  isoGroup: IsoMaterialGroup;
  hardness: string;
  operations: string[];
  latheTools: RecommendedTool[];
  millTools: RecommendedTool[];
  haasSetupAdvice: string[];
}

// ─── Roscado: Insertos de Rosca, Cálculo y Machuelos ────────────────────────

export type ThreadSide = 'external' | 'internal';
export type ThreadHand = 'right' | 'left';
export type ThreadUnitSystem = 'metric' | 'inch';

export type ThreadProfileFamily =
  | 'ISO_METRIC_60'
  | 'UN_60'
  | 'WHITWORTH_55'
  | 'NPT_60'
  | 'NPTF_60'
  | 'ACME_29'
  | 'STUB_ACME_29'
  | 'TRAPEZOIDAL_30'
  | 'UNJ_60';

export interface DecodedThreadInsert {
  rawCode: string;
  sizeCode: string;
  ansiSizeCode?: string;
  sizeLabel: string;
  inscribedCircleInch?: string;
  minBarOrHoleMm: number;
  minBarOrHoleInch?: string;
  side: ThreadSide;
  hand: ThreadHand;
  profileFamily: ThreadProfileFamily;
  profileLabel: string;
  isFullProfile: boolean;
  unitSystem: ThreadUnitSystem;
  pitchMm?: number;
  tpi?: number;
  tpiRange?: string;
  pitchMmRange?: string;
  fullProfileNote: string;
  holderSuggestion: string;
}

export interface ThreadShimRecommendation {
  leadAngleDegrees: number;
  recommendedShimAngle: number;
  shimCodeCarmexOrVardex: string;
  reason: string;
}

export interface ThreadDepthResult {
  unitSystem: ThreadUnitSystem;
  pitchMm: number;
  tpi?: number;
  majorDiameterMm?: number;
  majorDiameterInch?: number;
  /** Altura de filete a cortar (radio) para rosca exterior, en mm y pulgadas. */
  depthExternalMm: number;
  depthExternalInch: number;
  /** Altura de filete a cortar (radio) para rosca interior, en mm y pulgadas. */
  depthInternalMm: number;
  depthInternalInch: number;
  pitchDiameterOffsetMm: number;
  minorDiameterOffsetMm: number;
  leadAngleDegrees: number;
  shimRecommendation: ThreadShimRecommendation;
  suggestedPasses: number;
  infeedSchedulePercent: number[];
  infeedScheduleMm: number[];
  infeedScheduleInch: number[];
  infeedMethod: 'radial' | 'flanco_modificado_29_30' | 'alternado';
  warnings: string[];
  tips: string[];
}

export interface HaasG76Params {
  isExternal: boolean;
  majorDiameterMm: number;
  pitchMm: number;
  depthMm: number;
  finishingPasses: number;
  chamferCode: number;
  tipAngleDegrees: number;
  minDepthPerPassMm: number;
  finishAllowanceMm: number;
  firstPassDepthMm: number;
  startZMm: number;
  endZMm: number;
  format?: 'haas_single' | 'fanuc_two_line';
  unitSystem?: 'inch' | 'metric';
  tpi?: number;
  majorDiameterInch?: number;
  depthInch?: number;
  firstPassDepthInch?: number;
  minDepthPerPassInch?: number;
  finishAllowanceInch?: number;
  startZInch?: number;
  endZInch?: number;
}

export interface TapDrillEntry {
  designation: string;
  unitSystem: ThreadUnitSystem;
  majorDiameterMm: number;
  majorDiameterInch?: number;
  pitchMm: number;
  tpi?: number;
  cutTapDrillMm: number;
  cutTapDrillLabel: string;
  cutTapDrillInchDecimal?: number;
  cutTapDrillFraction?: string;
  rollTapDrillMm: number;
  rollTapDrillLabel: string;
  rollTapDrillInchDecimal?: number;
  rollTapDrillFraction?: string;
  taperReamerRequired?: boolean;
  pipeNotes?: string;
}

// ─── Insertos de Ranurado y Tronzado ────────────────────────────────────────

export type GrooveStyle = 'parting_grooving' | 'full_radius' | 'polished_aluminum';

export interface DecodedGrooveInsert {
  rawCode: string;
  series: 'MGMN' | 'MRMN' | 'MGGN' | 'GTN' | 'GFN' | 'OTHER';
  widthMm: number;
  widthInch: number;
  widthFraction: string;
  cornerNoseRadiusMm: number;
  cornerNoseRadiusInch: string;
  style: GrooveStyle;
  styleLabel: string;
  maxDepthCutMm?: number;
  maxDepthCutInch?: string;
  recommendedFeedIpr: string;
  chipbreaker?: string;
  compatibleHolders: string[];
}
