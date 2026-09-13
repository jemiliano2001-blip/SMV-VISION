import { describe, it, expect } from 'vitest';
import { TAP_DRILL_CHART_SOURCE, UNC_TAP_DRILLS, METRIC_TAP_DRILLS, NPT_TAP_DRILLS } from '../tapDrillChart';

describe('Tap Drill Chart source attribution', () => {
  it('exposes a verifiedOn date in ISO YYYY-MM-DD format', () => {
    expect(TAP_DRILL_CHART_SOURCE.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('cites the industry-standard handbooks, not a single-vendor source', () => {
    expect(TAP_DRILL_CHART_SOURCE.label).toContain('ASME B1.1');
    expect(TAP_DRILL_CHART_SOURCE.label).toContain('ASME B1.20.1');
    expect(TAP_DRILL_CHART_SOURCE.url).toMatch(/^https:\/\//);
  });

  it('does not alter existing drill sizes (1/4-20 UNC cut drill is #7 / 0.201")', () => {
    const entry = UNC_TAP_DRILLS.find((e) => e.designation === '1/4-20 UNC');
    expect(entry).toBeDefined();
    expect(entry?.cutTapDrillFraction).toBe('#7');
    expect(entry?.cutTapDrillInchDecimal).toBeCloseTo(0.201, 3);
  });

  it('does not alter existing metric drill sizes (M6 x 1.0 cut drill is 5.0mm)', () => {
    const entry = METRIC_TAP_DRILLS.find((e) => e.designation === 'M6 x 1.0');
    expect(entry).toBeDefined();
    expect(entry?.cutTapDrillMm).toBe(5.0);
  });

  it('does not alter existing NPT drill sizes (1/2-14 NPT cut drill is 45/64")', () => {
    const entry = NPT_TAP_DRILLS.find((e) => e.designation === '1/2-14 NPT');
    expect(entry).toBeDefined();
    expect(entry?.cutTapDrillFraction).toBe('45/64"');
  });
});
