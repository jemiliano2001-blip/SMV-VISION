import { describe, it, expect } from 'vitest';
import {
  describeIsometricView,
  formatCajetinLine,
  purchaseRowKey,
} from '../reportViewMeta';

describe('reportViewMeta', () => {
  it('labels ISO eDrawings vs CAD vs IA vs empty', () => {
    expect(describeIsometricView({
      isometricView: 'data:image/jpeg;base64,x',
      sourcePdfName: '90-1012-05.ISO.pdf',
      isometricSource: 'crop',
    })).toBe('ISO eDrawings');

    expect(describeIsometricView({
      isometricView: 'data:image/jpeg;base64,x',
      sourcePdfName: '90-1012-05.pdf',
      isometricSource: 'crop',
    })).toBe('Recorte CAD');

    expect(describeIsometricView({
      isometricView: 'data:image/png;base64,x',
      sourcePdfName: '90-1012-05.pdf',
      isometricSource: 'ai-generated',
    })).toBe('IA Generado');

    expect(describeIsometricView({})).toBe('Sin vista');
  });

  it('builds purchase row keys and cajetin lines', () => {
    expect(purchaseRowKey({
      orden: '2026/S001\nextra',
      numero_parte: '90-1',
      pieza: 'PUNZON',
    })).toBe('2026/S001|90-1|PUNZON');

    expect(formatCajetinLine({
      material: 'D2',
      dureza: '60 HRC',
      tratamiento: null,
      acabado: null,
    })).toBe('Mat: D2 · Dur: 60 HRC');

    expect(formatCajetinLine({})).toBeNull();
  });
});
