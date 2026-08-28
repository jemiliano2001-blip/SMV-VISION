import { describe, it, expect } from 'vitest';
import {
  calculateThreadDepths,
  generateInfeedSchedule,
  metricThreadHeight,
  suggestedPassCountForPitch,
  threadLeadAngleDegrees,
  generateHaasG76Block,
} from '../threadingCalculator';

describe('Threading depth calculations (ISO 68-1 / ASME B1.1 formulas)', () => {
  it('matches the well-known published M12 x 1.75 thread table values', () => {
    // Valores de referencia estándar (Machinery's Handbook / ISO 724) para M12x1.75:
    // diámetro de paso = 10.863mm, diámetro menor = 10.106mm.
    const result = calculateThreadDepths({ pitchMm: 1.75, majorDiameterMm: 12 });

    const pitchDiameter = 12 - result.pitchDiameterOffsetMm;
    const minorDiameter = 12 - result.minorDiameterOffsetMm;

    expect(pitchDiameter).toBeCloseTo(10.863, 2);
    expect(minorDiameter).toBeCloseTo(10.106, 2);
  });

  it('computes external and internal thread depth from pitch alone', () => {
    const result = calculateThreadDepths({ pitchMm: 1.5 });
    expect(result.depthExternalMm).toBeCloseTo(0.6134 * 1.5, 4);
    expect(result.depthInternalMm).toBeCloseTo(0.5413 * 1.5, 4);
  });

  it('computes the fundamental triangle height H = (sqrt(3)/2) * P', () => {
    expect(metricThreadHeight(1.5)).toBeCloseTo(1.299, 3);
  });

  it('computes lead angle from pitch and pitch diameter', () => {
    // M12x1.75: pitch diameter ~10.863mm -> lead angle = atan(1.75 / (pi * 10.863))
    const angle = threadLeadAngleDegrees(1.75, 10.863);
    expect(angle).toBeCloseTo(2.94, 1);
  });

  it('always warns to use G97, never G96, for threading', () => {
    const result = calculateThreadDepths({ pitchMm: 1.0 });
    expect(result.warnings.some((w) => w.includes('G97'))).toBe(true);
  });

  it('picks a coarser infeed method as pitch increases', () => {
    expect(calculateThreadDepths({ pitchMm: 0.5 }).infeedMethod).toBe('radial');
    expect(calculateThreadDepths({ pitchMm: 2.0 }).infeedMethod).toBe('flanco_modificado_29_30');
    expect(calculateThreadDepths({ pitchMm: 4.0 }).infeedMethod).toBe('alternado');
  });
});

describe('Infeed schedule (constant chip volume, sqrt progression)', () => {
  it('generates a decreasing-depth-per-pass schedule following sqrt(i/n)', () => {
    const { percent, mm } = generateInfeedSchedule(1.0, 3);
    expect(percent[0]).toBeCloseTo(Math.sqrt(1 / 3) * 100, 1);
    expect(percent[1]).toBeCloseTo(Math.sqrt(2 / 3) * 100, 1);
    expect(percent[2]).toBeCloseTo(100, 1);
    expect(mm[2]).toBeCloseTo(1.0, 3);
    // Cada pasada debe remover MENOS material que la anterior (profundidad incremental decreciente)
    const incrementalDepths = mm.map((d, i) => (i === 0 ? d : d - mm[i - 1]));
    for (let i = 1; i < incrementalDepths.length; i += 1) {
      expect(incrementalDepths[i]).toBeLessThan(incrementalDepths[i - 1]);
    }
  });
});

describe('suggestedPassCountForPitch', () => {
  it('increases pass count as pitch increases', () => {
    const p1 = suggestedPassCountForPitch(0.5);
    const p2 = suggestedPassCountForPitch(1.5);
    const p3 = suggestedPassCountForPitch(3.5);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
  });
});

describe('generateHaasG76Block', () => {
  it('computes the correct final diameter for an external thread', () => {
    const block = generateHaasG76Block({
      isExternal: true,
      majorDiameterMm: 20,
      pitchMm: 1.5,
      depthMm: 0.92,
      finishingPasses: 2,
      chamferCode: 0,
      tipAngleDegrees: 60,
      minDepthPerPassMm: 0.02,
      finishAllowanceMm: 0.02,
      firstPassDepthMm: 0.3,
      startZMm: 2,
      endZMm: -20,
    });
    // Diámetro final rosca exterior = mayor - 2*profundidad = 20 - 1.84 = 18.16
    expect(block).toContain('X18.160');
    expect(block).toContain('G97');
    expect(block).toContain('F1.500');
  });

  it('computes the correct final diameter for an internal thread (larger, not smaller)', () => {
    const block = generateHaasG76Block({
      isExternal: false,
      majorDiameterMm: 10.5,
      pitchMm: 1.5,
      depthMm: 0.81,
      finishingPasses: 2,
      chamferCode: 0,
      tipAngleDegrees: 60,
      minDepthPerPassMm: 0.02,
      finishAllowanceMm: 0.02,
      firstPassDepthMm: 0.25,
      startZMm: 2,
      endZMm: -15,
    });
    // Rosca interior: diámetro final = menor + 2*profundidad = 10.5 + 1.62 = 12.12
    expect(block).toContain('X12.120');
  });
});
