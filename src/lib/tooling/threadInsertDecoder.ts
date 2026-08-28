import type { DecodedThreadInsert, ThreadHand, ThreadProfileFamily, ThreadSide } from './types';

/**
 * Decodifica designaciones de insertos de ROSCAR (ej. 16ER 1.5 ISO, 16IR AG60, 22ER 1.5 ISO,
 * 11ER 20UN). Esta es una familia de designación completamente distinta a ISO 1832 (la que
 * usan los insertos de torneado/fresado en isoInsertDecoder.ts) — por eso antes esos códigos
 * se decodificaban mal: isoInsertDecoder intentaba leerlos como CNMG/WNMG y producía datos
 * inventados. Aquí se decodifica con las reglas reales de insertos de rosca:
 *
 *   [Tamaño 2 dígitos][E/I][R/L][Paso o TPI][Familia de perfil]
 *   16          E      R    1.5    ISO
 *
 * Perfil completo (ISO/UN/MJ): un paso fijo por inserto — la cresta queda exacta pero el
 * inserto solo sirve para ESE paso.
 * Perfil parcial (AG60/A55/APT): una sola punta cubre un RANGO de pasos, pero el diámetro
 * exterior de la pieza debe llegar ya a medida del torno (el inserto no forma la cresta).
 */

const SIZE_TABLE: Record<string, { minBarOrHoleMm: number; label: string }> = {
  '08': { minBarOrHoleMm: 10, label: '08 — Barra/barreno mínimo ~10mm. Roscas pequeñas M3-M8.' },
  '11': { minBarOrHoleMm: 12, label: '11 — Barra/barreno mínimo ~12-16mm. Roscas M6-M14.' },
  '16': { minBarOrHoleMm: 20, label: '16 — Barra/barreno mínimo ~20mm. El tamaño más común en taller (M10-M24, 3/8"-1").' },
  '22': { minBarOrHoleMm: 25, label: '22 — Barra/barreno mínimo ~25-32mm. Roscas grandes M20+.' },
  '27': { minBarOrHoleMm: 32, label: '27 — Barra/barreno mínimo ~32mm+. Roscas de gran diámetro.' },
};

const SIDE_MAP: Record<string, ThreadSide> = { E: 'external', I: 'internal' };
const HAND_MAP: Record<string, ThreadHand> = { R: 'right', L: 'left' };

const PARTIAL_PROFILES: Record<string, { family: ThreadProfileFamily; label: string; note: string }> = {
  AG60: {
    family: 'UN_60',
    label: 'Perfil Parcial 60° (ISO Métrica / UN)',
    note: 'Una sola punta corta múltiples pasos (típicamente 0.5mm a 3.5mm según el tamaño de inserto). No forma la cresta: el diámetro exterior (rosca ext.) o el barreno (rosca int.) debe llegar ya a la medida nominal antes de roscar.',
  },
  A55: {
    family: 'WHITWORTH_55',
    label: 'Perfil Parcial 55° (Whitworth / BSPT / BSPP)',
    note: 'Cubre un rango de hilos por pulgada en perfil Whitworth de raíz y cresta redondeada. Usado en roscas de tubería BSPT (cónica, sellado) y BSPP (paralela).',
  },
  APT: {
    family: 'ACME_29',
    label: 'Perfil Parcial ACME 29° / Trapecial',
    note: 'Cubre un rango de pasos ACME (29°) o trapecial métrica (30°, si el fabricante lo vende como "ATP"). Usado en husillos de potencia y tornillos de avance, no en roscas de sujeción.',
  },
};

