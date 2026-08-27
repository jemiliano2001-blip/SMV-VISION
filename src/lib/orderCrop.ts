import type { BoundingBox, Order } from '../types';

/** Aplica un recorte a una orden por identidad de objeto (no por índice: el índice puede
 * apuntar a una lista filtrada distinta de `results`). */
export function applyOrderCrop(
  results: Order[] | null,
  target: Order,
  newBox: BoundingBox,
  newCroppedUrl: string,
): Order[] | null {
  if (!results) return results;

  return results.map((order) =>
    order === target
      ? {
          ...order,
          isometricBoundingBox: newBox,
          isometricView: newCroppedUrl,
          isometricSource: 'crop',
        }
      : order,
  );
}
