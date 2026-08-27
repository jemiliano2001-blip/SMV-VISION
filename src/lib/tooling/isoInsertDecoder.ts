import type {
  DecodedInsert,
  InsertShapeCode,
  InsertClearanceCode,
  InsertToleranceCode,
  InsertFixingCode,
} from './types';

const SHAPE_MAP: Record<InsertShapeCode, { name: string; angle: number; desc: string; edges: number }> = {
  C: { name: 'Rombo 80°', angle: 80, desc: 'Forma universal y robusta para desbaste y acabado general.', edges: 4 },
  D: { name: 'Rombo 55°', angle: 55, desc: 'Perfilado y contorneado con acceso a socavados y caras.', edges: 4 },
  W: { name: 'Trígono 80°', angle: 80, desc: 'Alta economía: 6 filos útiles con la misma resistencia que un rombo 80°.', edges: 6 },
  T: { name: 'Triángulo 60°', angle: 60, desc: '6 filos en negativo o 3 en positivo. Desbaste ligero y roscado.', edges: 6 },
  S: { name: 'Cuadrado 90°', angle: 90, desc: 'Máxima resistencia de arista (8 filos en negativo). Desbaste pesado.', edges: 8 },
  R: { name: 'Redondo / Botón', angle: 360, desc: 'Ideal para radios grandes, ranurado toroidal y materiales difíciles.', edges: 8 },
  V: { name: 'Rombo 35°', angle: 35, desc: 'Perfilado fino y acabado de detalles estrechos. Arista más frágil.', edges: 4 },
  A: { name: 'Paralelogramo 85°', angle: 85, desc: 'Común en insertos de fresado de escuadra (APKT, APMT).', edges: 2 },
  K: { name: 'Paralelogramo 55°', angle: 55, desc: 'Perfilado en fresado y tronzado especial.', edges: 2 },
};

const CLEARANCE_MAP: Record<InsertClearanceCode, { angle: number; type: 'negative' | 'positive'; desc: string }> = {
  N: { angle: 0, type: 'negative', desc: '0° Desahogo (Negativo). Reversible por ambas caras, duplica los filos.' },
  C: { angle: 7, type: 'positive', desc: '7° Positivo. Bajo empuje radial, ideal para mandrinado interior y piezas esbeltas.' },
  P: { angle: 11, type: 'positive', desc: '11° Positivo. Filo positivo agresivo para aluminio, plásticos o fresado APKT.' },
  B: { angle: 5, type: 'positive', desc: '5° Positivo. Desahogo ligero para materiales tenaces.' },
  D: { angle: 15, type: 'positive', desc: '15° Positivo. Corte muy suave para acabado de interiores.' },
  E: { angle: 20, type: 'positive', desc: '20° Positivo. Común en insertos de fresado SEKT.' },
  F: { angle: 25, type: 'positive', desc: '25° Positivo. Acabado de materiales blandos.' },
  G: { angle: 30, type: 'positive', desc: '30° Positivo. Muy positivo para plásticos y maderas.' },
  O: { angle: 0, type: 'negative', desc: 'Especial o fabricante.' },
};

const TOLERANCE_MAP: Record<InsertToleranceCode, string> = {
  M: 'Clase M (Industrial estándar): Tolerancia en espesor ±0.13mm, IC ±0.05 a ±0.13mm.',
  G: 'Clase G (Rectificado de precisión): Perímetro rectificado para tolerancias estrechas.',
  E: 'Clase E (Alta precisión): Tolerancia rectificada ±0.025mm.',
  C: 'Clase C (Tolerancia estándar compacta).',
  A: 'Clase A (Ultra precisión rectificada para moldes).',
  F: 'Clase F (Tolerancia fina).',
  H: 'Clase H (Tolerancia alta para insertos de acabado).',
  J: 'Clase J (Tolerancia media).',
  K: 'Clase K (Tolerancia amplia).',
  L: 'Clase L (Tolerancia para desbaste pesado).',
  U: 'Clase U (Sin rectificar perimetralmente, económico).',
};

const FIXING_MAP: Record<InsertFixingCode, { desc: string; hole: boolean; angle?: string }> = {
  G: { desc: 'Agujero cilíndrico central + rompevirutas en ambas caras.', hole: true },
  M: { desc: 'Agujero cilíndrico central + rompevirutas en una sola cara.', hole: true },
  T: { desc: 'Agujero con avellanado 40°-60° para tornillo cónico Torx (fijación por tornillo).', hole: true, angle: '40°-60°' },
  W: { desc: 'Agujero con avellanado doble 70°-90°.', hole: true, angle: '70°-90°' },
  N: { desc: 'Sin agujero central (sujeción sólo por brida superior / clamp de presión).', hole: false },
  R: { desc: 'Sin agujero central con rompevirutas en una cara.', hole: false },
  X: { desc: 'Diseño especial de sujeción del fabricante.', hole: true },
  A: { desc: 'Agujero cilíndrico sin rompevirutas.', hole: true },
  F: { desc: 'Agujero con rompevirutas especial para fresado.', hole: true },
};

