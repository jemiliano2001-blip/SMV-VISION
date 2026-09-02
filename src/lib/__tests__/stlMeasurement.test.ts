import { describe, it, expect } from 'vitest';
import { Vector3, Float32BufferAttribute } from 'three';
import {
  detectStlUnitScale,
  formatDimension,
  calculateStlMeasurement,
  findClosestVertexSnap,
} from '../stlMeasurement';

describe('stlMeasurement utilities', () => {
  describe('detectStlUnitScale', () => {
    it('detecta exportaciones en metros de eDrawings (ej. maxDim = 0.0381 m)', () => {
      const eDrawingsPiece = { x: 0.0247, y: 0.0381, z: 0.0247 };
      const scale = detectStlUnitScale(eDrawingsPiece);

      expect(scale.scaleMultiplier).toBe(1000);
      expect(scale.detectedUnit).toBe('meters');
      expect(scale.label).toContain('Auto');
    });

    it('detecta exportaciones directas en milímetros (ej. maxDim = 38.1 mm)', () => {
      const mmPiece = { x: 24.7, y: 38.1, z: 24.7 };
      const scale = detectStlUnitScale(mmPiece);

      expect(scale.scaleMultiplier).toBe(1);
      expect(scale.detectedUnit).toBe('millimeters');
      expect(scale.label).toBe('1:1 (mm)');
      expect(scale.isAmbiguous).toBe(false);
    });

    it('detecta exportaciones en pulgadas (ej. pieza de 2" → maxDim = 2)', () => {
      // Antes caía en el else y se reportaba como 2 mm: error silencioso de 25.4x.
      const inchPiece = { x: 1.25, y: 2, z: 0.875 };
      const scale = detectStlUnitScale(inchPiece);

      expect(scale.scaleMultiplier).toBe(25.4);
      expect(scale.detectedUnit).toBe('inches');
      expect(scale.isAmbiguous).toBe(false);
    });

    it('marca como ambigua la banda donde mm y pulgadas son ambas plausibles', () => {
      // 10 unidades = 10 mm (pieza chica) o 10" (254 mm). No es decidible.
      const ambiguous = { x: 6, y: 10, z: 4 };
      const scale = detectStlUnitScale(ambiguous);

      expect(scale.scaleMultiplier).toBe(1);
      expect(scale.detectedUnit).toBe('millimeters');
      expect(scale.isAmbiguous).toBe(true);
    });

    it('no marca ambigüedad en piezas grandes donde mm es la única lectura sensata', () => {
      const large = { x: 120, y: 300, z: 45 };
      const scale = detectStlUnitScale(large);

      expect(scale.scaleMultiplier).toBe(1);
      expect(scale.isAmbiguous).toBe(false);
    });

    it('maneja piezas con medidas vacías o en cero', () => {
      const empty = { x: 0, y: 0, z: 0 };
      const scale = detectStlUnitScale(empty);

      expect(scale.scaleMultiplier).toBe(1);
      expect(scale.detectedUnit).toBe('millimeters');
      expect(scale.isAmbiguous).toBe(false);
    });
  });

  describe('formatDimension', () => {
    it('convierte milímetros a pulgadas con formato de taller (ej. 25.4 mm = 1.000")', () => {
      const dim = formatDimension(25.4, 3);

      expect(dim.mm).toBe(25.4);
      expect(dim.inches).toBeCloseTo(1.0, 4);
      expect(dim.inFormatted).toBe('1.000"');
      expect(dim.mmFormatted).toBe('25.4 mm');
    });

    it('soporta precisión de 4 decimales para cotas mecánicas finas', () => {
      const dim = formatDimension(38.1, 4);

      expect(dim.inFormatted).toBe('1.5000"');
      expect(dim.mmFormatted).toBe('38.10 mm');
    });
  });

  describe('calculateStlMeasurement', () => {
    it('calcula distancia euclidiana y proyecciones ΔX, ΔY, ΔZ', () => {
      const p1 = new Vector3(0, 0, 0);
      const p2 = new Vector3(30, 40, 0); // Triángulo 3-4-5 -> hipotenusa 50

      const result = calculateStlMeasurement(p1, p2);

      expect(result.distance.mm).toBe(50);
      expect(result.deltaX.mm).toBe(30);
      expect(result.deltaY.mm).toBe(40);
      expect(result.deltaZ.mm).toBe(0);

      expect(result.distance.inFormatted).toBe('1.9685"');
      expect(result.deltaX.inFormatted).toBe('1.1811"');
      expect(result.deltaY.inFormatted).toBe('1.5748"');
      expect(result.deltaZ.inFormatted).toBe('0.0000"');
    });

    it('calcula distancias 3D diagonales correctamente', () => {
      const p1 = { x: 10, y: 10, z: 10 };
      const p2 = { x: 20, y: 30, z: 30 };
      // dx = 10, dy = 20, dz = 20 -> sqrt(100 + 400 + 400) = sqrt(900) = 30

      const result = calculateStlMeasurement(p1, p2);

      expect(result.distance.mm).toBe(30);
      expect(result.deltaX.mm).toBe(10);
      expect(result.deltaY.mm).toBe(20);
      expect(result.deltaZ.mm).toBe(20);
    });
  });

  describe('findClosestVertexSnap', () => {
    it('hace snap al vértice más cercano del triángulo si está dentro del umbral', () => {
      // Triángulo con vértices en (0,0,0), (10,0,0), (0,10,0)
      const positions = new Float32Array([
        0, 0, 0,    // index 0
        10, 0, 0,   // index 1
        0, 10, 0,   // index 2
      ]);
      const attr = new Float32BufferAttribute(positions, 3);
      const face = { a: 0, b: 1, c: 2 };

      // Punto de impacto cercano al vértice 1 (10, 0, 0)
      const hitPoint = new Vector3(9.2, 0.4, 0.1);
      const snap = findClosestVertexSnap(hitPoint, face, attr, 2.0);

      expect(snap.isSnapped).toBe(true);
      expect(snap.vertexIndex).toBe(1);
      expect(snap.point.x).toBe(10);
      expect(snap.point.y).toBe(0);
      expect(snap.point.z).toBe(0);
    });

    it('no hace snap si el vértice más cercano supera el umbral de distancia', () => {
      const positions = new Float32Array([
        0, 0, 0,
        100, 0, 0,
        0, 100, 0,
      ]);
      const attr = new Float32BufferAttribute(positions, 3);
      const face = { a: 0, b: 1, c: 2 };

      // Punto en el centro del triángulo
      const hitPoint = new Vector3(33, 33, 0);
      const snap = findClosestVertexSnap(hitPoint, face, attr, 5.0);

      expect(snap.isSnapped).toBe(false);
      expect(snap.vertexIndex).toBe(-1);
      expect(snap.point.x).toBeCloseTo(33);
      expect(snap.point.y).toBeCloseTo(33);
    });
  });
});
