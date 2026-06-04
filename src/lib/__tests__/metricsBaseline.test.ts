import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readBaselineMetrics, calculateMetricsComparison } from '../metricsBaseline';
import type { AnalysisMetrics } from '../../types';

// localStorage no existe en ambiente node — se stubea con vi.stubGlobal.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem:    (key: string) => store[key] ?? null,
    setItem:    (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear:      () => { store = {}; },
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

const BASELINE_KEY = 'smvVisionMetricsBaselineV2';

const sample: AnalysisMetrics = {
  totalMs: 10_000,
  pdfRasterMs: 2_000,
  aiOrderMs: 3_000,
  aiBlueprintMs: 4_000,
  mergeMs: 1_000,
};

beforeEach(() => {
  localStorage.clear();
});

describe('readBaselineMetrics', () => {
  it('devuelve null cuando no hay baseline', () => {
    expect(readBaselineMetrics()).toBeNull();
  });
  it('devuelve el objeto parseado cuando existe', () => {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(sample));
    expect(readBaselineMetrics()).toEqual(sample);
  });
  it('limpia la clave y devuelve null si el JSON está corrupto', () => {
    localStorage.setItem(BASELINE_KEY, 'no-es-json{');
    expect(readBaselineMetrics()).toBeNull();
    expect(localStorage.getItem(BASELINE_KEY)).toBeNull();
  });
});

describe('calculateMetricsComparison', () => {
  it('establece baseline en la primera corrida y devuelve delta 0', () => {
    const result = calculateMetricsComparison(sample);
    expect(result.totalImprovementPct).toBe(0);
    expect(result.baseline).toEqual(sample);
    expect(result.latest).toEqual(sample);
    expect(localStorage.getItem(BASELINE_KEY)).not.toBeNull();
  });
  it('calcula mejora positiva cuando latest es más rápido', () => {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(sample));
    const faster: AnalysisMetrics = { ...sample, totalMs: 8_000 };
    const result = calculateMetricsComparison(faster);
    expect(result.totalImprovementPct).toBeCloseTo(20); // (10000-8000)/10000 * 100
  });
  it('calcula mejora negativa cuando latest es más lento', () => {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(sample));
    const slower: AnalysisMetrics = { ...sample, totalMs: 12_000 };
    const result = calculateMetricsComparison(slower);
    expect(result.totalImprovementPct).toBeCloseTo(-20);
  });
});
