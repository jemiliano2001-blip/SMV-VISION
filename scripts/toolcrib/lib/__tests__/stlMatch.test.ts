import { describe, expect, it } from 'vitest';
import { MIN_BLUEPRINT_MATCH_SCORE } from '../../../../src/lib/matching';
import { scoreStlDrawingMatch } from '../stlMatch';

describe('scoreStlDrawingMatch', () => {
  it('da 100 cuando el número de parte coincide exacto (con o sin sufijo .ISO)', () => {
    expect(scoreStlDrawingMatch('90-1012-05', '90-1012-05', 'TOOL CRIB/90-1012-05/x.SLDPRT')).toBe(100);
    expect(scoreStlDrawingMatch('90-1012-05', '90-1012-05.ISO', 'tool-crib/SUPRAJIT/90-1012-05.ISO.pdf')).toBe(100);
  });

  it('NO deja que un número de parte reclame el drawing de otro por substring/prefijo', () => {
    // Bug real: "90-1012-05" pegaba con "90-1012-055" solo por .includes().
    const score = scoreStlDrawingMatch('90-1012-05', '90-1012-055', 'tool-crib/SUPRAJIT/90-1012-055.ISO.pdf');
    expect(score).toBe(0);
  });

  it('NO deja que un sufijo distinto (05 vs 06) pase el umbral', () => {
    const score = scoreStlDrawingMatch('90-1012-05', '90-1012-06', 'tool-crib/SUPRAJIT/90-1012-06.ISO.pdf');
    expect(score).toBe(0);
  });

  it('matchea por sourcePath cuando el partNumber del drawing no trae el número bare (p.ej. sufijo .ISO en otra pieza)', () => {
    const score = scoreStlDrawingMatch(
      '14259-63-20-93',
      'UNKNOWN.ISO',
      'TOOL CRIB/14259-63-20-93/14259-63-20-93.SLDPRT',
    );
    expect(score).toBeGreaterThanOrEqual(MIN_BLUEPRINT_MATCH_SCORE);
  });

  it('no matchea dos piezas sin ninguna relación', () => {
    const score = scoreStlDrawingMatch('NAVAJA ARTOS 143272', '90-4516-03', 'tool-crib/SUPRAJIT/90-4516-03.ISO.pdf');
    expect(score).toBeLessThan(MIN_BLUEPRINT_MATCH_SCORE);
  });
});
