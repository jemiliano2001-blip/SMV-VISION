import { describe, it, expect } from 'vitest';
import { computeThreadFlankMm, clampNumber, APPROX_PITCH_LINE_FRACTION } from '../threadProfileGeometry';

describe('threadProfileGeometry', () => {
  describe('computeThreadFlankMm', () => {
    it('computes crest (P/8) and root (P/4) flats for a 60° V profile', () => {
      const result = computeThreadFlankMm(2, 1.2268, 60);
      expect(result.crestFlatMm).toBeCloseTo(2 / 8, 6);
      expect(result.rootFlatMm).toBeCloseTo(2 / 4, 6);
    });

    it('computes flank horizontal run as depth * tan(halfAngle)', () => {
      const result = computeThreadFlankMm(2, 1, 60);
      expect(result.flankRunMm).toBeCloseTo(1 * Math.tan((30 * Math.PI) / 180), 6);
    });

    it('clamps negative/zero depth to zero flank run', () => {
      const result = computeThreadFlankMm(2, -5, 60);
      expect(result.flankRunMm).toBe(0);
    });

    it('uses a smaller flank run for a narrower included angle (e.g. 29° Acme)', () => {
      const wide = computeThreadFlankMm(2, 1, 60);
      const narrow = computeThreadFlankMm(2, 1, 29);
      expect(narrow.flankRunMm).toBeLessThan(wide.flankRunMm);
    });
  });

  describe('clampNumber', () => {
    it('clamps within range', () => {
      expect(clampNumber(5, 0, 10)).toBe(5);
      expect(clampNumber(-5, 0, 10)).toBe(0);
      expect(clampNumber(50, 0, 10)).toBe(10);
    });
  });

  it('APPROX_PITCH_LINE_FRACTION is between 0 and 1', () => {
    expect(APPROX_PITCH_LINE_FRACTION).toBeGreaterThan(0);
    expect(APPROX_PITCH_LINE_FRACTION).toBeLessThan(1);
  });
});