const FULL_PROFILE_FAMILY: Record<string, { family: ThreadProfileFamily; label: string }> = {
  ISO: { family: 'ISO_METRIC_60', label: 'ISO Métrica 60° (perfil completo)' },
  MJ: { family: 'ISO_METRIC_60', label: 'ISO Métrica MJ 60° (raíz redondeada, aeroespacial)' },
  UN: { family: 'UN_60', label: 'Unificada UN/UNC/UNF 60° (perfil completo)' },
  UNC: { family: 'UN_60', label: 'Unificada UNC 60° Gruesa (perfil completo)' },
  UNF: { family: 'UN_60', label: 'Unificada UNF 60° Fina (perfil completo)' },
  NPT: { family: 'NPT_60', label: 'NPT Cónica 60° (sellado por rosca, perfil completo)' },
  BSW: { family: 'WHITWORTH_55', label: 'Whitworth BSW 55° (perfil completo)' },
  ACME: { family: 'ACME_29', label: 'ACME 29° (perfil completo)' },
  TR: { family: 'TRAPEZOIDAL_30', label: 'Trapecial Métrica 30° (perfil completo)' },
};

function holderSuggestionFor(side: ThreadSide, sizeCode: string): string {
  if (side === 'external') {
    return `Porta Exterior SER/SEL ${sizeCode}-XX (zanco cuadrado acorde al tamaño ${sizeCode})`;
  }
  return `Barra de Roscar Interior S..-SIR/SIL ${sizeCode}-XX (diámetro de barra ≥ barreno mínimo indicado)`;
}

/**
 * Decodifica un código de inserto de rosca. Devuelve null si el formato no coincide con
 * ningún patrón conocido de designación de insertos de rosca (a diferencia de la versión
 * anterior de esta funcionalidad, no existía — los códigos de rosca simplemente se
 * decodificaban mal por isoInsertDecoder).
 */
export function decodeThreadInsertCode(rawInput: string): DecodedThreadInsert | null {
  if (!rawInput) return null;
  const clean = rawInput.trim().toUpperCase().replace(/[\s_]+/g, '').replace(/-/g, '');
  const match = clean.match(/^(\d{2})([EI])([RL])(.+)$/);
  if (!match) return null;

  const [, sizeCode, sideChar, handChar, rest] = match;
  const sizeInfo = SIZE_TABLE[sizeCode];
  if (!sizeInfo) return null;

  const side = SIDE_MAP[sideChar];
  const hand = HAND_MAP[handChar];

  // 1. ¿Es perfil parcial? (coincidencia exacta con un código conocido, sin número de paso)
  const partial = PARTIAL_PROFILES[rest];
  if (partial) {
    return {
      rawCode: rawInput,
      sizeCode,
      sizeLabel: sizeInfo.label,
      minBarOrHoleMm: sizeInfo.minBarOrHoleMm,
      side,
      hand,
      profileFamily: partial.family,
      profileLabel: partial.label,
      isFullProfile: false,
      unitSystem: 'metric',
      fullProfileNote: partial.note,
      holderSuggestion: holderSuggestionFor(side, sizeCode),
    };
  }

  // 2. ¿Es perfil completo? (número + letras de familia, ej. "1.5ISO", "20UN", "10ACME")
  const fullMatch = rest.match(/^(\d+(?:\.\d+)?)(ISO|MJ|UNC|UNF|UN|NPT|BSW|ACME|TR)$/);
  if (!fullMatch) return null;

  const [, numericStr, profileKey] = fullMatch;
  const profileInfo = FULL_PROFILE_FAMILY[profileKey];
  if (!profileInfo) return null;

  const numericValue = Number.parseFloat(numericStr);
  const isInchTpiStyle = !numericStr.includes('.') && ['UN', 'UNC', 'UNF', 'NPT', 'BSW', 'ACME'].includes(profileKey);

  return {
    rawCode: rawInput,
    sizeCode,
    sizeLabel: sizeInfo.label,
    minBarOrHoleMm: sizeInfo.minBarOrHoleMm,
    side,
    hand,
    profileFamily: profileInfo.family,
    profileLabel: profileInfo.label,
    isFullProfile: true,
    unitSystem: isInchTpiStyle ? 'inch' : 'metric',
    pitchMm: isInchTpiStyle ? undefined : numericValue,
    tpi: isInchTpiStyle ? numericValue : undefined,
    fullProfileNote: 'Este inserto solo corta este paso/TPI exacto. Si necesitas otro paso, necesitas otro inserto de la serie completa.',
    holderSuggestion: holderSuggestionFor(side, sizeCode),
  };
}
