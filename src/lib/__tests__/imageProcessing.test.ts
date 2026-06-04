import { describe, it, expect } from 'vitest';
import { isValidBoundingBox } from '../imageProcessing';

// cropIsometricView y cropToBoxRaw requieren Canvas del browser (DOM).
// Deuda técnica: cubrirlos con Playwright o jsdom si se agrega.

describe('isValidBoundingBox', () => {
  it('acepta un box normal válido', () => {
    // 400×400 = área 160_000, ratio 1.0
    expect(isValidBoundingBox([100, 100, 500, 500])).toBe(true);
  });
  it('rechaza undefined o array vacío', () => {
    expect(isValidBoundingBox(undefined)).toBe(false);
    expect(isValidBoundingBox([])).toBe(false);
  });
  it('rechaza array con longitud distinta de 4', () => {
    expect(isValidBoundingBox([100, 100, 500])).toBe(false);
  });
  it('rechaza si algún valor no es finito', () => {
    expect(isValidBoundingBox([100, NaN, 500, 500])).toBe(false);
    expect(isValidBoundingBox([100, Infinity, 500, 500])).toBe(false);
  });
  it('rechaza width ≤ 50 (área < 5% del grid 0-1000)', () => {
    // width = 30
    expect(isValidBoundingBox([100, 100, 500, 130])).toBe(false);
  });
  it('rechaza height ≤ 50', () => {
    // height = 30
    expect(isValidBoundingBox([100, 100, 130, 500])).toBe(false);
  });
  it('rechaza área > 750×750 (~56% del grid)', () => {
    // 800×800 = 640_000 > 562_500
    expect(isValidBoundingBox([0, 0, 800, 800])).toBe(false);
  });
  it('rechaza sliver: lado corto < 25% del lado largo', () => {
    // width=600, height=100 → ratio 100/600 = 0.16 < 0.25
    expect(isValidBoundingBox([100, 100, 200, 700])).toBe(false);
  });
  it('acepta box cuadrado grande (750×750 exacto es límite permitido)', () => {
    // 750×750 = 562_500 que NO es > 562_500, así que pasa
    expect(isValidBoundingBox([0, 0, 750, 750])).toBe(true); // 750*750 = 562500 no es > 562500
  });
  it('acepta box rectangular con ratio > 0.25', () => {
    // 300×100 = ratio 100/300 ≈ 0.33 ✓
    expect(isValidBoundingBox([100, 100, 200, 400])).toBe(true);
  });
});
