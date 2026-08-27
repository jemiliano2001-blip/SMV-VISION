import { describe, it, expect } from 'vitest';
import { calculateTurningSpeedsFeeds, calculateMillingSpeedsFeeds } from '../speedsFeedsCalculator';

describe('Speeds & Feeds Calculator', () => {
  describe('Turning Calculations', () => {
    it('calculates exact RPM, feed rate, and MRR for steel 4140', () => {
      const result = calculateTurningSpeedsFeeds({
        diameterMm: 38,
        cuttingSpeedMMin: 200,
        feedPerRevMm: 0.25,
        depthOfCutMm: 2.0,
        noseRadiusMm: 0.8,
        materialId: 'steel_4140',
        haasMachineId: 'haas_st20',
      });

      // RPM = (200 * 1000) / (pi * 38) = 1675.29 -> 1675
      expect(result.rpm).toBe(1675);
      // Feed rate = 1675 * 0.25 = 418.8 mm/min
      expect(result.feedRateMmMin).toBe(418.8);
      // MRR = 200 * 2.0 * 0.25 = 100 cm3/min
      expect(result.mrrCm3Min).toBe(100);
      // Net power kW = (200 * 2.0 * 0.25 * 2100) / 60000 = 3.5 kW
      expect(result.netPowerKw).toBe(3.5);
      // Motor HP required = (4.69 / 0.80) = 5.86 HP
      expect(result.motorPowerHpRequired).toBe(5.86);
      // Theoretical Ra = (0.25^2 / (32 * 0.8)) * 1000 = (0.0625 / 25.6) * 1000 = 2.44 um
      expect(result.theoreticalSurfaceRoughnessRaUm).toBe(2.44);
      expect(result.warnings).toHaveLength(0);
    });

    it('calculates fine finish Ra for small nose radius and feed in stainless', () => {
      const result = calculateTurningSpeedsFeeds({
        diameterMm: 25,
        cuttingSpeedMMin: 150,
        feedPerRevMm: 0.08,
        depthOfCutMm: 0.5,
        noseRadiusMm: 0.4,
        materialId: 'stainless_304',
        haasMachineId: 'haas_st10',
      });

      // Ra = (0.08^2 / (32 * 0.4)) * 1000 = (0.0064 / 12.8) * 1000 = 0.50 um
      expect(result.theoreticalSurfaceRoughnessRaUm).toBe(0.5);
      expect(result.theoreticalSurfaceRoughnessRzUm).toBe(2.0);
    });

    it('warns when RPM or HP exceeds Haas machine limits', () => {
      const result = calculateTurningSpeedsFeeds({
        diameterMm: 5,
        cuttingSpeedMMin: 400, // Demanda RPM = (400 * 1000) / (pi * 5) = 25464 RPM
        feedPerRevMm: 0.40,
        depthOfCutMm: 6.0,
        noseRadiusMm: 0.8,
        materialId: 'steel_4140',
        haasMachineId: 'haas_st20', // Máx 4000 RPM, 20 HP
      });

      expect(result.rpm).toBeGreaterThan(4000);
      expect(result.warnings.some(w => w.includes('RPM requeridas'))).toBe(true);
    });
  });

  describe('Milling Calculations', () => {
    it('calculates RPM and feed for a 1/2" 4F endmill in steel 4140', () => {
      const result = calculateMillingSpeedsFeeds({
        toolDiameterInch: 0.5,
        numberOfFlutes: 4,
        surfaceFeetPerMinute: 350,
        chipLoadInch: 0.003,
        axialDepthOfCutMm: 5.0,
        radialDepthOfCutMm: 6.35, // 50% stepover
        materialId: 'steel_4140',
        haasMachineId: 'haas_vf2',
      });

      // RPM = (350 * 3.82) / 0.5 = 2674
      expect(result.rpm).toBe(2674);
      // Table Feed IPM = 2674 * 0.003 * 4 = 32.1 IPM
      expect(result.tableFeedIpm).toBe(32.1);
      // Stepover is 50%, so RCTF should be 1.0 (no thinning)
      expect(result.radialChipThinningFactor).toBe(1.0);
    });

    it('applies radial chip thinning compensation when stepover < 50%', () => {
      const result = calculateMillingSpeedsFeeds({
        toolDiameterInch: 0.5, // 12.7 mm
        numberOfFlutes: 4,
        surfaceFeetPerMinute: 400,
        chipLoadInch: 0.003,
        axialDepthOfCutMm: 12.7,
        radialDepthOfCutMm: 1.27, // 10% stepover (trochoidal)
        materialId: 'steel_4140',
        haasMachineId: 'haas_vf2',
      });

      // When ae/D = 0.1, RCTF > 1.6
      expect(result.radialChipThinningFactor).toBeGreaterThan(1.5);
      expect(result.adjustedFeedIpm).toBeGreaterThan(result.tableFeedIpm);
      expect(result.tips.some(t => t.includes('Chip Thinning Activo'))).toBe(true);
    });
  });
});
