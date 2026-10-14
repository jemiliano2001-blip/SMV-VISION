import { describe, expect, it } from 'vitest';
import { evidenceFileName, fitWithin, generateEvidencePdf } from '../evidencePdf';

describe('fitWithin', () => {
  it('reduce respetando proporción', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });
  it('no agranda imágenes pequeñas', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
  it('devuelve 0 con dimensiones inválidas', () => {
    expect(fitWithin(0, 100, 1600)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(NaN, 100, 1600)).toEqual({ width: 0, height: 0 });
  });
});

describe('evidenceFileName', () => {
  it('sanea el nombre de la orden', () => {
    expect(evidenceFileName('2026/S00781')).toBe('Evidencia_2026-S00781.pdf');
    expect(evidenceFileName('///')).toBe('Evidencia_orden.pdf');
  });
});

describe('generateEvidencePdf', () => {
  it('falla sin fotos', async () => {
    const res = await generateEvidencePdf({
      orderName: 'X',
      clientPo: null,
      partner: 'SUPRAJIT',
      equipmentDescription: '',
      lines: [],
      photos: [],
    });
    expect(res.ok).toBe(false);
  });
});
