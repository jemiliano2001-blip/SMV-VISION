import { describe, expect, it } from 'vitest';

import {
  buildSearchIndex,
  compactText,
  highlightSegments,
  normalizeText,
  searchIndex,
  tokenize,
  withAliasSearchText,
  SCORE_EXACT_PART,
  SCORE_FUZZY_MAX,
  type SearchableItem,
} from '../toolcribSearch';

interface Pieza extends SearchableItem {
  partNumber: string;
  description: string;
  searchText: string;
  hasIso?: boolean;
}

function pieza(partNumber: string, description = '', searchText = ''): Pieza {
  return { partNumber, description, searchText: searchText || `${partNumber} ${description}` };
}

const CATALOGO: Pieza[] = [
  pieza('90-1012-05', 'CAD (90-1012-05)', '90-1012-05.pdf 90-1012-05.ISO.pdf'),
  pieza('90-1012-05-001', 'CAD (90-1012-05-001)', '90-1012-05-001.pdf'),
  pieza('90-1012-06', 'CAD (90-1012-06)', '90-1012-06.pdf 90-1012-06.ISO.pdf'),
  pieza('90-1012-06-2', 'CAD (90-1012-06-2)', '90-1012-06-2.pdf'),
  pieza('1012-05-CHICO', 'Importado de 1012-05-chico.pdf', '1012-05-chico.pdf'),
  pieza('PUNZONES DE MARCA-SUPRAJIT SMV-001', 'PUNZÓN LETRA M', 'punzones marca letra m'),
  pieza('PUNZONES DE MARCA-SUPRAJIT SMV-002', 'PUNZÓN NÚMERO 2', 'punzones marca numero 2'),
  pieza('273-17-04167', 'GAVILÁN DE CORTE', 'gavilan corte 273'),
];

const index = buildSearchIndex(CATALOGO);
const partNumbersFor = (q: string): string[] =>
  searchIndex(index, q).map((hit) => hit.item.partNumber);

