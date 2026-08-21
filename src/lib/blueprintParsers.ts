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
      material: asString(item.material) || null,
      dureza: asString(item.dureza) || null,
      tratamiento: asString(item.tratamiento) || null,
      acabado: asString(item.acabado) || null,
    });
  }
  return specs;
}
