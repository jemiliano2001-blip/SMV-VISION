import type { DecodedThreadInsert, ThreadHand, ThreadProfileFamily, ThreadSide } from './types';

/**
 * Decodifica designaciones de insertos de ROSCAR en estándar métrico e imperial (ANSI).
 * Soportando códigos ISO (ej. 16ER 1.5 ISO, 16IR AG60, 22ER 14NPT) y códigos ANSI
 * en octavos de pulgada (ej. 3ER 14UN, 3IR AG60, 2ER 20UN, 4ER 8ACME).
 *
 *   [Tamaño 1 ó 2 dígitos][E/I][R/L][Paso o TPI][Familia de perfil]
 *   16 (o 3)               E    R    14          UN
 */

interface SizeInfo {
  sizeCode: string;
  ansiSizeCode: string;
  inscribedCircleInch: string;
  minBarOrHoleMm: number;
  minBarOrHoleInch: string;
  label: string;
}

const SIZE_TABLE: Record<string, SizeInfo> = {
  '06': {
    sizeCode: '06',
    ansiSizeCode: '1',
    inscribedCircleInch: '5/32" (0.156")',
    minBarOrHoleMm: 8,
    minBarOrHoleInch: '0.312" (5/16")',
    label: '06 (IC 5/32") — Barra mín. Ø5/16" (~8mm). Micro-roscas.',
  },
  '08': {
    sizeCode: '08',
    ansiSizeCode: '1.5',
    inscribedCircleInch: '3/16" (0.187")',
    minBarOrHoleMm: 10,
    minBarOrHoleInch: '0.394" (~3/8")',
    label: '08 (IC 3/16") — Barra mín. Ø3/8" (~10mm). Roscas pequeñas M3-M8.',
  },
  '11': {
    sizeCode: '11',
    ansiSizeCode: '2',
    inscribedCircleInch: '1/4" (0.250")',
    minBarOrHoleMm: 12,
    minBarOrHoleInch: '0.472" (~1/2")',
    label: '11 / ANSI 2 (IC 1/4") — Barra mín. Ø1/2" (~12mm). Roscas M6-M14 o 1/4"-1/2".',
  },
  '16': {
    sizeCode: '16',
    ansiSizeCode: '3',
    inscribedCircleInch: '3/8" (0.375")',
    minBarOrHoleMm: 20,
    minBarOrHoleInch: '0.787" (~3/4" a 1")',
    label: '16 / ANSI 3 (IC 3/8") — El tamaño estándar universal de taller (M10-M24, 3/8"-1").',
  },
  '22': {
    sizeCode: '22',
    ansiSizeCode: '4',
    inscribedCircleInch: '1/2" (0.500")',
    minBarOrHoleMm: 25,
    minBarOrHoleInch: '1.000" (1")',
    label: '22 / ANSI 4 (IC 1/2") — Barra mín. Ø1" (~25mm). Roscas grandes 1"+ y pasos gruesos.',
  },
  '27': {
    sizeCode: '27',
    ansiSizeCode: '5',
    inscribedCircleInch: '5/8" (0.625")',
    minBarOrHoleMm: 32,
    minBarOrHoleInch: '1.250" (1-1/4")',
    label: '27 / ANSI 5 (IC 5/8") — Barra mín. Ø1-1/4" (~32mm). Pasos pesados, ACME grande y tubería petrolera.',
  },
};

// Mapeo inverso para soportar designaciones ANSI de 1 solo dígito (octavos de pulgada: 2, 3, 4, 5)
const ANSI_TO_ISO_SIZE: Record<string, string> = {
  '1': '06',
  '2': '11',
  '3': '16',
  '4': '22',
  '5': '27',
};

const SIDE_MAP: Record<string, ThreadSide> = { E: 'external', I: 'internal' };
const HAND_MAP: Record<string, ThreadHand> = { R: 'right', L: 'left' };

