/**
 * Grados de rugosidad ISO 1302 (números N) y equivalencia µin.
 *
 * La escala N es la que aparece en los planos ("N7", "▽▽▽") y es la referencia
 * real para saber si un Ra teórico cumple lo que pide el dibujo. Cada grado
 * duplica el anterior (serie R10/3).
 */
export interface RoughnessGrade {
  grade: string;
  raUm: number;
  raUin: number;
  /** Proceso típico que lo logra, para orientar al operador. */
  typicalProcess: string;
}

export const ISO_ROUGHNESS_GRADES: RoughnessGrade[] = [
  { grade: 'N3', raUm: 0.1, raUin: 4, typicalProcess: 'Lapeado / superacabado' },
  { grade: 'N4', raUm: 0.2, raUin: 8, typicalProcess: 'Rectificado fino / honeado' },
  { grade: 'N5', raUm: 0.4, raUin: 16, typicalProcess: 'Rectificado / torneado diamante' },
  { grade: 'N6', raUm: 0.8, raUin: 32, typicalProcess: 'Torneado/fresado de acabado fino' },
  { grade: 'N7', raUm: 1.6, raUin: 63, typicalProcess: 'Torneado/fresado de acabado' },
  { grade: 'N8', raUm: 3.2, raUin: 125, typicalProcess: 'Torneado/fresado semi-acabado' },
  { grade: 'N9', raUm: 6.3, raUin: 250, typicalProcess: 'Desbaste controlado' },
  { grade: 'N10', raUm: 12.5, raUin: 500, typicalProcess: 'Desbaste' },
  { grade: 'N11', raUm: 25, raUin: 1000, typicalProcess: 'Corte basto / sierra' },
];

/** Grado N que CUMPLE un Ra dado (el primero cuyo límite es ≥ Ra). */
export function classifyRa(raUm: number): RoughnessGrade {
  const safe = Math.max(raUm, 0);
  return ISO_ROUGHNESS_GRADES.find((g) => safe <= g.raUm) ?? ISO_ROUGHNESS_GRADES[ISO_ROUGHNESS_GRADES.length - 1];
}

/**
 * Avance máximo (mm/rev) para lograr un Ra objetivo con un radio de punta r.
 * Inversa de Ra ≈ fn² / (32 · r) · 1000.
 */
export function maxFeedForRa(targetRaUm: number, noseRadiusMm: number): number {
  const r = Math.max(noseRadiusMm, 0.05);
  const ra = Math.max(targetRaUm, 0.01);
  return Math.sqrt((ra * 32 * r) / 1000);
}

/**
 * Altura de cresta teórica Rt (µm) que deja el avance entre dos vueltas:
 * Rt ≈ fn² / (8 · r). Es lo que se ve como "escalones" en la pieza.
 */
export function theoreticalPeakToValleyUm(feedMm: number, noseRadiusMm: number): number {
  const r = Math.max(noseRadiusMm, 0.05);
  const f = Math.max(feedMm, 0);
  return (f * f) / (8 * r) * 1000;
}