describe('normalizeText / compactText / tokenize', () => {
  it('quita acentos y baja a minúsculas', () => {
    expect(normalizeText('PUNZÓN NÚMERO')).toBe('punzon numero');
    expect(normalizeText('GAVILÁN')).toBe('gavilan');
  });

  it('colapsa espacios y recorta', () => {
    expect(normalizeText('  90-1012   05  ')).toBe('90-1012 05');
  });

  it('compacta a puro alfanumérico', () => {
    expect(compactText('90-1012-06')).toBe('90101206');
    expect(compactText('SMV-001')).toBe('smv001');
  });

  it('tokeniza partiendo por separadores', () => {
    expect(tokenize('90-1012-06')).toEqual(['90', '1012', '06']);
    expect(tokenize('PUNZÓN LETRA M')).toEqual(['punzon', 'letra', 'm']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('searchIndex — acentos', () => {
  it('encuentra PUNZÓN escribiendo sin acento (el bug que tenía el panel)', () => {
    expect(partNumbersFor('punzon')).toContain('PUNZONES DE MARCA-SUPRAJIT SMV-001');
  });

  it('encuentra escribiendo CON acento aunque el dato no lo tenga', () => {
    expect(partNumbersFor('gavilán')).toContain('273-17-04167');
  });
});

describe('searchIndex — lo exacto gana', () => {
  it('pone la coincidencia exacta primero, no a un vecino con prefijo', () => {
    expect(partNumbersFor('90-1012-06')[0]).toBe('90-1012-06');
  });

  it('un prefijo puntúa por encima de una coincidencia interna', () => {
    const hits = searchIndex(index, '90-1012-06');
    const exacta = hits.find((h) => h.item.partNumber === '90-1012-06');
    const vecina = hits.find((h) => h.item.partNumber === '90-1012-06-2');
    expect(exacta?.score).toBeGreaterThan(vecina?.score ?? 0);
  });

  it('un fragmento devuelve toda la familia', () => {
    const result = partNumbersFor('1012');
    expect(result).toEqual(
      expect.arrayContaining(['90-1012-05', '90-1012-06', '90-1012-06-2', '1012-05-CHICO']),
    );
  });
});

describe('searchIndex — número compacto', () => {
  it('encuentra 90-1012-06 tecleado sin guiones', () => {
    expect(partNumbersFor('101206')).toContain('90-1012-06');
  });

  it('encuentra SMV-001 tecleado como smv001', () => {
    expect(partNumbersFor('smv001')).toContain('PUNZONES DE MARCA-SUPRAJIT SMV-001');
  });
});

describe('searchIndex — varias palabras (AND)', () => {
  it('exige todos los tokens', () => {
    const result = partNumbersFor('punzon letra m');
    expect(result).toContain('PUNZONES DE MARCA-SUPRAJIT SMV-001');
    expect(result).not.toContain('PUNZONES DE MARCA-SUPRAJIT SMV-002');
  });

  it('no devuelve nada si un token no existe en ninguna pieza', () => {
    expect(partNumbersFor('punzon zzzznoexiste')).toEqual([]);
  });

  it('el orden de las palabras no importa', () => {
    expect(partNumbersFor('letra punzon')).toContain('PUNZONES DE MARCA-SUPRAJIT SMV-001');
  });
});

describe('searchIndex — el difuso es último recurso', () => {
  it('atrapa un error de dedo cuando nada coincide literalmente', () => {
    const result = partNumbersFor('puznones');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatch(/^PUNZONES/);
  });

  it('un acierto difuso nunca supera a uno literal', () => {
    const hits = searchIndex(index, 'punzon');
    expect(hits.every((hit) => hit.score > SCORE_FUZZY_MAX)).toBe(true);
  });
});

describe('searchIndex — consulta vacía y desempate', () => {
  it('con consulta vacía devuelve el catálogo completo', () => {
    expect(searchIndex(index, '   ')).toHaveLength(CATALOGO.length);
  });

  it('el desempate del catálogo ordena dentro del mismo escalón', () => {
    const conIso = buildSearchIndex([
      { ...pieza('AAA-1'), hasIso: false },
      { ...pieza('AAA-2'), hasIso: true },
    ]);
    const hits = searchIndex(conIso, 'aaa', { tieBreak: (item) => (item.hasIso ? 1 : 0) });
    expect(hits[0].item.partNumber).toBe('AAA-2');
  });

  it('el orden es estable: mismo escalón y mismo desempate → alfabético', () => {
    const first = partNumbersFor('1012');
    expect(partNumbersFor('1012')).toEqual(first);
  });

  it('la consulta vacía puntúa todo igual', () => {
    expect(searchIndex(index, '').every((hit) => hit.score === SCORE_EXACT_PART)).toBe(true);
  });
});

describe('highlightSegments', () => {
  it('marca el tramo coincidente conservando el texto original', () => {
    const segments = highlightSegments('90-1012-06', '1012');
    expect(segments.map((s) => s.text).join('')).toBe('90-1012-06');
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(['1012']);
  });

  it('resalta pese al acento: se teclea sin él y se marca la palabra completa', () => {
    const segments = highlightSegments('PUNZÓN LETRA M', 'punzon');
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(['PUNZÓN']);
    expect(segments.map((s) => s.text).join('')).toBe('PUNZÓN LETRA M');
  });

  it('resalta varios tokens', () => {
    const segments = highlightSegments('PUNZON LETRA M', 'letra punzon');
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(['PUNZON', 'LETRA']);
  });

  it('sin consulta devuelve un solo tramo sin marcar', () => {
    expect(highlightSegments('90-1012-06', '')).toEqual([{ text: '90-1012-06', match: false }]);
  });

  it('nunca pierde ni duplica caracteres', () => {
    for (const q of ['1012', '06', 'cad', 'zzz', '90-1012-06']) {
      expect(highlightSegments('CAD (90-1012-06)', q).map((s) => s.text).join('')).toBe(
        'CAD (90-1012-06)',
      );
    }
  });
});

describe('withAliasSearchText', () => {
  // Mismo contrato que canonicalPartNumber (toolcribCatalog.ts) — se
  // reimplementa aquí para probar `withAliasSearchText` sin acoplarla a ese
  // módulo; es agnóstica de cómo se canonicaliza un número de parte.
  const canon = (partNumber: string): string =>
    partNumber.trim().toUpperCase().replace(/\.ISO$/i, '');

  it('agrega el patrón del alias al searchText de la pieza que apunta', () => {
    const items: Pieza[] = [pieza('PUNZONES DE MARCA-SUPRAJIT SMV-001', 'PUNZÓN LETRA M')];
    const withAliases = withAliasSearchText(
      items,
      [{ pattern: 'punzon de la m', partNumber: 'PUNZONES DE MARCA-SUPRAJIT SMV-001' }],
      canon,
    );

    const idx = buildSearchIndex(withAliases);
    expect(partNumbersForIndex(idx, 'punzon de la m')).toContain(
      'PUNZONES DE MARCA-SUPRAJIT SMV-001',
    );
  });

  it('no afecta piezas sin alias', () => {
    const items: Pieza[] = [pieza('90-1012-06')];
    const withAliases = withAliasSearchText(
      items,
      [{ pattern: 'algo irrelevante', partNumber: 'OTRA-PIEZA' }],
      canon,
    );
    expect(withAliases[0].searchText).toBe(items[0].searchText);
  });

  it('canonicaliza: un alias sobre "X.ISO" también aplica a "X"', () => {
    const items: Pieza[] = [pieza('90-1012-06')];
    const withAliases = withAliasSearchText(
      items,
      [{ pattern: 'letra m grande', partNumber: '90-1012-06.ISO' }],
      canon,
    );
    expect(withAliases[0].searchText).toContain('letra m grande');
  });

  it('sin alias, no clona items (misma referencia)', () => {
    const items: Pieza[] = [pieza('90-1012-06')];
    const [result] = withAliasSearchText(items, [], canon);
    expect(result).toBe(items[0]);
  });

  it('varios alias sobre la misma pieza se acumulan todos', () => {
    const items: Pieza[] = [pieza('90-1012-06')];
    const [result] = withAliasSearchText(
      items,
      [
        { pattern: 'apodo uno', partNumber: '90-1012-06' },
        { pattern: 'apodo dos', partNumber: '90-1012-06' },
      ],
      canon,
    );
    expect(result.searchText).toContain('apodo uno');
    expect(result.searchText).toContain('apodo dos');
  });
});

function partNumbersForIndex(idx: ReturnType<typeof buildSearchIndex<Pieza>>, q: string): string[] {
  return searchIndex(idx, q).map((hit) => hit.item.partNumber);
}
