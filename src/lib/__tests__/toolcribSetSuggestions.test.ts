import { describe, expect, it } from 'vitest';
import type { ToolcribActiveDrawingView } from '../../types';
import { suggestSets } from '../toolcribSetSuggestions';
import type { ToolcribSet } from '../toolcribSets';

function makeView(partNumber: string): ToolcribActiveDrawingView {
  return {
    drawingId: `id_${partNumber}`,
    partId: `part_${partNumber}`,
    partNumber,
    revision: '1',
    pdfUrl: `https://storage.mock/${partNumber}.pdf`,
    sourcePath: `${partNumber}.pdf`,
    customer: 'SUPRAJIT',
    description: '',
    sourceType: 'storage',
    stlUrl: null,
    effectiveFromUTC: '2026-01-01T00:00:00Z',
  };
}

describe('suggestSets', () => {
  const library = [
    makeView('1012-05-CHICO'),
    makeView('1012-05-GRANDE'),
    makeView('1012-05-GRANDE.ISO'),
    makeView('SOLA-777'),
    makeView('90-1012-06'),
    makeView('90-1012-06-2'),
  ];

  it('agrupa por raíz común, ignora ISO y piezas solas', () => {
    const result = suggestSets(library, []);
    expect(result.map((s) => s.root)).toEqual(['1012-05', '90-1012-06']);
    expect(result[0].partNumbers).toEqual(['1012-05-CHICO', '1012-05-GRANDE']);
  });

  it('omite grupos donde alguna pieza ya está en un juego guardado', () => {
    const saved: ToolcribSet = {
      id: 's',
      nombre: 'x',
      tipo: 'par',
      miembros: [
        { partNumber: '1012-05-CHICO', rol: 'a', orden: 1, cantidadPorJuego: 1 },
        { partNumber: '1012-05-GRANDE', rol: 'b', orden: 2, cantidadPorJuego: 1 },
      ],
    };
    expect(suggestSets(library, [saved]).map((s) => s.root)).toEqual(['90-1012-06']);
  });
});
