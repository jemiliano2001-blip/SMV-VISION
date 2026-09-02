/**
 * Utilidades matemáticas y lógica de medición 3D para mallas STL en SMV-VISION.
 * 
 * Incluye:
 * - Detección automática de escala (metros vs milímetros) típica de exportaciones CAD/eDrawings.
 * - Cálculo de cota euclidiana directa y desglose ortogonal por ejes (ΔX, ΔY, ΔZ) para maquinado.
 * - Snapping magnético al vértice más cercano del triángulo intersectado.
 */

import { Vector3, type BufferAttribute } from 'three';

export type StlUnitType = 'meters' | 'millimeters' | 'inches';

export interface StlScaleInfo {
  scaleMultiplier: number;
  detectedUnit: StlUnitType;
  label: string;
}

export interface DimensionValue {
  mm: number;
  inches: number;
  mmFormatted: string;
  inFormatted: string;
}

export interface StlMeasurementResult {
  p1: { x: number; y: number; z: number };
  p2: { x: number; y: number; z: number };
  distance: DimensionValue;
  deltaX: DimensionValue;
  deltaY: DimensionValue;
  deltaZ: DimensionValue;
}

/**
 * Detecta la escala geométrica de una malla STL basándose en sus dimensiones máximas.
 * 
 * En eDrawings / SolidWorks COM, las mallas se exportan frecuentemente en metros (SI):
 * e.g. Una pieza de 38.1 mm mide 0.0381 unidades en Three.js.
 * En maquinado CNC y convencional, las piezas casi siempre miden entre 2 mm y 2000 mm.
 * Si la dimensión máxima es menor a 0.8 unidades, con certeza viene en metros y requiere escala x1000.
 */
export function detectStlUnitScale(size: { x: number; y: number; z: number }): StlScaleInfo {
  const maxDim = Math.max(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z));

  if (maxDim <= 0) {
    return {
      scaleMultiplier: 1,
      detectedUnit: 'millimeters',
      label: '1:1 (mm)',
    };
  }

  // Si la dimensión máxima es menor a 0.8 unidades, es una exportación en metros (x1000 a mm)
  if (maxDim < 0.8) {
    return {
      scaleMultiplier: 1000,
      detectedUnit: 'meters',
      label: 'Auto (Metros x1000)',
    };
  }

  return {
    scaleMultiplier: 1,
    detectedUnit: 'millimeters',
    label: '1:1 (mm)',
  };
}

/**
 * Formatea un valor en milímetros a su representación dual de taller:
 * Pulgadas milésimas (3 o 4 decimales) y milímetros (1 o 2 decimales).
 */
export function formatDimension(mm: number, precision: 3 | 4 = 3): DimensionValue {
  const inches = mm / 25.4;
  const inStr = precision === 4 ? inches.toFixed(4) : inches.toFixed(3);
  const mmStr = mm.toFixed(precision === 4 ? 2 : 1);

  return {
    mm,
    inches,
    inFormatted: `${inStr}"`,
    mmFormatted: `${mmStr} mm`,
  };
}

/**
 * Calcula la distancia tridimensional entre dos puntos y desglosa
 * los componentes ortogonales ΔX, ΔY, ΔZ útiles para carros de torno o mesa de fresado.
 */
export function calculateStlMeasurement(
  p1: Vector3 | { x: number; y: number; z: number },
  p2: Vector3 | { x: number; y: number; z: number }
): StlMeasurementResult {
  const dx = Math.abs(p2.x - p1.x);
  const dy = Math.abs(p2.y - p1.y);
  const dz = Math.abs(p2.z - p1.z);
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    p1: { x: p1.x, y: p1.y, z: p1.z },
    p2: { x: p2.x, y: p2.y, z: p2.z },
    distance: formatDimension(distance, 4),
    deltaX: formatDimension(dx, 4),
    deltaY: formatDimension(dy, 4),
    deltaZ: formatDimension(dz, 4),
  };
}

/**
 * Encuentra el vértice más cercano de un triángulo al punto de intersección del raycast.
 * 
 * Al medir en un STL, un tornero busca esquinas, caras mecanizadas o centros de aristas.
 * Esta función examina los 3 vértices del triángulo impactado y devuelve el más próximo
 * si se encuentra dentro de la distancia máxima de snap.
 */
export function findClosestVertexSnap(
  hitPoint: Vector3,
  face: { a: number; b: number; c: number },
  positionAttribute: BufferAttribute,
  snapThresholdDistance = Infinity
): { point: Vector3; isSnapped: boolean; vertexIndex: number } {
  const vA = new Vector3(
    positionAttribute.getX(face.a),
    positionAttribute.getY(face.a),
    positionAttribute.getZ(face.a)
  );
  const vB = new Vector3(
    positionAttribute.getX(face.b),
    positionAttribute.getY(face.b),
    positionAttribute.getZ(face.b)
  );
  const vC = new Vector3(
    positionAttribute.getX(face.c),
    positionAttribute.getY(face.c),
    positionAttribute.getZ(face.c)
  );

  const distA = hitPoint.distanceTo(vA);
  const distB = hitPoint.distanceTo(vB);
  const distC = hitPoint.distanceTo(vC);

  let closestVertex = vA;
  let minDist = distA;
  let closestIndex = face.a;

  if (distB < minDist) {
    minDist = distB;
    closestVertex = vB;
    closestIndex = face.b;
  }
  if (distC < minDist) {
    minDist = distC;
    closestVertex = vC;
    closestIndex = face.c;
  }

  if (minDist <= snapThresholdDistance) {
    return {
      point: closestVertex,
      isSnapped: true,
      vertexIndex: closestIndex,
    };
  }

  return {
    point: hitPoint.clone(),
    isSnapped: false,
    vertexIndex: -1,
  };
}
