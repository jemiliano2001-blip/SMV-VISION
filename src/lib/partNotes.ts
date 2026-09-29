/** Notas permanentes por pieza (lógica pura). Persistencia: src/lib/firebase/partNotes.ts */

import { canonicalPartNumber } from './toolcribCatalog';

export interface PartNote {
  id: string;
  texto: string;
  /** Si es true, la nota viene marcada por defecto para salir en la OT. */
  imprimirEnOT: boolean;
}

export const MAX_NOTES_PER_PART = 10;
export const MAX_NOTE_LENGTH = 300;

/** Notas rápidas de un clic en el modal de impresión. Edita esta lista para cambiarlas. */
export const QUICK_NOTE_CHIPS: readonly string[] = ['Rebabear', 'Tratamiento térmico', 'Rectificar', 'Revisar tolerancias'];

export function normalizePartNotes(raw: unknown): PartNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: PartNote[] = [];
  for (const item of raw) {
    if (notes.length >= MAX_NOTES_PER_PART) break;
    if (!item || typeof item !== 'object') continue;
    const data = item as Record<string, unknown>;
    const texto = typeof data.texto === 'string' ? data.texto.trim().slice(0, MAX_NOTE_LENGTH) : '';
    if (!texto) continue;
    const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : `n${notes.length + 1}`;
    notes.push({ id, texto, imprimirEnOT: data.imprimirEnOT === true });
  }
  return notes;
}

/** Une notas permanentes (ya filtradas) y la nota de la corrida en una sola línea para el sello. */
export function composeOtNotes(texts: readonly string[], corrida: string): string {
  return [...texts, corrida].map((t) => t.trim()).filter(Boolean).join(' · ');
}

export function noteDocId(partNumber: string): string {
  return canonicalPartNumber(partNumber).replace(/[^A-Z0-9]/g, '_').slice(0, 100);
}