const PARTIAL_PROFILES: Record<string, {
  family: ThreadProfileFamily;
  label: string;
  tpiRange: string;
  pitchMmRange: string;
  note: string;
}> = {
  A60: {
    family: 'UN_60',
    label: 'Perfil Parcial 60° Fino (A60: 48 - 16 TPI)',
    tpiRange: '48 - 16 TPI',
    pitchMmRange: '0.5 - 1.5 mm',
    note: 'Paso fino 60° (UN/Métrica). Ideal para roscas finas como 10-32 UNF, 1/4-28 UNF, M4-M8. No forma la cresta: el diámetro exterior o barreno debe estar a medida nominal.',
  },
  AG60: {
    family: 'UN_60',
    label: 'Perfil Parcial 60° Universal (AG60: 48 - 8 TPI)',
    tpiRange: '48 - 8 TPI',
    pitchMmRange: '0.5 - 3.0 mm',
    note: 'El inserto universal más popular de taller: cubre desde 48 hasta 8 TPI (0.5 a 3.0 mm). No forma la cresta: prepara el diámetro exterior de la barra o barreno a medida final antes de roscar.',
  },
  G60: {
    family: 'UN_60',
    label: 'Perfil Parcial 60° Grueso (G60: 14 - 8 TPI)',
    tpiRange: '14 - 8 TPI',
    pitchMmRange: '1.75 - 3.0 mm',
    note: 'Paso grueso 60° reforzado para roscas de alta carga (ej. 1/2-13 UNC, 3/4-10 UNC, 1"-8 UNC). Punta más robusta para resistir mayor fuerza de corte.',
  },
  N60: {
    family: 'UN_60',
    label: 'Perfil Parcial 60° Extra Grueso (N60: 7 - 5 TPI)',
    tpiRange: '7 - 5 TPI',
    pitchMmRange: '3.5 - 5.0 mm',
    note: 'Roscas 60° de gran escala y pasos pesados (7 a 5 TPI).',
  },
  A55: {
    family: 'WHITWORTH_55',
    label: 'Perfil Parcial 55° Fino (A55: 48 - 16 TPI)',
    tpiRange: '48 - 16 TPI',
    pitchMmRange: '0.5 - 1.5 mm',
    note: 'Perfil Whitworth 55° fino para roscas de tubería BSPP/BSPT pequeñas.',
  },
  AG55: {
    family: 'WHITWORTH_55',
    label: 'Perfil Parcial 55° Universal (AG55: 48 - 8 TPI)',
    tpiRange: '48 - 8 TPI',
    pitchMmRange: '0.5 - 3.0 mm',
    note: 'Cubre 48 a 8 hilos por pulgada en perfil Whitworth 55°. Usado en roscas de tubería BSPT (cónica) y BSPP (paralela).',
  },
  G55: {
    family: 'WHITWORTH_55',
    label: 'Perfil Parcial 55° Grueso (G55: 14 - 8 TPI)',
    tpiRange: '14 - 8 TPI',
    pitchMmRange: '1.75 - 3.0 mm',
    note: 'Paso grueso Whitworth 55° para tubería mediana y pesada.',
  },
  APT: {
    family: 'ACME_29',
    label: 'Perfil Parcial ACME 29° / Trapecial (APT)',
    tpiRange: '16 - 4 TPI',
    pitchMmRange: '1.5 - 6.0 mm',
    note: 'Cubre pasos ACME (29°) y trapeciales. Usado en husillos de potencia y tornillos de avance de máquinas herramienta.',
  },
};

const FULL_PROFILE_FAMILY: Record<string, { family: ThreadProfileFamily; label: string; unitSystem: 'inch' | 'metric'; note?: string }> = {
  ISO: { family: 'ISO_METRIC_60', label: 'ISO Métrica 60° (perfil completo)', unitSystem: 'metric' },
  MJ: { family: 'ISO_METRIC_60', label: 'ISO Métrica MJ 60° (raíz redondeada aeroespacial)', unitSystem: 'metric' },
  UN: { family: 'UN_60', label: 'Unificada UN/UNC/UNF 60° (perfil completo en pulgadas)', unitSystem: 'inch' },
  UNC: { family: 'UN_60', label: 'Unificada UNC 60° Gruesa (perfil completo)', unitSystem: 'inch' },
  UNF: { family: 'UN_60', label: 'Unificada UNF 60° Fina (perfil completo)', unitSystem: 'inch' },
  UNEF: { family: 'UN_60', label: 'Unificada UNEF 60° Extra Fina (perfil completo)', unitSystem: 'inch' },
  UNJ: { family: 'UNJ_60', label: 'Aeroespacial UNJ/UNJC/UNJF 60° (raíz controlada anti-fatiga MIL-S-8879)', unitSystem: 'inch', note: 'Radio de raíz controlado (0.15011P a 0.18042P) para máxima resistencia a la fatiga cíclica en componentes aeroespaciales y automotrices críticos.' },
  NPT: { family: 'NPT_60', label: 'NPT Tubería Cónica Americana 1:16 60° (perfil completo)', unitSystem: 'inch', note: 'Perfil completo para tubería estándar americana. Conicidad 1:16 (0.75 in/ft). Sella herméticamente por interferencia mecánica.' },
  NPTF: { family: 'NPTF_60', label: 'NPTF Dryseal Tubería Cónica 60° (sin cinta teflón)', unitSystem: 'inch', note: 'Diseñado para aplastar crestas y raíces durante el apriete para sellar fluidos sin necesidad de sellador líquido o teflón.' },
  BSPT: { family: 'WHITWORTH_55', label: 'BSPT Británica Cónica de Tubería 1:16 55° (perfil completo)', unitSystem: 'inch' },
  BSPP: { family: 'WHITWORTH_55', label: 'BSPP (G) Británica Paralela de Tubería 55° (perfil completo)', unitSystem: 'inch' },
  BSW: { family: 'WHITWORTH_55', label: 'Whitworth BSW 55° (perfil completo)', unitSystem: 'inch' },
  ACME: { family: 'ACME_29', label: 'ACME 29° General (perfil completo)', unitSystem: 'inch', note: 'Tornillos de avance, prensas y husillos de fuerza.' },
  STUBACME: { family: 'STUB_ACME_29', label: 'Stub ACME 29° (altura de filete reducida)', unitSystem: 'inch', note: 'Altura de rosca más baja para paredes delgadas y tubos.' },
  TR: { family: 'TRAPEZOIDAL_30', label: 'Trapecial Métrica 30° DIN 103 (perfil completo)', unitSystem: 'metric' },
};

