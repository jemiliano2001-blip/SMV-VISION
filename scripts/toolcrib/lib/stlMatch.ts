/**
 * Matching STL suelto ↔ drawing de catálogo, para `toolcribUploadStls.ts`.
 *
 * Antes esto era un `.includes()` con umbral 50 — dejaba que "90-1012-05"
 * reclamara el drawing de "90-1012-055" (o cualquier otro) por pura
 * coincidencia de substring, con el riesgo de que el tornero viera el
 * visor 3D de la pieza equivocada.
 *
 * No reusa `scorePieceMatch` tal cual: ese scorer permite contención de
 * prefijos ("ABC-123" dentro de "ABC-123-REV2") porque en el resto del
 * catálogo casi siempre hay texto descriptivo (pieza/descripción) que
 * desambigua. Aquí solo hay un número de parte bare — sin ese contexto,
 * la contención es exactamente el bug que se está corrigiendo. Por eso
 * exige coincidencia EXACTA de identificador (via `extractPartIdentifiers`,
 * que ya normaliza mayúsculas/separadores) en vez de contención.
 *
 * Vive fuera de `toolcribUploadStls.ts` para poder testearse sin importar
 * ese script — tiene un `main()` de nivel superior que se ejecuta al cargar
 * el módulo.
 */
import { extractPartIdentifiers } from '../../../src/lib/matching';

function normalizeBasePartNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\.STL$/i, '').replace(/\.ISO$/i, '');
}

/**
 * `basePartNumber` ya debe venir normalizado (ver `normalizeBasePartNumber`
 * / el `basePartNumber` que arma `walkStls` en `toolcribUploadStls.ts`).
 * Devuelve 100 (match exacto de texto), 95 (match exacto de identificador
 * extraído — p.ej. vía sourcePath) o 0 (sin match; nunca un valor a medias
 * que pudiera colarse por un umbral bajo).
 */
export function scoreStlDrawingMatch(
  basePartNumber: string,
  candidatePartNumber: string,
  candidateSourcePath: string,
): number {
  const normalizedCandidate = normalizeBasePartNumber(candidatePartNumber);
  if (normalizedCandidate === basePartNumber || normalizedCandidate === `${basePartNumber}.ISO`) {
    return 100;
  }

  const baseIds = new Set(extractPartIdentifiers(basePartNumber));
  if (baseIds.size === 0) return 0;
  const candidateIds = new Set([
    ...extractPartIdentifiers(candidatePartNumber),
    ...(candidateSourcePath ? extractPartIdentifiers(candidateSourcePath) : []),
  ]);
  for (const id of baseIds) {
    if (candidateIds.has(id)) return 95;
  }
  return 0;
}
