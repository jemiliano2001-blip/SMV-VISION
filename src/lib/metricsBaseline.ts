/**
 * Baseline de métricas de análisis (localStorage).
 *
 * Almacena y compara métricas de análisis para detectar regresiones
 * de rendimiento.
 */

import type { AnalysisMetrics } from '../types';

const BASELINE_KEY = 'smvVisionMetricsBaselineV2';

export interface MetricsComparison {
  baseline: AnalysisMetrics;
  latest: AnalysisMetrics;
  totalImprovementPct: number;
}

/**
 * Lee el baseline de métricas del localStorage.
 *
 * @returns El objeto AnalysisMetrics almacenado, o null si no existe.
 *          Si el JSON está corrupto, limpia la clave y devuelve null.
 */
export function readBaselineMetrics(): AnalysisMetrics | null {
  // Intenta acceder a localStorage directamente (works in browser and tests con vi.stubGlobal)
  let storage: Storage | null = null;
  try {
    storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (globalThis.localStorage as any);
  } catch {
    return null;
  }

  if (!storage) {
    return null;
  }

  const stored = storage.getItem(BASELINE_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as AnalysisMetrics;
  } catch {
    // JSON corrupto: limpiar y devolver null
    storage.removeItem(BASELINE_KEY);
    return null;
  }
}

/**
 * Compara las métricas actuales contra el baseline.
 *
 * - Primera corrida: establece el baseline y devuelve delta 0%.
 * - Siguientes corridas: calcula % de mejora/regresión en totalMs.
 *
 * @param latest Métricas de la corrida actual.
 * @returns Objeto con baseline, latest e improvement percentage.
 */
export function calculateMetricsComparison(
  latest: AnalysisMetrics,
): MetricsComparison {
  const existing = readBaselineMetrics();

  if (!existing) {
    // Primera corrida: establecer baseline
    try {
      const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (globalThis.localStorage as any);
      if (storage) {
        storage.setItem(BASELINE_KEY, JSON.stringify(latest));
      }
    } catch {
      // Silenciar si no hay acceso a localStorage
    }
    return {
      baseline: latest,
      latest,
      totalImprovementPct: 0,
    };
  }

  // Calcular mejora: (baseline - latest) / baseline * 100
  // Positivo = mejora (más rápido)
  // Negativo = regresión (más lento)
  const improvementPct = ((existing.totalMs - latest.totalMs) / existing.totalMs) * 100;

  return {
    baseline: existing,
    latest,
    totalImprovementPct: improvementPct,
  };
}