function holderSuggestionFor(side: ThreadSide, sizeCode: string, ansiCode: string): string {
  if (side === 'external') {
    return `Porta Exterior SER/SEL ${sizeCode}-XX (Zanco 1" o 3/4" Haas ST) · ANSI: SER/SEL ${ansiCode}`;
  }
  return `Barra de Roscar Interior S..-SIR/SIL ${sizeCode}-XX (diámetro ≥ barreno mínimo) · ANSI: SIR ${ansiCode}`;
}

/**
 * Decodifica un código de inserto de rosca (soporta 16ER, 16IR, 3ER, 3IR, 22ER, 4ER, etc.).
 * Devuelve null si no coincide con ninguna designación válida.
 */
export function decodeThreadInsertCode(rawInput: string): DecodedThreadInsert | null {
  if (!rawInput) return null;
  const clean = rawInput.trim().toUpperCase().replace(/[\s_]+/g, '').replace(/-/g, '');
  
  // Soporta 1 dígito (ANSI ej. 3ER) o 2 dígitos (ISO ej. 16ER)
  const match = clean.match(/^(\d{1,2})([EI])([RL])(.+)$/);
  if (!match) return null;

  const [, rawDigits, sideChar, handChar, rest] = match;

  // Resolver código ISO normalizado (ej. si entra '3', se mapea a '16')
  const resolvedIsoCode = rawDigits.length === 1 ? ANSI_TO_ISO_SIZE[rawDigits] : rawDigits;
  if (!resolvedIsoCode) return null;

  const sizeInfo = SIZE_TABLE[resolvedIsoCode];
  if (!sizeInfo) return null;

  const side = SIDE_MAP[sideChar];
  const hand = HAND_MAP[handChar];
  const ansiFullCode = `${sizeInfo.ansiSizeCode}${sideChar}${handChar}`;

  // 1. ¿Es perfil parcial? (ej. AG60, A60, G60, N60, A55, AG55, APT)
  const partial = PARTIAL_PROFILES[rest];
  if (partial) {
    return {
      rawCode: rawInput,
      sizeCode: sizeInfo.sizeCode,
      ansiSizeCode: ansiFullCode,
      sizeLabel: sizeInfo.label,
      inscribedCircleInch: sizeInfo.inscribedCircleInch,
      minBarOrHoleMm: sizeInfo.minBarOrHoleMm,
      minBarOrHoleInch: sizeInfo.minBarOrHoleInch,
      side,
      hand,
      profileFamily: partial.family,
      profileLabel: partial.label,
      isFullProfile: false,
      unitSystem: 'inch', // En taller Haas siempre se programa el paso/TPI en pulgadas por defecto
      tpiRange: partial.tpiRange,
      pitchMmRange: partial.pitchMmRange,
      fullProfileNote: partial.note,
      holderSuggestion: holderSuggestionFor(side, sizeInfo.sizeCode, sizeInfo.ansiSizeCode),
    };
  }

  // 2. ¿Es perfil completo? (ej. "20UN", "14UN", "1.5ISO", "18NPT", "8ACME", "16UNJ", "11.5NPT")
  const fullMatch = rest.match(/^(\d+(?:\.\d+)?)(ISO|MJ|UNEF|UNJ|UNC|UNF|UN|NPTF|NPT|BSPT|BSPP|BSW|STUBACME|ACME|TR)$/);
  if (!fullMatch) return null;

  const [, numericStr, profileKey] = fullMatch;
  const profileInfo = FULL_PROFILE_FAMILY[profileKey];
  if (!profileInfo) return null;

  const numericValue = Number.parseFloat(numericStr);
  const isInchFamily = profileInfo.unitSystem === 'inch';

  return {
    rawCode: rawInput,
    sizeCode: sizeInfo.sizeCode,
    ansiSizeCode: ansiFullCode,
    sizeLabel: sizeInfo.label,
    inscribedCircleInch: sizeInfo.inscribedCircleInch,
    minBarOrHoleMm: sizeInfo.minBarOrHoleMm,
    minBarOrHoleInch: sizeInfo.minBarOrHoleInch,
    side,
    hand,
    profileFamily: profileInfo.family,
    profileLabel: profileInfo.label,
    isFullProfile: true,
    unitSystem: profileInfo.unitSystem,
    pitchMm: isInchFamily ? undefined : numericValue,
    tpi: isInchFamily ? numericValue : undefined,
    fullProfileNote: profileInfo.note || 'Este inserto corta este paso/TPI exacto formando raíz y cresta completa a especificación.',
    holderSuggestion: holderSuggestionFor(side, sizeInfo.sizeCode, sizeInfo.ansiSizeCode),
  };
}
