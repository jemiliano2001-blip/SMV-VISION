import type { ToolcribActiveDrawingView } from '../types';
import { extractBasePartRoot } from './companionDrawings';
import { isIsoDrawingView } from './matching';
import { findSavedSetForPart, setPartKey, type ToolcribSet } from './toolcribSets';

export interface SetSuggestion {
  root: string;
  partNumbers: string[];
}

/** Candidatos a juego: piezas CAD con la misma raíz de número de parte y aún sin juego guardado. */
export function suggestSets(
  library: readonly ToolcribActiveDrawingView[],
  sets: readonly ToolcribSet[],
): SetSuggestion[] {
  const groups = new Map<string, Set<string>>();
  for (const view of library) {
    if (isIsoDrawingView(view)) continue;
    const root = extractBasePartRoot(view.partNumber);
    if (!root || root.length < 4) continue;
    const bucket = groups.get(root) ?? new Set<string>();
    bucket.add(setPartKey(view.partNumber));
    groups.set(root, bucket);
  }

  const suggestions: SetSuggestion[] = [];
  for (const [root, parts] of groups) {
    if (parts.size < 2) continue;
    const partNumbers = [...parts].sort((a, b) => a.localeCompare(b));
    if (partNumbers.some((part) => findSavedSetForPart(part, sets))) continue;
    suggestions.push({ root, partNumbers });
  }
  return suggestions.sort((a, b) => a.root.localeCompare(b.root));
}