/**
 * Genera puntos poligonales SVG en escala 100x100 para dibujar el inserto en pantalla.
 */
function generateSvgPoints(shape: InsertShapeCode): { x: number; y: number }[] {
  switch (shape) {
    case 'C': // Rombo 80°
      return [
        { x: 50, y: 10 },
        { x: 88, y: 50 },
        { x: 50, y: 90 },
        { x: 12, y: 50 },
      ];
    case 'D': // Rombo 55°
      return [
        { x: 50, y: 5 },
        { x: 92, y: 50 },
        { x: 50, y: 95 },
        { x: 8, y: 50 },
      ];
    case 'W': // Trígono 80°
      return [
        { x: 50, y: 10 },
        { x: 75, y: 28 },
        { x: 90, y: 65 },
        { x: 62, y: 78 },
        { x: 20, y: 85 },
        { x: 30, y: 45 },
      ];
    case 'T': // Triángulo 60°
      return [
        { x: 50, y: 12 },
        { x: 90, y: 82 },
        { x: 10, y: 82 },
      ];
    case 'S': // Cuadrado 90°
      return [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 80 },
        { x: 20, y: 80 },
      ];
    case 'V': // Rombo 35°
      return [
        { x: 50, y: 5 },
        { x: 95, y: 50 },
        { x: 50, y: 95 },
        { x: 5, y: 50 },
      ];
    case 'A': // Paralelogramo 85°
      return [
        { x: 30, y: 15 },
        { x: 85, y: 15 },
        { x: 70, y: 85 },
        { x: 15, y: 85 },
      ];
    case 'R': // Redondo
    default:
      return [
        { x: 50, y: 10 },
        { x: 90, y: 50 },
        { x: 50, y: 90 },
        { x: 10, y: 50 },
      ];
  }
}

/**
 * Decodifica un código ISO 1832 o ANSI de inserto (ej. CNMG 120408, WNMG 432, APKT 1604, CCMT 09T304).
 */
