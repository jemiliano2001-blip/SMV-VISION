/**
 * Heurística de matching pieza ↔ plano.
 *
 * Dos estrategias en cascada:
 *
 *  1. Match de identificador fuerte (números de parte alfanuméricos). Si los
 *     dos lados tienen identificadores, la coincidencia exacta o por substring
 *     ≥6 chars vale 95. Si ambos tienen identificadores pero NO coinciden, es
 *     veto duro (score 0) — esto evita que "90-1012-05" se case con
 *     "90-1012-06" solo porque comparten "90-1012".
 *
 *  2. Overlap descriptivo (tokens significativos): 85 si comparten un token
 *     fuerte y Jaccard ≥ 0.6; 82 si comparten ≥2 tokens y Jaccard ≥ 0.5.
 *
 * `MIN_BLUEPRINT_MATCH_SCORE = 80` es el umbral para considerar un match.
 *
 * `selectBestBlueprintMatch` además sabe distribuir specs de un plano
 * multi-pieza entre varias órdenes — útil cuando un plano lista 8 variantes
 * (HEX SWAGE BLOCK 7/32, 9/32, 3/8, …) y queremos un crop distinto por orden.
 */

import type { BlueprintSpec, ToolcribActiveDrawingView } from '../types';

export const MIN_BLUEPRINT_MATCH_SCORE = 80;

const COMMON_STOP_WORDS = new Set([
  'PART', 'NUMBER', 'DRAWING', 'REV', 'REVISION', 'SUPRAJIT', 'TOOL', 'CRIB', 'PIEZA', 'CODIGO',
  'DETALLE', 'ENSAMBLE', 'ASSEMBLY', 'DETAIL', 'SCALE', 'ESCALA', 'SHEET', 'HOJA', 'CLIENTE', 'CUSTOMER'
]);

export interface PieceMatchSignals {
  identifiers: string[];
  descriptors: string[];
}

export interface BlueprintSourceCandidate {
  fileLabel: string;
  specs: BlueprintSpec[];
}

export interface BlueprintSpecMatch {
  spec: BlueprintSpec | null;
  score: number;
}

/** Normaliza para comparación: NFD, mayúsculas, solo A-Z0-9-/. y espacios colapsados. */
export function normalizePieceLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\-/. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrongToken(token: string): boolean {
  const hasLetter = /[A-Z]/.test(token);
  const hasDigit = /\d/.test(token);
  const hasLongDigitChain = /\d{4,}/.test(token);
  return hasLongDigitChain || (hasLetter && hasDigit && token.length >= 4) || token.length >= 7;
}

function compactPartIdentifier(value: string): string {
  return value
    .replace(/[^A-Z0-9]/g, '')
    .replace(/REV\d*$/g, '');
}

export function extractPartIdentifiers(value: string): string[] {
  const normalized = normalizePieceLabel(value);
  if (!normalized) {
    return [];
  }

  const ids = new Set<string>();
  const segmentedMatches = normalized.match(/[A-Z0-9]+(?:[-/.][A-Z0-9]+)+/g) ?? [];
  segmentedMatches.forEach((match) => {
    const compact = compactPartIdentifier(match);
    if (compact.length >= 5 && /\d/.test(compact)) {
      ids.add(compact);
    }
  });

  const compactCandidates = normalized.match(/[A-Z0-9]{5,}/g) ?? [];
  compactCandidates.forEach((candidate) => {
    const compact = compactPartIdentifier(candidate);
    if (compact.length >= 5 && /\d/.test(compact)) {
      ids.add(compact);
    }
  });

  return [...ids];
}

function hasStrongIdentifierMatch(orderIds: string[], blueprintIds: string[]): boolean {
  for (const orderId of orderIds) {
    for (const blueprintId of blueprintIds) {
      if (orderId === blueprintId) {
        return true;
      }
      const shortest = Math.min(orderId.length, blueprintId.length);
      if (
        shortest >= 6
        && (orderId.includes(blueprintId) || blueprintId.includes(orderId))
      ) {
        return true;
      }
    }
  }
  return false;
}

