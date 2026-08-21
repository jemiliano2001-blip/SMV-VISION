import { describe, expect, it } from 'vitest';
import {
  buildIsoPartNumber,
  buildIsoPdfFileName,
  compareCadSourceCandidates,
  isCadSourceCandidateFile,
  isCadSourceExtension,
  isExcludedCadSourceRelativePath,
  parseEDrawingFileName,
  parseCadSourceFileName,
  rankCadSourceCandidates,
} from '../edrawingsIso';

describe('parseEDrawingFileName', () => {
  it('parses bare part .eprt', () => {
    expect(parseEDrawingFileName('D7PT-19E525-AA.eprt')).toEqual({
      basePartNumber: 'D7PT-19E525-AA',
      extension: '.eprt',
      embeddedRevision: null,
    });
  });

  it('parses REV suffix', () => {
    expect(parseEDrawingFileName('FOO_REVA.easm')).toEqual({
      basePartNumber: 'FOO',
      extension: '.easm',
      embeddedRevision: 'A',
    });
  });

  it('rejects pdf and unknown extensions', () => {
    expect(parseEDrawingFileName('FOO.pdf')).toBeNull();
    expect(parseEDrawingFileName('FOO.sldprt')).toBeNull();
  });
});

describe('parseCadSourceFileName', () => {
  it.each([
    ['PART.eprt', '.eprt', 'edrawings'],
    ['PART.easm', '.easm', 'edrawings'],
    ['PART.sldprt', '.sldprt', 'solidworks'],
    ['PART.sldasm', '.sldasm', 'solidworks'],
  ] as const)('clasifica %s como %s de %s', (fileName, extension, sourceKind) => {
    expect(parseCadSourceFileName(fileName)).toEqual({
      basePartNumber: 'PART',
      extension,
      sourceKind,
      embeddedRevision: null,
    });
  });

  it('extrae únicamente una revisión terminal con separador', () => {
    expect(parseCadSourceFileName('d7pt-19e525-aa-REV02.sldprt')).toMatchObject({
      basePartNumber: 'D7PT-19E525-AA',
      embeddedRevision: '02',
    });
    expect(parseCadSourceFileName('FOO_REVA.easm')).toMatchObject({
      basePartNumber: 'FOO',
      embeddedRevision: 'A',
    });
    expect(parseCadSourceFileName('PARTREVISION.sldasm')).toMatchObject({
      basePartNumber: 'PARTREVISION',
      embeddedRevision: null,
    });
  });

  it('rechaza dibujos 2D y extensiones ajenas', () => {
    expect(parseCadSourceFileName('PART.slddrw')).toBeNull();
    expect(parseCadSourceFileName('PART.step')).toBeNull();
    expect(isCadSourceExtension('slddrw')).toBe(false);
    expect(isCadSourceExtension('SLDASM')).toBe(true);
  });
});

describe('isExcludedCadSourceRelativePath', () => {
  it.each([
    'OLD/PART.sldprt',
    'version anterior/PART.eprt',
    'ORIGINAL NO TOCAR/PART.easm',
    '.cache/PART.sldasm',
    'EXPORT/PART.eprt',
    'current/_iso_export_batch/PART.sldprt',
  ])('excluye %s', (relativePath) => {
    expect(isExcludedCadSourceRelativePath(relativePath)).toBe(true);
  });

  it('no confunde segmentos que solo contienen texto histórico', () => {
    expect(isExcludedCadSourceRelativePath('OLDIES/PART.sldprt')).toBe(false);
    expect(isExcludedCadSourceRelativePath('current/PART.sldprt')).toBe(false);
  });
});

describe('isCadSourceCandidateFile', () => {
  it('acepta una fuente CAD con contenido', () => {
    expect(isCadSourceCandidateFile('PART.sldprt', 1)).toBe(true);
  });

  it('rechaza archivos vacíos, temporales de SolidWorks y formatos ajenos', () => {
    expect(isCadSourceCandidateFile('PART.eprt', 0)).toBe(false);
    expect(isCadSourceCandidateFile('PART.eprt', -1)).toBe(false);
    expect(isCadSourceCandidateFile('~$PART.sldasm', 42)).toBe(false);
    expect(isCadSourceCandidateFile('PART.slddrw', 42)).toBe(false);
  });
});

describe('rankCadSourceCandidates', () => {
  it('prefiere eDrawings, después fecha nueva y finalmente ruta léxica', () => {
    const candidates = [
      { sourceKind: 'solidworks' as const, modifiedAtMs: 9_999, relativePath: 'z/PART.sldprt' },
      { sourceKind: 'edrawings' as const, modifiedAtMs: 100, relativePath: 'b/PART.eprt' },
      { sourceKind: 'edrawings' as const, modifiedAtMs: 200, relativePath: 'z/PART.eprt' },
      { sourceKind: 'edrawings' as const, modifiedAtMs: 200, relativePath: 'a/PART.eprt' },
    ];

    expect(rankCadSourceCandidates(candidates).map((candidate) => candidate.relativePath)).toEqual([
      'a/PART.eprt',
      'z/PART.eprt',
      'b/PART.eprt',
      'z/PART.sldprt',
    ]);
    expect(candidates[0].relativePath).toBe('z/PART.sldprt');
    expect(compareCadSourceCandidates(candidates[2], candidates[3])).toBeGreaterThan(0);
  });
});

describe('buildIsoPartNumber', () => {
  it('appends .ISO once', () => {
    expect(buildIsoPartNumber('ABC-123')).toBe('ABC-123.ISO');
    expect(buildIsoPartNumber('ABC-123.ISO')).toBe('ABC-123.ISO');
  });

  it('names pdf with .ISO in the stem', () => {
    expect(buildIsoPdfFileName('ABC-123').toLowerCase()).toContain('.iso.pdf');
  });
});
