import { describe, expect, it } from 'vitest';
import { applyOrderCropAtIndex } from '../orderCrop';
import type { Order } from '../../types';

const baseOrder = (pieza: string): Order => ({
  pieza,
  cantidad: '1',
  orden: '2026/S00101',
  fecha: '2026-08-21',
  prioridad: 'Normal',
});

describe('applyOrderCropAtIndex', () => {
  it('updates only the selected result after that row has been replaced', () => {
    const results = [
      baseOrder('PUNZON'),
      { ...baseOrder('PUNZON'), isometricView: 'data:image/jpeg;base64,ai' },
    ];

    const updated = applyOrderCropAtIndex(
      results,
      1,
      [125, 125, 875, 875],
      'data:image/jpeg;base64,crop',
    );

    expect(updated?.[0].isometricView).toBeUndefined();
    expect(updated?.[1].isometricView).toBe('data:image/jpeg;base64,crop');
    expect(updated?.[1].isometricBoundingBox).toEqual([125, 125, 875, 875]);
  });
});
