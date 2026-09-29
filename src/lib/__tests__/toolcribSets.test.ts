import { describe, expect, it } from 'vitest';
import type { ToolcribActiveDrawingView } from '../../types';
import {
  baseQuantityFactor,
  companionsFromSet,
  findSavedSetForPart,
  getActiveSets,
  normalizeSet,
  quantityForMember,
  reconcileSets,
  setActiveSets,
  type ToolcribSet,
} from '../toolcribSets';

function makeView(partNumber: string, extra: Partial<ToolcribActiveDrawingView> = {}): ToolcribActiveDrawingView {
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
    ...extra,
  };
}

const par: ToolcribSet = {
  id: 's1',
  nombre: 'Hex Swage Block',
  tipo: 'par',
  miembros: [
    { partNumber: '1012-05-CHICO', rol: 'Mitad Chica', orden: 1, cantidadPorJuego: 1 },
    { partNumber: '1012-05-GRANDE', rol: 'Mitad Grande', orden: 2, cantidadPorJuego: 2 },
  ],
};

describe('toolcribSets — búsqueda y compañeros', () => {
  it('encuentra el juego sin importar mayúsculas ni sufijo .ISO', () => {
    expect(findSavedSetForPart('1012-05-chico', [par])?.id).toBe('s1');
    expect(findSavedSetForPart('1012-05-GRANDE.ISO', [par])?.id).toBe('s1');
    expect(findSavedSetForPart('OTRA-PIEZA', [par])).toBeNull();
  });

  it('devuelve null si la pieza no está en ningún juego guardado', () => {
    expect(companionsFromSet('OTRA-PIEZA', [makeView('OTRA-PIEZA')], [par])).toBeNull();
  });

  it('devuelve los hermanos del juego con rol, orden y cantidad por juego', () => {
    const library = [makeView('1012-05-CHICO'), makeView('1012-05-GRANDE'), makeView('1012-05-GRANDE.ISO')];
    const companions = companionsFromSet('1012-05-CHICO', library, [par]);
    expect(companions).toHaveLength(1);
    expect(companions[0].drawing.partNumber).toBe('1012-05-GRANDE');
    expect(companions[0].label).toBe('Mitad Grande');
    expect(companions[0].type).toBe('pair');
    expect(companions[0].order).toBe(2);
    expect(companions[0].cantidadPorJuego).toBe(2);
  });

  it('con varias revisiones activas del hermano elige la preferida (la más reciente)', () => {
    const old = makeView('1012-05-GRANDE', { drawingId: 'old', revision: '1', effectiveFromUTC: '2025-01-01T00:00:00Z' });
    const recent = makeView('1012-05-GRANDE', { drawingId: 'new', revision: '2', effectiveFromUTC: '2026-06-01T00:00:00Z' });
    const companions = companionsFromSet('1012-05-CHICO', [makeView('1012-05-CHICO'), old, recent], [par]);
    expect(companions).toHaveLength(1);
    expect(companions[0].drawing.drawingId).toBe('new');
  });

  it('con juego guardado pero hermano ausente del catálogo devuelve [] (no cae a reglas)', () => {
    expect(companionsFromSet('1012-05-CHICO', [makeView('1012-05-CHICO')], [par])).toEqual([]);
  });

  it('factor de cantidad de la pieza base (1 si no hay juego)', () => {
    expect(baseQuantityFactor('1012-05-GRANDE', [par])).toBe(2);
    expect(baseQuantityFactor('NADA', [par])).toBe(1);
  });

  it('cantidad = juegos × cantidad por juego, entera', () => {
    expect(quantityForMember(10, 2)).toBe(20);
    expect(quantityForMember(3, 1)).toBe(3);
  });

  it('almacén en memoria de juegos activos', () => {
    setActiveSets([par]);
    expect(getActiveSets()).toHaveLength(1);
    setActiveSets([]);
    expect(getActiveSets()).toHaveLength(0);
  });
});

describe('toolcribSets — normalizeSet', () => {
  const valid = {
    id: 'a',
    nombre: 'Juego',
    tipo: 'par',
    miembros: [
      { partNumber: 'x-1', rol: 'A', orden: 1, cantidadPorJuego: 1 },
      { partNumber: 'x-2', rol: 'B', orden: 2, cantidadPorJuego: 1 },
    ],
  };

  it('acepta un documento válido y canoniza los números de parte', () => {
    const set = normalizeSet(valid);
    expect(set?.miembros.map((m) => m.partNumber)).toEqual(['X-1', 'X-2']);
  });

  it('rechaza tipo inválido, menos de 2 miembros, duplicados y más de 8', () => {
    expect(normalizeSet({ ...valid, tipo: 'otro' })).toBeNull();
    expect(normalizeSet({ ...valid, miembros: [valid.miembros[0]] })).toBeNull();
    expect(normalizeSet({ ...valid, miembros: [valid.miembros[0], valid.miembros[0]] })).toBeNull();
    const nine = Array.from({ length: 9 }, (_, i) => ({ partNumber: `p-${i}`, rol: 'r', orden: i + 1, cantidadPorJuego: 1 }));
    expect(normalizeSet({ ...valid, miembros: nine })).toBeNull();
    expect(normalizeSet(null)).toBeNull();
  });

  it('cantidadPorJuego 0, negativa o decimal se reemplaza por 1', () => {
    const set = normalizeSet({
      ...valid,
      miembros: [
        { partNumber: 'x-1', rol: 'A', orden: 1, cantidadPorJuego: 0 },
        { partNumber: 'x-2', rol: 'B', orden: 2, cantidadPorJuego: 1.5 },
      ],
    });
    expect(set?.miembros.map((m) => m.cantidadPorJuego)).toEqual([1, 1]);
  });
});

describe('toolcribSets — reconcileSets (una pieza, un juego)', () => {
  const mk = (id: string, parts: string[]): ToolcribSet => ({
    id,
    nombre: id,
    tipo: 'par',
    miembros: parts.map((p, i) => ({ partNumber: p, rol: p, orden: i + 1, cantidadPorJuego: 1 })),
  });

  it('borra el juego viejo si queda con menos de 2 miembros', () => {
    const result = reconcileSets([mk('A', ['X', 'Y', 'Z'])], mk('B', ['Y', 'Z']));
    expect(result.toDelete).toEqual(['A']);
    expect(result.toUpdate).toEqual([]);
  });

  it('actualiza el juego viejo si aún le quedan 2 o más', () => {
    const result = reconcileSets([mk('A', ['X', 'Y', 'Z', 'W'])], mk('B', ['Y', 'Z']));
    expect(result.toDelete).toEqual([]);
    expect(result.toUpdate[0].miembros.map((m) => m.partNumber)).toEqual(['X', 'W']);
  });

  it('ignora el propio juego guardado y los juegos sin traslape', () => {
    const result = reconcileSets([mk('B', ['Y', 'Z']), mk('C', ['P', 'Q'])], mk('B', ['Y', 'Z']));
    expect(result).toEqual({ toDelete: [], toUpdate: [] });
  });
});
