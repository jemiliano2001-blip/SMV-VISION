import type { BoundingBox, Order } from '../types';

/** Aplica un recorte a una fila concreta del resultado por su índice estable. */
export function applyOrderCropAtIndex(
  results: Order[] | null,
  resultIndex: number,
  newBox: BoundingBox,
  newCroppedUrl: string,
): Order[] | null {
  if (!results || resultIndex < 0 || resultIndex >= results.length) {
    return results;
  }

  return results.map((order, index) =>
    index === resultIndex
      ? {
          ...order,
          isometricBoundingBox: newBox,
          isometricView: newCroppedUrl,
          isometricSource: 'crop',
        }
      : order,
  );
}
