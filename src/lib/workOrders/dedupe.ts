/**
 * Lógica pura de deduplicación/upsert de órdenes de control. SIN I/O.
 *
 * La llave de dedup amarra una pieza concreta a su orden: `SO::parte`
 * (o `SO::pieza` si no hay número de parte; o `PO::…` si no hay SO).
 * Re-subir la misma PO produce las mismas llaves => no se duplica y, en el
 * upsert, NO se pisa el estado de entrega ya marcado.
 */

import { normalizePieceLabel } from '../matching';

/** Campos mínimos que necesita el dedup de una orden extraída. */
export interface DedupeInput {
  soNumber: string;
  poNumber: string;
  numeroParte: string;
  pieza: string;
}

/** Toma la primera línea no vacía (SO/fecha pueden venir multi-línea). */
function firstLine(value: string): string {
  return (value ?? '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)[0] ?? '';
}

export function buildDedupeKey(input: DedupeInput): string {
  const so = normalizePieceLabel(firstLine(input.soNumber));
  const po = normalizePieceLabel(firstLine(input.poNumber));
  const parte = normalizePieceLabel(input.numeroParte);
  const pieza = normalizePieceLabel(input.pieza);
  const orderKey = so || po || 'SIN-ORDEN';
  const pieceKey = parte || pieza || 'SIN-PIEZA';
  return `${orderKey}::${pieceKey}`;
}

/** Campos que un upsert puede refrescar sin tocar el estado de entrega. */
export interface UpsertMutableFields {
  cantidad: string;
  prioridad: 'URGENTE' | 'Normal';
  matchedDrawingId: string | null;
  matchedPartId: string | null;
  matchScore: number | null;
  otDate: string;
  poNumber: string;
  soNumber: string;
}

export interface MergeUpsertResult {
  /** Llaves nuevas (no existían): hay que crearlas. */
  toCreate: string[];
  /** Existentes a refrescar: id del doc + campos mutables. */
  toUpdate: Array<{ id: string; key: string; fields: UpsertMutableFields }>;
}

/**
 * Decide, dado el set de órdenes ya en la base (por dedupeKey) y las recién
 * extraídas, cuáles crear y cuáles actualizar. NUNCA marca para borrar nada.
 *
 * @param existingByKey  Map dedupeKey -> { id } de lo ya guardado.
 * @param incoming       órdenes extraídas (ya con su dedupeKey calculado).
 */
export function mergeUpsert<TExisting extends { id: string }>(
  existingByKey: ReadonlyMap<string, TExisting>,
  incoming: ReadonlyArray<{ key: string; fields: UpsertMutableFields }>,
): MergeUpsertResult {
  const toCreate: string[] = [];
  const toUpdate: Array<{ id: string; key: string; fields: UpsertMutableFields }> = [];
  const seen = new Set<string>();

  for (const item of incoming) {
    if (seen.has(item.key)) continue; // colapsa duplicados dentro del mismo lote
    seen.add(item.key);

    const existing = existingByKey.get(item.key);
    if (existing) {
      toUpdate.push({ id: existing.id, key: item.key, fields: item.fields });
    } else {
      toCreate.push(item.key);
    }
  }

  return { toCreate, toUpdate };
}
