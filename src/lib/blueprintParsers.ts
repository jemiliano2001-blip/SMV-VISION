/**
 * Parseo y validación de respuestas de Gemini Vision para blueprints.
 *
 * parseBoundingBox: convierte un array desconocido a BoundingBox tipada.
 * parseBlueprintResponse: parsea el JSON de Gemini a BlueprintSpec[].
 */

import type { BlueprintSpec, BoundingBox } from '../types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseBoundingBox(value: unknown): BoundingBox | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }
  const nums = value.map((entry) =>
    typeof entry === 'number' ? entry : Number.NaN,
  );
  if (nums.some((n) => Number.isNaN(n))) {
    return null;
  }
  return [nums[0], nums[1], nums[2], nums[3]];
}

/**
 * Límite a partir del cual un valor de cajetín deja de parecer un dato y empieza a
 * parecer razonamiento del modelo. Un tratamiento térmico real cabe de sobra:
 * "TEMPLE Y REVENIDO 58-60 HRC, NITRURADO SUPERFICIAL 0.2MM" son 57 caracteres.
 */
const META_MAX_LENGTH = 120;

/** Valores que el modelo usa para decir "no hay dato" en vez de omitir el campo. */
const META_EMPTY_RE = /^(null|nulo|n\/?a|ninguno|ninguna|none|no especificado|sin especificar|no aplica|-{1,3})$/i;

/**
 * Fuga de prompt: frases que solo aparecen cuando el modelo escupe sus propias
 * instrucciones en lugar del valor. Van con límites de palabra para no cazar
 * subcadenas dentro de términos legítimos de taller.
 */
const META_PROMPT_LEAK_RE =
  /\b(regla|reglas|par[aá]metro|par[aá]metros|inventar|opcional|recomendado|recomendable|no especificado en|seg[uú]n el prompt|instrucci[oó]n)\b/i;

/**
 * Normaliza un valor de cajetín (material, dureza, tratamiento, acabado) devuelto
 * por Gemini Vision, o `null` si no es un dato utilizable.
 *
 * Los valores largos se **truncan**, no se descartan: perder "TEMPLE Y REVENIDO..."
 * entero por pasarse de largo es peor que mostrarlo recortado.
 */
export function sanitizeMetaString(value: unknown, maxLength = META_MAX_LENGTH): string | null {
  const str = asString(value);
  if (!str) return null;

  const trimmed = str.trim();
  if (trimmed.length === 0) return null;
  if (META_EMPTY_RE.test(trimmed)) return null;
  if (META_PROMPT_LEAK_RE.test(trimmed)) return null;

  if (trimmed.length > maxLength) {
    return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return trimmed;
}

export function parseBlueprintResponse(text: string): BlueprintSpec[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  const specs: BlueprintSpec[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const piece = asString(item.pieza_detectada);
    const box = parseBoundingBox(item.isometricBoundingBox);
    if (!piece || !box) continue;
    specs.push({
      pieza_detectada: piece,
      isometricBoundingBox: box,
      material: sanitizeMetaString(item.material),
      dureza: sanitizeMetaString(item.dureza),
      tratamiento: sanitizeMetaString(item.tratamiento),
      acabado: sanitizeMetaString(item.acabado),
    });
  }
  return specs;
}
