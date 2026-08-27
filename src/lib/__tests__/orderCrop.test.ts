import { describe, expect, it } from 'vitest';
import { applyOrderCrop } from '../orderCrop';
import type { Order } from '../../types';

const baseOrder = (pieza: string): Order => ({
  pieza,
  cantidad: '1',
  orden: '2026/S00101',
  fecha: '2026-08-21',
  prioridad: 'Normal',
});

describe('applyOrderCrop', () => {
  it('updates only the targeted order by identity, even under a filtered/reordered list', () => {
    const target = { ...baseOrder('PUNZON'), isometricView: 'data:image/jpeg;base64,ai' };
    const results = [baseOrder('PUNZON'), target];

    const updated = applyOrderCrop(
      results,
      target,
      [125, 125, 875, 875],
      'data:image/jpeg;base64,crop',
    );

    expect(updated?.[0].isometricView).toBeUndefined();
    expect(updated?.[1].isometricView).toBe('data:image/jpeg;base64,crop');
    expect(updated?.[1].isometricBoundingBox).toEqual([125, 125, 875, 875]);
  });

  it('leaves results untouched if the target is not found in the list', () => {
    const results = [baseOrder('PUNZON')];
    const strayOrder = baseOrder('BUJE');

    const updated = applyOrderCrop(results, strayOrder, [125, 125, 875, 875], 'data:x');

    expect(updated).toEqual(results);
  });
});
