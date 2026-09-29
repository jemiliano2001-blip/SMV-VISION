import { describe, expect, it } from 'vitest';
import type { ToolcribActiveDrawingView } from '../../types';
import {
  extractBasePartRoot,
  findCompanionDrawings,
  formatCompanionsSummary,
  knownRuleGroupKey,
} from '../companionDrawings';
import type { ToolcribSet } from '../toolcribSets';

function makeView(partial: Partial<ToolcribActiveDrawingView> & { partNumber: string }): ToolcribActiveDrawingView {
  return {
    drawingId: partial.drawingId || `id_${partial.partNumber}`,
    partId: partial.partId || `part_${partial.partNumber}`,
    partNumber: partial.partNumber,
    revision: partial.revision || '1',
    pdfUrl: partial.pdfUrl || `https://storage.mock/${partial.partNumber}.pdf`,
    sourcePath: partial.sourcePath || `${partial.partNumber}.pdf`,
    customer: partial.customer || 'SUPRAJIT',
    description: partial.description || '',
    sourceType: 'storage',
    stlUrl: partial.stlUrl ?? null,
    effectiveFromUTC: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('companionDrawings - Raíz de números de parte', () => {
  it('extrae la raíz eliminando sufijos de hojas, pares y complementos', () => {
    expect(extractBasePartRoot('90-1012-06-2')).toBe('90-1012-06');
    expect(extractBasePartRoot('90-1012-06-2.ISO')).toBe('90-1012-06');
    expect(extractBasePartRoot('1012-05-CHICO')).toBe('1012-05');
    expect(extractBasePartRoot('1012-05-GRANDE')).toBe('1012-05');
    expect(extractBasePartRoot('4150-06-CORTO')).toBe('4150-06');
    expect(extractBasePartRoot('4150-06-LARGO')).toBe('4150-06');
    expect(extractBasePartRoot('90-4150-06 -A')).toBe('90-4150-06');
    expect(extractBasePartRoot('90-4150-06 -B MOD 24-01-2025')).toBe('90-4150-06');
    expect(extractBasePartRoot('143272-1-1 COMPLEMENTO')).toBe('143272-1-1');
  });
});

describe('companionDrawings - Detección para piezas del taller', () => {
  const library: ToolcribActiveDrawingView[] = [
    // 90-1012-06 (2 hojas)
    makeView({ partNumber: '90-1012-06', description: 'Punzón de corte' }),
    makeView({ partNumber: '90-1012-06.ISO', description: 'Isométrico punzón 06' }),
    makeView({ partNumber: '90-1012-06-2', description: 'Punzón hoja 2' }),

    // 90-1012-05 (Chico y Grande)
    makeView({ partNumber: '90-1012-05', description: 'Hex swage block' }),
    makeView({ partNumber: '1012-05-CHICO', description: 'Hex swage block mitad chica' }),
    makeView({ partNumber: '1012-05-GRANDE', description: 'Hex swage block mitad grande' }),
    makeView({ partNumber: '90-1012-05.ISO', description: 'Isométrico swage block' }),

    // 90-4150-06 (Corto y Largo / Sets)
    makeView({ partNumber: '90-4150-06', description: 'Juego de gavilanes' }),
    makeView({ partNumber: '4150-06-CORTO', description: 'Gavilán corto' }),
    makeView({ partNumber: '4150-06-LARGO', description: 'Gavilán largo' }),
    makeView({ partNumber: '4150-06.ISO', description: 'Isométrico gavilán' }),

    // Navajas Artos 143272 (Base y Complemento)
    makeView({ partNumber: '143272-1-1', description: 'Navaja Artos base' }),
    makeView({ partNumber: '143272-1-1 COMPLEMENTO', description: 'Navaja Artos complemento' }),

    // Otra pieza cualquiera no relacionada
    makeView({ partNumber: '386306', description: 'Buje guía' }),
  ];

  it('detecta la Hoja 2 para 90-1012-06 excluyendo el ISO', () => {
    const companions = findCompanionDrawings('90-1012-06', library);
    expect(companions).toHaveLength(1);
    expect(companions[0].drawing.partNumber).toBe('90-1012-06-2');
    expect(companions[0].type).toBe('sheet');
    expect(companions[0].label).toContain('Hoja 2');
  });

  it('detecta la Hoja 1 si la pieza base consultada es 90-1012-06-2', () => {
    const companions = findCompanionDrawings('90-1012-06-2', library);
    expect(companions).toHaveLength(1);
    expect(companions[0].drawing.partNumber).toBe('90-1012-06');
    expect(companions[0].type).toBe('sheet');
  });

  it('detecta las dos mitades (Chico y Grande) para 90-1012-05', () => {
    const companions = findCompanionDrawings('90-1012-05', library);
    const parts = companions.map((c) => c.drawing.partNumber);
    expect(parts).toContain('1012-05-CHICO');
    expect(parts).toContain('1012-05-GRANDE');
    expect(companions.every((c) => c.type === 'pair')).toBe(true);
  });

  it('detecta la mitad Grande si la base es 1012-05-CHICO', () => {
    const companions = findCompanionDrawings('1012-05-CHICO', library);
    expect(companions.some((c) => c.drawing.partNumber === '1012-05-GRANDE')).toBe(true);
  });

  it('detecta el par Corto y Largo para 90-4150-06', () => {
    const companions = findCompanionDrawings('90-4150-06', library);
    const parts = companions.map((c) => c.drawing.partNumber);
    expect(parts).toContain('4150-06-CORTO');
    expect(parts).toContain('4150-06-LARGO');
  });

  it('detecta el Complemento para Navaja Artos 143272-1-1', () => {
    const companions = findCompanionDrawings('143272-1-1', library);
    expect(companions).toHaveLength(1);
    expect(companions[0].drawing.partNumber).toBe('143272-1-1 COMPLEMENTO');
    expect(companions[0].type).toBe('complement');
  });

  it('devuelve arreglo vacío para una pieza sin hojas secundarias ni pares', () => {
    const companions = findCompanionDrawings('386306', library);
    expect(companions).toEqual([]);
  });

  it('formatea un resumen legible de compañeros', () => {
    const companions = findCompanionDrawings('90-1012-06', library);
    const summary = formatCompanionsSummary('90-1012-06', companions);
    expect(summary).toBe('2 planos: 90-1012-06 + 90-1012-06-2 (Hoja 2 (Componente secundario))');
  });
});

describe('companionDrawings — juegos guardados y reglas fijas', () => {
  const library = [
    makeView({ partNumber: 'ZZ-100-IZQ' }),
    makeView({ partNumber: 'ZZ-100-DER' }),
    makeView({ partNumber: '1012-05-CHICO' }),
    makeView({ partNumber: '1012-05-GRANDE' }),
  ];
  const saved: ToolcribSet = {
    id: 's',
    nombre: 'ZZ',
    tipo: 'par',
    miembros: [
      { partNumber: 'ZZ-100-IZQ', rol: 'Izquierda', orden: 1, cantidadPorJuego: 1 },
      { partNumber: 'ZZ-100-DER', rol: 'Derecha', orden: 2, cantidadPorJuego: 1 },
    ],
  };

  it('un juego guardado aporta compañeros que ninguna regla fija conoce', () => {
    const result = findCompanionDrawings('ZZ-100-IZQ', library, [saved]);
    expect(result.map((c) => c.label)).toEqual(['Derecha']);
  });

  it('sin juegos guardados se usan las reglas fijas como antes', () => {
    const result = findCompanionDrawings('1012-05-CHICO', library, []);
    expect(result.some((c) => c.drawing.partNumber === '1012-05-GRANDE')).toBe(true);
  });

  it('el guardado gana sobre la regla fija', () => {
    const override: ToolcribSet = {
      id: 'o',
      nombre: 'Override',
      tipo: 'complemento',
      miembros: [
        { partNumber: '1012-05-CHICO', rol: 'Base', orden: 1, cantidadPorJuego: 1 },
        { partNumber: 'ZZ-100-DER', rol: 'Extra', orden: 2, cantidadPorJuego: 1 },
      ],
    };
    const result = findCompanionDrawings('1012-05-CHICO', library, [override]);
    expect(result.map((c) => c.drawing.partNumber)).toEqual(['ZZ-100-DER']);
  });

  it('knownRuleGroupKey identifica las piezas de reglas fijas', () => {
    expect(knownRuleGroupKey('1012-05-CHICO')).toBe('90-1012-05');
    expect(knownRuleGroupKey('90-4150-06 -A')).toBe('90-4150-06');
    expect(knownRuleGroupKey('ZZ-100-IZQ')).toBeNull();
  });
});
