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
  /**
   * `true` cuando mm y pulgadas son igual de plausibles para esta malla y la
   * detección tuvo que asumir mm. El visor debe advertirlo: una cota tomada
   * bajo la suposición equivocada se va por 25.4x.
   */
  isAmbiguous: boolean;
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

/** Cota máxima (en unidades crudas) bajo la cual la malla viene en metros (SI). */
const METERS_MAX_DIM = 0.8;

/**
 * Cota máxima bajo la cual leer la malla como milímetros da una pieza que no
 * existe en un taller (menos de 3 mm de largo total), y por tanto es pulgadas.
 * 0.8"–3" = 20–76 mm, el rango más común de una pieza de Tool Crib.
 */
const INCHES_MAX_DIM = 3;

/**
 * Cota máxima por debajo de la cual mm y pulgadas son AMBAS plausibles y la
 * heurística no puede decidir: 10 unidades pueden ser una pieza chica de 10 mm
 * o una de 10" (254 mm). Se asume mm, pero se marca como ambigua para que el
 * visor pida verificación antes de que alguien tome una cota de ahí.
 */
const AMBIGUOUS_MAX_DIM = 25;

/**
 * Detecta la escala geométrica de una malla STL basándose en sus dimensiones máximas.
 *
 * En eDrawings / SolidWorks COM, las mallas se exportan frecuentemente en metros (SI):
 * e.g. Una pieza de 38.1 mm mide 0.0381 unidades en Three.js.
 * En maquinado CNC y convencional, las piezas casi siempre miden entre 2 mm y 2000 mm.
 *
 * Rangos sobre la dimensión máxima en unidades crudas:
 * - `< 0.8`  → metros (x1000). Una pieza de 0.8 mm de largo no existe.
 * - `< 3`    → pulgadas (x25.4). Un plano en sistema inglés de 2" da maxDim = 2;
 *              leerlo como mm daría 2 mm — error silencioso de 25.4x en la cota.
 * - `< 25`   → milímetros, pero AMBIGUO: 10 unidades son 10 mm o 10" (254 mm) y
 *              no hay forma de saberlo desde la geometría.
 * - `>= 25`  → milímetros (1:1), sin ambigüedad práctica.
 *
 * Un STL no declara sus unidades, así que esto es heurístico por naturaleza: por eso
 * el visor expone además un selector manual de escala que sobrescribe este resultado.
 */
export function detectStlUnitScale(size: { x: number; y: number; z: number }): StlScaleInfo {
  const maxDim = Math.max(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z));

  if (maxDim <= 0) {
    return {
      scaleMultiplier: 1,
      detectedUnit: 'millimeters',
      label: '1:1 (mm)',
      isAmbiguous: false,
    };
  }

  if (maxDim < METERS_MAX_DIM) {
    return {
      scaleMultiplier: 1000,
      detectedUnit: 'meters',
      label: 'Auto (Metros x1000)',
      isAmbiguous: false,
    };
  }

  if (maxDim < INCHES_MAX_DIM) {
    return {
      scaleMultiplier: 25.4,
      detectedUnit: 'inches',
      label: 'Auto (Pulgadas x25.4)',
      isAmbiguous: false,
    };
  }

  return {
    scaleMultiplier: 1,
    detectedUnit: 'millimeters',
    label: '1:1 (mm)',
    isAmbiguous: maxDim < AMBIGUOUS_MAX_DIM,
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