export function descriptiveTokens(value: string): string[] {
  const normalized = normalizePieceLabel(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[^A-Z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => (
      token.length >= 3 &&
      /[A-Z]/.test(token) &&
      !/\d{3,}/.test(token) &&
      !COMMON_STOP_WORDS.has(token)
    ));
}

export function extractBlueprintSignals(fileLabel: string, specs: BlueprintSpec[]): PieceMatchSignals {
  const identifiers = new Set<string>();
  const descriptors = new Set<string>();

  // Extract from the filename/path
  const withoutExtension = fileLabel.replace(/\.pdf$/i, ' ');
  extractPartIdentifiers(withoutExtension).forEach((entry) => identifiers.add(entry));
  descriptiveTokens(withoutExtension).forEach((entry) => descriptors.add(entry));

  // Extract from AI analysis of the blueprint content
  specs.forEach((spec) => {
    extractPartIdentifiers(spec.pieza_detectada).forEach((entry) => identifiers.add(entry));
    descriptiveTokens(spec.pieza_detectada).forEach((entry) => descriptors.add(entry));
  });

  return {
    identifiers: [...identifiers],
    descriptors: [...descriptors],
  };
}

export function extractOrderSignals(orderPiece: string, numeroParte?: string): PieceMatchSignals {
  const identifiers = new Set<string>();
  if (numeroParte) {
    extractPartIdentifiers(numeroParte).forEach((id) => identifiers.add(id));
  }
  extractPartIdentifiers(orderPiece).forEach((id) => identifiers.add(id));
  return {
    identifiers: [...identifiers],
    descriptors: descriptiveTokens(orderPiece),
  };
}

export function extractLibrarySignals(view: ToolcribActiveDrawingView): PieceMatchSignals {
  const identifiers = new Set<string>();
  const descriptors = new Set<string>();
  extractPartIdentifiers(view.partNumber).forEach((id) => identifiers.add(id));
  // Mine identifiers from description and sourcePath too — the part number may appear
  // in the description text or encoded in the network-drive file path (e.g. "WCD03-1797-02.pdf")
  extractPartIdentifiers(view.description).forEach((id) => identifiers.add(id));
  if (view.sourcePath) {
    extractPartIdentifiers(view.sourcePath).forEach((id) => identifiers.add(id));
  }
  descriptiveTokens(view.partNumber).forEach((d) => descriptors.add(d));
  descriptiveTokens(view.description).forEach((d) => descriptors.add(d));
  if (view.sourcePath) {
    descriptiveTokens(view.sourcePath).forEach((d) => descriptors.add(d));
  }
  return { identifiers: [...identifiers], descriptors: [...descriptors] };
}

export function scorePieceMatch(orderSignals: PieceMatchSignals, candidateSignals: PieceMatchSignals): number {
  const orderIds = orderSignals.identifiers;
  const candidateIds = candidateSignals.identifiers;

  // RULE 1: Direct identifier match is KING.
  if (orderIds.length > 0 && candidateIds.length > 0) {
    if (hasStrongIdentifierMatch(orderIds, candidateIds)) {
      return 95;
    }
  }

  // RULE 2: If we have IDs in both but they DON'T match, it's a hard NO.
  // This prevents "90-1012-05" from matching "90-1012-06" just because they share "90-1012".
  if (orderIds.length > 0 && candidateIds.length > 0) {
    return 0;
  }

  // RULE 3: Descriptive matching (Fuzzy)
  const orderSet = new Set(orderSignals.descriptors);
  const candidateSet = new Set(candidateSignals.descriptors);
  const sharedTokens = [...orderSet].filter((token) => candidateSet.has(token));

  if (sharedTokens.length === 0) return 0;

  const overlapRatio = sharedTokens.length / Math.max(orderSet.size, candidateSet.size);
  const hasStrongSharedToken = sharedTokens.some(isStrongToken);

  if (hasStrongSharedToken && overlapRatio >= 0.6) return 85;
  if (sharedTokens.length >= 2 && overlapRatio >= 0.5) return 82;

  return 0;
}

function calculatePieceMatchScore(orderPiece: string, blueprintPiece: string): number {
  const normalizedOrder = normalizePieceLabel(orderPiece);
  const normalizedBlueprint = normalizePieceLabel(blueprintPiece);

  if (!normalizedOrder || !normalizedBlueprint) {
    return 0;
  }

  if (normalizedOrder === normalizedBlueprint) {
    return 100;
  }

  const orderSignals = extractOrderSignals(orderPiece);
  const blueprintSignals: PieceMatchSignals = {
    identifiers: extractPartIdentifiers(blueprintPiece),
    descriptors: descriptiveTokens(blueprintPiece),
  };
  return scorePieceMatch(orderSignals, blueprintSignals);
}

/**
 * Selecciona el mejor spec dentro de un plano para una orden dada.
 *
 * @param usedSpecs specs ya consumidos por otras órdenes — permite distribuir
 *                  variantes de un plano multi-pieza (ej. 8 SWAGE BLOCK) sin
 *                  asignar el mismo spec a todas las órdenes.
 */
export function selectBestBlueprintMatch(
  orderPiece: string,
  candidate: BlueprintSourceCandidate,
  numeroParte?: string,
  usedSpecs?: ReadonlySet<BlueprintSpec>,
): BlueprintSpecMatch {
  const normalizedOrder = normalizePieceLabel(orderPiece);
  if (!normalizedOrder) {
    return { spec: null, score: 0 };
  }

  const orderSignals = extractOrderSignals(orderPiece, numeroParte);
  const fileSignals = extractBlueprintSignals(candidate.fileLabel, candidate.specs);
  const fileScore = scorePieceMatch(orderSignals, fileSignals);

  let bestSpec: BlueprintSpec | null = null;
  let bestSpecScore = 0;
  // Track best UNUSED spec separately so we can prefer it on ties / near-ties.
  let bestUnusedSpec: BlueprintSpec | null = null;
  let bestUnusedScore = 0;

  for (const spec of candidate.specs) {
    const score = calculatePieceMatchScore(orderPiece, spec.pieza_detectada);
    if (score > bestSpecScore) {
      bestSpecScore = score;
      bestSpec = spec;
    }
    if (!usedSpecs?.has(spec) && score > bestUnusedScore) {
      bestUnusedScore = score;
      bestUnusedSpec = spec;
    }
  }

  // Prefer an unused spec when its score is within 5 points of the global best.
  if (bestUnusedSpec && bestSpec && bestUnusedSpec !== bestSpec && bestUnusedScore >= bestSpecScore - 5) {
    bestSpec = bestUnusedSpec;
    bestSpecScore = bestUnusedScore;
  }

  const hasStrongFileMatch = fileScore >= MIN_BLUEPRINT_MATCH_SCORE;
  // When the file is a known match but the spec score is weak, still prefer an
  // unused spec to spread the available isometric views across orders.
  if (hasStrongFileMatch && bestSpecScore < MIN_BLUEPRINT_MATCH_SCORE && bestUnusedSpec) {
    bestSpec = bestUnusedSpec;
  }

  const matchedSpec = bestSpec && (
    bestSpecScore >= MIN_BLUEPRINT_MATCH_SCORE
    || hasStrongFileMatch
  ) ? bestSpec : null;

  return {
    spec: matchedSpec,
    score: Math.max(fileScore, bestSpecScore),
  };
}
