/**
 * Juegos (pares, hojas, complementos) guardados por el operador.
 * Lógica pura: sin Firebase ni React. Ver src/lib/firebase/toolcribSets.ts para la persistencia.
 */

import type { ToolcribActiveDrawingView } from '../types';
import type { CompanionInfo, CompanionType } from './companionDrawings';
import { isIsoDrawingView } from './matching';
import { canonicalPartNumber, pickPreferredDrawing } from './toolcribCatalog';

export type ToolcribSetType = 'par' | 'hoja' | 'complemento' | 'variante';

export interface ToolcribSetMember {
  partNumber: string;
  rol: string;
  orden: number;
  cantidadPorJuego: number;
}

export interface ToolcribSet {
  id: string;
  nombre: string;
  tipo: ToolcribSetType;
  miembros: ToolcribSetMember[];
}

export const MAX_SET_MEMBERS = 8;
const SET_TYPES: readonly ToolcribSetType[] = ['par', 'hoja', 'complemento', 'variante'];
const TYPE_MAP: Record<ToolcribSetType, CompanionType> = {
  par: 'pair',
  hoja: 'sheet',
  complemento: 'complement',
  variante: 'variant',
};

export function setPartKey(partNumber: string): string {
  return canonicalPartNumber(partNumber).trim();
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Valida un documento de Firestore; null si no se puede rescatar. */
export function normalizeSet(raw: unknown): ToolcribSet | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const id = asString(data.id);
  const nombre = asString(data.nombre).slice(0, 100);
  const tipo = data.tipo as ToolcribSetType;
  if (!id || !nombre || !SET_TYPES.includes(tipo)) return null;
  if (!Array.isArray(data.miembros)) return null;
  if (data.miembros.length < 2 || data.miembros.length > MAX_SET_MEMBERS) return null;

  const seen = new Set<string>();
  const miembros: ToolcribSetMember[] = [];
  for (const item of data.miembros) {
    if (!item || typeof item !== 'object') return null;
    const m = item as Record<string, unknown>;
    const partNumber = setPartKey(asString(m.partNumber));
    if (!partNumber || seen.has(partNumber)) return null;
    seen.add(partNumber);
    const cantidad = typeof m.cantidadPorJuego === 'number' ? m.cantidadPorJuego : 1;
    miembros.push({
      partNumber,
      rol: asString(m.rol).slice(0, 60),
      orden: Number.isFinite(m.orden) ? Number(m.orden) : miembros.length + 1,
      cantidadPorJuego: Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= 99 ? cantidad : 1,
    });
  }
  return { id, nombre, tipo, miembros };
}

export function findSavedSetForPart(partNumber: string, sets: readonly ToolcribSet[]): ToolcribSet | null {
  const key = setPartKey(partNumber);
  return sets.find((set) => set.miembros.some((m) => m.partNumber === key)) ?? null;
}

/**
 * Compañeros de `base` según un juego guardado.
 * `null` = la pieza no está en ningún juego guardado (el llamador usa las reglas fijas).
 * `[]` = está en un juego, pero sus hermanos no están en el catálogo.
 */
export function companionsFromSet(
  base: ToolcribActiveDrawingView | string,
  library: readonly ToolcribActiveDrawingView[],
  sets: readonly ToolcribSet[],
): CompanionInfo[] | null {
  const basePart = typeof base === 'string' ? base : base.partNumber;
  const set = findSavedSetForPart(basePart, sets);
  if (!set) return null;

  const baseKey = setPartKey(basePart);
  const companions: CompanionInfo[] = [];
  for (const member of set.miembros) {
    if (member.partNumber === baseKey) continue;
    const view = pickPreferredDrawing(
      library.filter((candidate) => !isIsoDrawingView(candidate) && setPartKey(candidate.partNumber) === member.partNumber),
    );
    if (!view) continue;
    companions.push({
      drawing: view,
      type: TYPE_MAP[set.tipo],
      label: member.rol || member.partNumber,
      order: member.orden,
      cantidadPorJuego: member.cantidadPorJuego,
    });
  }
  companions.sort((a, b) => a.order - b.order || a.drawing.partNumber.localeCompare(b.drawing.partNumber));
  return companions;
}

export function baseQuantityFactor(partNumber: string, sets: readonly ToolcribSet[]): number {
  const set = findSavedSetForPart(partNumber, sets);
  const key = setPartKey(partNumber);
  return set?.miembros.find((m) => m.partNumber === key)?.cantidadPorJuego ?? 1;
}

export function quantityForMember(juegos: number, cantidadPorJuego: number): number {
  return Math.round(juegos * cantidadPorJuego);
}

/**
 * Al guardar `saved`, quita sus piezas de los demás juegos (una pieza, un juego).
 * Juegos que quedan con menos de 2 miembros se borran; el resto se actualiza.
 */
export function reconcileSets(
  existing: readonly ToolcribSet[],
  saved: ToolcribSet,
): { toDelete: string[]; toUpdate: ToolcribSet[] } {
  const taken = new Set(saved.miembros.map((m) => m.partNumber));
  const toDelete: string[] = [];
  const toUpdate: ToolcribSet[] = [];
  for (const set of existing) {
    if (set.id === saved.id) continue;
    if (!set.miembros.some((m) => taken.has(m.partNumber))) continue;
    const remaining = set.miembros.filter((m) => !taken.has(m.partNumber));
    if (remaining.length < 2) toDelete.push(set.id);
    else toUpdate.push({ ...set, miembros: remaining });
  }
  return { toDelete, toUpdate };
}

let activeSets: readonly ToolcribSet[] = [];
export function setActiveSets(sets: readonly ToolcribSet[]): void {
  activeSets = sets;
}
export function getActiveSets(): readonly ToolcribSet[] {
  return activeSets;
}
