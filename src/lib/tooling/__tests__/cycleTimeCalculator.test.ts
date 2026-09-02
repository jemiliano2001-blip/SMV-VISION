import { describe, it, expect } from 'vitest';
import {
  calculateTurningCycleTime,
  calculateMillingCycleTime,
  formatSecondsToTime,
  generateHaasTurningGcode,
  generateHaasMillingGcode,
} from '../cycleTimeCalculator';

describe('Cycle Time & Machining Cost Estimator (Haas ST & VF)', () => {
  describe('formatSecondsToTime', () => {
    it('formats seconds to minutes and seconds', () => {
      expect(formatSecondsToTime(0)).toBe('0s');
      expect(formatSecondsToTime(45)).toBe('45s');
      expect(formatSecondsToTime(65)).toBe('1m 05s');
      expect(formatSecondsToTime(130)).toBe('2m 10s');
    });
  });

  describe('calculateTurningCycleTime', () => {
    it('calculates passes, cycle time and cost for turning', () => {
      const result = calculateTurningCycleTime({
        cutLength: 2.0, // 2 inches
        rawDiameter: 2.0, // 2.000"
        finalDiameter: 1.2, // 1.200" -> radial reduction 0.400"
        depthOfCutAp: 0.100, // 4 passes
        feedPerRev: 0.010, // 0.010 ipr
        rpm: 1000, // 1000 * 0.010 = 10 ipm
        hourlyRate: 60, // $60/hr -> $1/min
        partHandlingSec: 20,
        toolChanges: 1,
      });

      // 4 passes of 2 inches = 8 inches cut
      // at 10 ipm = 0.8 min = 48 sec
      expect(result.roughPasses).toBe(4);
      expect(result.pureCutTimeSec).toBe(48);
      expect(result.toolChangeTimeSec).toBe(3); // 2.5 rounded
      expect(result.partHandlingSec).toBe(20);
      expect(result.totalCycleTimeSec).toBeGreaterThan(60);
      expect(result.partsPerHourTheoretical).toBeGreaterThan(0);
      expect(result.partsPer8hShift).toBeGreaterThan(0);
      expect(result.machiningCostPerPart).toBeGreaterThan(0);
    });

    it('handles zero or negative diameter delta safely', () => {
      const result = calculateTurningCycleTime({
        cutLength: 1.5,
        rawDiameter: 1.0,
        finalDiameter: 1.0,
        depthOfCutAp: 0.05,
        feedPerRev: 0.008,
        rpm: 800,
        hourlyRate: 50,
      });

      expect(result.roughPasses).toBe(1);
      expect(result.pureCutTimeSec).toBeGreaterThan(0);
    });
  });

  describe('calculateMillingCycleTime', () => {
    it('calculates cycle time from volume and MRR', () => {
      const result = calculateMillingCycleTime({
        materialVolumeToRemove: 5.0, // 5 in³
        mrr: 2.5, // 2.5 in³/min -> 2 min = 120s pure cut
        hourlyRate: 75,
        partHandlingSec: 30,
        toolChanges: 2,
      });

      expect(result.pureCutTimeSec).toBe(120);
      expect(result.airCutTimeSec).toBe(18); // 15% of 120
      expect(result.toolChangeTimeSec).toBe(6); // 2.8 * 2 = 5.6 rounded to 6
      expect(result.partHandlingSec).toBe(30);
      expect(result.totalCycleTimeSec).toBe(174);
      expect(result.machiningCostPerPart).toBeCloseTo((75 / 3600) * 174, 1);
    });
  });

  describe('G-code generation', () => {
    it('generates Haas Turning G71 cycle', () => {
      const gcode = generateHaasTurningGcode({
        programNumber: 1234,
        partName: 'TEST_SHAFT',
        sfm: 500,
        feedIpr: 0.009,
        apInch: 0.075,
        rawDiaInch: 2.5,
        finalDiaInch: 1.5,
        cutLengthInch: 3.0,
      });

      expect(gcode).toContain('O1234 (TEST_SHAFT)');
      expect(gcode).toContain('G20');
      expect(gcode).toContain('G96 S500');
      expect(gcode).toContain('G71 P10 Q20');
      expect(gcode).toContain('D0.075');
      expect(gcode).toContain('F0.0090');
      expect(gcode).toContain('Z-3.000');
      expect(gcode).toContain('M30');
    });

    it('generates Haas Milling Setup block', () => {
      const gcode = generateHaasMillingGcode({
        programNumber: 5678,
        partName: 'TEST_POCKET',
        rpm: 4200,
        feedIpm: 50.0,
      });

      expect(gcode).toContain('O5678 (TEST_POCKET)');
      expect(gcode).toContain('G20 (INCH MODE)');
      expect(gcode).toContain('S4200 M03');
      expect(gcode).toContain('F50.0');
      expect(gcode).toContain('M30');
    });
  });
});