export function decodeInsertCode(rawInput: string): DecodedInsert | null {
  if (!rawInput) return null;
  const clean = rawInput.trim().toUpperCase().replace(/[\s\-_]+/g, '');
  if (clean.length < 4) return null;

  const shapeChar = (clean[0] || 'C') as InsertShapeCode;
  const clearanceChar = (clean[1] || 'N') as InsertClearanceCode;
  const toleranceChar = (clean[2] || 'M') as InsertToleranceCode;
  const fixingChar = (clean[3] || 'G') as InsertFixingCode;

  const shapeInfo = SHAPE_MAP[shapeChar] || SHAPE_MAP.C;
  const clearanceInfo = CLEARANCE_MAP[clearanceChar] || CLEARANCE_MAP.N;
  const toleranceInfo = TOLERANCE_MAP[toleranceChar] || TOLERANCE_MAP.M;
  const fixingInfo = FIXING_MAP[fixingChar] || FIXING_MAP.G;

  // Extraer números posteriores
  const numericPart = clean.slice(4);
  let sizeCode = '12';
  let thickCode = '04';
  let radiusCode = '08';
  let chipbreaker: string | undefined = undefined;

  // Detección ANSI vs ISO (ej. 432 -> Size 4 = 1/2", Thick 3 = 3/16", Radius 2 = 1/32")
  if (numericPart.length === 3 && /^\d{3}$/.test(numericPart)) {
    // ANSI: 432
    const s = numericPart[0];
    const t = numericPart[1];
    const r = numericPart[2];
    sizeCode = s === '4' ? '12' : s === '3' ? '09' : s === '2' ? '06' : '12';
    thickCode = t === '3' ? '04' : t === '2' ? '03' : '04';
    radiusCode = r === '2' ? '08' : r === '1' ? '04' : r === '4' ? '16' : '08';
  } else if (numericPart.length >= 6) {
    sizeCode = numericPart.slice(0, 2);
    thickCode = numericPart.slice(2, 4);
    radiusCode = numericPart.slice(4, 6);
    if (numericPart.length > 6) {
      chipbreaker = numericPart.slice(6);
    }
  } else if (numericPart.length === 4) {
    // ej. APKT 1604
    sizeCode = numericPart.slice(0, 2);
    thickCode = numericPart.slice(2, 4);
    radiusCode = '08';
  }

  // Dimensiones métricas e imperiales aproximadas
  const edgeLengthMm = Number.parseInt(sizeCode, 10) || 12;
  const icInch = edgeLengthMm >= 15 ? '5/8"' : edgeLengthMm >= 11 ? '1/2"' : edgeLengthMm >= 8 ? '3/8"' : '1/4"';
  const icMm = edgeLengthMm >= 15 ? 15.875 : edgeLengthMm >= 11 ? 12.7 : edgeLengthMm >= 8 ? 9.525 : 6.35;

  const thicknessMm = thickCode === '04' ? 4.76 : thickCode === '03' || thickCode === 'T3' ? 3.97 : thickCode === '02' ? 2.38 : 4.76;
  const thicknessInch = thickCode === '04' ? '3/16"' : thickCode === '03' ? '5/32"' : thickCode === '02' ? '3/32"' : '3/16"';

  const radiusMm = radiusCode === '08' ? 0.8 : radiusCode === '04' ? 0.4 : radiusCode === '12' ? 1.2 : radiusCode === '02' ? 0.2 : radiusCode === '16' ? 1.6 : 0.8;
  const radiusInch = radiusCode === '08' ? '1/32" (0.031")' : radiusCode === '04' ? '1/64" (0.015")' : radiusCode === '12' ? '3/64" (0.047")' : '1/32"';

  const idealFinish = radiusMm >= 0.8
    ? 'Desbaste medio a pesado (alta resistencia de punta y soporte para avance alto).'
    : radiusMm === 0.4
      ? 'Acabado fino a medio (bajo empuje radial, excelente para paredes delgadas y ejes esbeltos).'
      : 'Superacabado / perfilado de precisión.';

  // Portas compatibles
  const compatibleHolders: string[] = [];
  if (shapeChar === 'W' && clearanceChar === 'N') {
    compatibleHolders.push('MWLNR / MWLNL 2525 M08 (Zanco 1")', 'MWLNR / MWLNL 2020 K08 (Zanco 3/4")', 'MWLNR 16-4D (Haas)');
  } else if (shapeChar === 'C' && clearanceChar === 'N') {
    compatibleHolders.push('MCLNR / MCLNL 2525 M12 (Zanco 1")', 'DCLNR / DCLNL 2525 M12', 'PCLNR 2525 M12', 'MCLNR 16-4D (Haas)');
  } else if (shapeChar === 'D' && clearanceChar === 'N') {
    compatibleHolders.push('MDJNR / MDJNL 2525 M11', 'MDJNR 16-4D', 'PDJNR 2525 M11');
  } else if (shapeChar === 'C' && clearanceChar === 'C') {
    compatibleHolders.push('Barra de Interiores S20S-SCLCR 09 (Dia 20mm)', 'Barra S25S-SCLCR 09 (Dia 25mm / 1")', 'S16Q-SCLCR 09');
  } else if (shapeChar === 'D' && clearanceChar === 'C') {
    compatibleHolders.push('Barra de Mandrinar S20S-SDUCR 11', 'Porta Exterior SDJCR 2020 K11');
  } else if (shapeChar === 'A' && clearanceChar === 'P') {
    compatibleHolders.push('Cabezal de Fresado BAP 300R (Dia 1" a 2")', 'Fresa de Escuadra 90° APKT 1604');
  }

  const recommendedOperations: string[] = [];
  if (clearanceChar === 'N') {
    recommendedOperations.push('Torneado exterior desbaste y semi-acabado');
    recommendedOperations.push('Corte interrumpido (alta rigidez)');
  } else {
    recommendedOperations.push('Mandrinado interior / Interiores profundos');
    recommendedOperations.push('Acabado fino con bajo empuje radial');
  }

  return {
    rawCode: rawInput,
    normalizedCode: `${shapeChar}${clearanceChar}${toleranceChar}${fixingChar} ${sizeCode}${thickCode}${radiusCode}${chipbreaker ? `-${chipbreaker}` : ''}`,
    shape: {
      letter: shapeChar,
      name: shapeInfo.name,
      angleDegrees: shapeInfo.angle,
      description: shapeInfo.desc,
      cuttingEdges: shapeInfo.edges,
    },
    clearance: {
      letter: clearanceChar,
      angleDegrees: clearanceInfo.angle,
      type: clearanceInfo.type,
      description: clearanceInfo.desc,
    },
    tolerance: {
      letter: toleranceChar,
      description: toleranceInfo,
    },
    fixing: {
      letter: fixingChar,
      description: fixingInfo.desc,
      hole: fixingInfo.hole,
      countersinkAngle: fixingInfo.angle,
    },
    size: {
      code: sizeCode,
      cuttingEdgeLengthMm: edgeLengthMm,
      inscribedCircleMm: icMm,
      inscribedCircleInch: icInch,
    },
    thickness: {
      code: thickCode,
      thicknessMm,
      thicknessInch,
    },
    noseRadius: {
      code: radiusCode,
      radiusMm,
      radiusInch,
      idealFinish,
    },
    chipbreaker,
    recommendedOperations,
    compatibleHolders,
    svgPoints: generateSvgPoints(shapeChar),
  };
}
