import { describe, expect, it } from 'vitest';
import type { ToolcribActiveDrawingView } from '../../types';
import {
  attachDrawingForGroup,
  canonicalPartNumber,
  groupDrawingViews,
  matchesAssetFilter,
  matchesFamily,
  matchesFamilyGroup,
  pendingPrintViewForGroup,
  pickPreferredDrawing,
  previewDrawingForGroup,
  printDrawingForGroup,
  sortToolcribGroups,
  thumbnailPdfUrlForGroup,
  type GroupPrintMetrics,
} from '../toolcribCatalog';

function makeView(
  overrides: Partial<ToolcribActiveDrawingView> & Pick<ToolcribActiveDrawingView, 'drawingId' | 'partNumber'>,
): ToolcribActiveDrawingView {
  return {
    partId: `part-${overrides.drawingId}`,
    customer: 'SUPRAJIT',
    description: '',
    revision: '1',
    sourceType: 'storage',
    sourcePath: `${overrides.partNumber}.pdf`,
    pdfUrl: `https://example.com/${overrides.drawingId}.pdf`,
    stlUrl: null,
    effectiveFromUTC: null,
    ...overrides,
  };
}

describe('canonicalPartNumber', () => {
  it('strips trailing .ISO regardless of case', () => {
    expect(canonicalPartNumber('90-1012-05.ISO')).toBe('90-1012-05');
    expect(canonicalPartNumber('90-1012-05.iso')).toBe('90-1012-05');
    expect(canonicalPartNumber('  punzones-m.Iso  ')).toBe('PUNZONES-M');
  });

  it('leaves names without the suffix intact', () => {
    expect(canonicalPartNumber('90-1012-05')).toBe('90-1012-05');
    expect(canonicalPartNumber('ISO-BASE-01')).toBe('ISO-BASE-01');
  });
});

describe('pickPreferredDrawing', () => {
  it('returns null for an empty list', () => {
    expect(pickPreferredDrawing([])).toBeNull();
  });

  it('prefers a view with pdfUrl, then stlUrl, then newer effectiveFrom', () => {
    const noPdf = makeView({ drawingId: 'a', partNumber: 'X', pdfUrl: null });
    const withPdf = makeView({ drawingId: 'b', partNumber: 'X', pdfUrl: 'https://example.com/b.pdf' });
    const withStl = makeView({
      drawingId: 'c',
      partNumber: 'X',
      pdfUrl: 'https://example.com/c.pdf',
      stlUrl: 'https://example.com/c.stl',
    });
    const older = makeView({
      drawingId: 'd',
      partNumber: 'X',
      pdfUrl: 'https://example.com/d.pdf',
      stlUrl: 'https://example.com/d.stl',
      effectiveFromUTC: '2026-01-01T00:00:00.000Z',
    });
    const newer = makeView({
      drawingId: 'e',
      partNumber: 'X',
      pdfUrl: 'https://example.com/e.pdf',
      stlUrl: 'https://example.com/e.stl',
      effectiveFromUTC: '2026-08-01T00:00:00.000Z',
    });

    expect(pickPreferredDrawing([noPdf, withPdf])?.drawingId).toBe('b');
    expect(pickPreferredDrawing([withPdf, withStl])?.drawingId).toBe('c');
    expect(pickPreferredDrawing([older, newer])?.drawingId).toBe('e');
  });
});

describe('groupDrawingViews', () => {
  it('groups CAD and ISO that share a base part number', () => {
    const cad = makeView({
      drawingId: 'cad',
      partNumber: '90-1012-05',
      description: 'PLACA BASE',
      sourcePath: 'TOOL CRIB/90-1012-05.pdf',
    });
    const iso = makeView({
      drawingId: 'iso',
      partNumber: '90-1012-05.ISO',
      description: 'ISO',
      sourcePath: 'TOOL CRIB/90-1012-05.ISO.pdf',
      revision: 'EDRW',
      stlUrl: 'https://example.com/iso.stl',
    });

    const groups = groupDrawingViews([iso, cad]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('90-1012-05');
    expect(groups[0].cad?.drawingId).toBe('cad');
    expect(groups[0].iso?.drawingId).toBe('iso');
    expect(groups[0].stlView?.drawingId).toBe('iso');
    expect(groups[0].description).toBe('PLACA BASE');
  });

  it('groups when ISO is detected only by sourcePath', () => {
    const cad = makeView({ drawingId: 'cad', partNumber: 'UT2000-08', sourcePath: 'UT2000-08.pdf' });
    const iso = makeView({
      drawingId: 'iso',
      partNumber: 'UT2000-08',
      sourcePath: 'UT2000-08.iso.pdf',
    });

    const groups = groupDrawingViews([cad, iso]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cad?.drawingId).toBe('cad');
    expect(groups[0].iso?.drawingId).toBe('iso');
  });

  it('keeps unmatched CAD and ISO as separate groups', () => {
    const cad = makeView({ drawingId: 'cad', partNumber: '90-5492' });
    const iso = makeView({ drawingId: 'iso', partNumber: '90-5493.ISO', sourcePath: '90-5493.ISO.pdf' });

    const groups = groupDrawingViews([cad, iso]);
    expect(groups.map((group) => group.key).sort()).toEqual(['90-5492', '90-5493']);
  });

  it('puts leftover drawings in extras', () => {
    const cadA = makeView({ drawingId: 'cad-a', partNumber: 'P1', pdfUrl: null });
    const cadB = makeView({
      drawingId: 'cad-b',
      partNumber: 'P1',
      pdfUrl: 'https://example.com/cad-b.pdf',
    });
    const groups = groupDrawingViews([cadA, cadB]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cad?.drawingId).toBe('cad-b');
    expect(groups[0].extras.map((view) => view.drawingId)).toEqual(['cad-a']);
  });
});

describe('group roles', () => {
  const cad = makeView({ drawingId: 'cad', partNumber: '90-1216' });
  const iso = makeView({
    drawingId: 'iso',
    partNumber: '90-1216.ISO',
    sourcePath: '90-1216.ISO.pdf',
  });
  const group = groupDrawingViews([cad, iso])[0];

  it('prints CAD, previews CAD first, attaches ISO first', () => {
    expect(printDrawingForGroup(group)?.drawingId).toBe('cad');
    expect(previewDrawingForGroup(group)?.drawingId).toBe('cad');
    expect(attachDrawingForGroup(group)?.drawingId).toBe('iso');
  });
});

describe('matchesFamily (moved from panel)', () => {
  const baseView = makeView({
    drawingId: 'd1',
    partNumber: '90-1012-05',
    description: 'PUNZON DE MARCA M',
    sourcePath: 'toolcrib/uploads/PUNZON_90-1012-05.pdf',
  });

  it('matches all family', () => {
    expect(matchesFamily(baseView, 'all')).toBe(true);
  });

  it('matches punzones and rejects a matriz', () => {
    expect(matchesFamily(baseView, 'punzones')).toBe(true);
    expect(
      matchesFamily(
        { ...baseView, description: 'MATRIZ DE CORTE', sourcePath: 'toolcrib/uploads/MATRIZ_90.pdf' },
        'punzones',
      ),
    ).toBe(false);
  });
});

describe('matchesFamilyGroup / matchesAssetFilter', () => {
  it('promotes a group to punzones if the ISO path has the keyword', () => {
    const cad = makeView({
      drawingId: 'cad',
      partNumber: 'SMV-010',
      description: 'SIN DESC',
      sourcePath: 'uploads/SMV-010.pdf',
    });
    const iso = makeView({
      drawingId: 'iso',
      partNumber: 'SMV-010.ISO',
      description: '',
      sourcePath: 'HOT STAMP/PUNZONES DE MARCA-SUPRAJIT SMV-010.ISO.pdf',
    });
    const group = groupDrawingViews([cad, iso])[0];
    expect(matchesFamilyGroup(group, 'punzones')).toBe(true);
    expect(matchesFamilyGroup(group, 'otros')).toBe(false);
  });

  it('filters by asset presence', () => {
    const cadOnly = groupDrawingViews([makeView({ drawingId: 'cad', partNumber: 'A' })])[0];
    const isoOnly = groupDrawingViews([
      makeView({ drawingId: 'iso', partNumber: 'B.ISO', sourcePath: 'B.ISO.pdf' }),
    ])[0];
    const withStl = groupDrawingViews([
      makeView({
        drawingId: 'iso3',
        partNumber: 'C.ISO',
        sourcePath: 'C.ISO.pdf',
        stlUrl: 'https://example.com/c.stl',
      }),
    ])[0];
    const missingPdf = groupDrawingViews([
      makeView({ drawingId: 'empty', partNumber: 'D', pdfUrl: null }),
    ])[0];

    expect(matchesAssetFilter(cadOnly, 'cad')).toBe(true);
    expect(matchesAssetFilter(cadOnly, 'iso')).toBe(false);
    expect(matchesAssetFilter(isoOnly, 'iso')).toBe(true);
    expect(matchesAssetFilter(isoOnly, 'cad')).toBe(false);
    expect(matchesAssetFilter(withStl, 'stl')).toBe(true);
    expect(matchesAssetFilter(missingPdf, 'missing-pdf')).toBe(true);
    expect(matchesAssetFilter(cadOnly, 'missing-pdf')).toBe(false);
  });

  it('filters by missing CAD / missing ISO — huecos del catálogo', () => {
    const cadOnly = groupDrawingViews([makeView({ drawingId: 'cad', partNumber: 'A' })])[0];
    const isoOnly = groupDrawingViews([
      makeView({ drawingId: 'iso', partNumber: 'B.ISO', sourcePath: 'B.ISO.pdf' }),
    ])[0];

    expect(matchesAssetFilter(cadOnly, 'missing-iso')).toBe(true);
    expect(matchesAssetFilter(cadOnly, 'missing-cad')).toBe(false);
    expect(matchesAssetFilter(isoOnly, 'missing-cad')).toBe(true);
    expect(matchesAssetFilter(isoOnly, 'missing-iso')).toBe(false);
  });
});

describe('pendingPrintViewForGroup', () => {
  it('prefiere el CAD sobre el ISO', () => {
    const group = groupDrawingViews([
      makeView({ drawingId: 'cad', partNumber: 'A' }),
      makeView({ drawingId: 'iso', partNumber: 'A.ISO', sourcePath: 'A.ISO.pdf' }),
    ])[0];
    expect(pendingPrintViewForGroup(group)?.drawingId).toBe('cad');
  });

  it('cae al ISO si no hay CAD', () => {
    const group = groupDrawingViews([
      makeView({ drawingId: 'iso', partNumber: 'B.ISO', sourcePath: 'B.ISO.pdf' }),
    ])[0];
    expect(pendingPrintViewForGroup(group)?.drawingId).toBe('iso');
  });
});

describe('thumbnailPdfUrlForGroup', () => {
  it('prefiere el ISO (más reconocible a simple vista) sobre el CAD', () => {
    const group = groupDrawingViews([
      makeView({ drawingId: 'cad', partNumber: 'A', pdfUrl: 'https://x/cad.pdf' }),
      makeView({ drawingId: 'iso', partNumber: 'A.ISO', sourcePath: 'A.ISO.pdf', pdfUrl: 'https://x/iso.pdf' }),
    ])[0];
    expect(thumbnailPdfUrlForGroup(group)).toBe('https://x/iso.pdf');
  });

  it('cae al CAD si no hay ISO, y a null si no hay ningún PDF', () => {
    const withCad = groupDrawingViews([
      makeView({ drawingId: 'cad', partNumber: 'A', pdfUrl: 'https://x/cad.pdf' }),
    ])[0];
    expect(thumbnailPdfUrlForGroup(withCad)).toBe('https://x/cad.pdf');

    const withoutPdf = groupDrawingViews([
      makeView({ drawingId: 'cad', partNumber: 'B', pdfUrl: null }),
    ])[0];
    expect(thumbnailPdfUrlForGroup(withoutPdf)).toBeNull();
  });
});

describe('sortToolcribGroups', () => {
  const groups = groupDrawingViews([
    makeView({ drawingId: 'b1', partNumber: 'B-001', description: 'Zeta pieza', revision: '3' }),
    makeView({ drawingId: 'a1', partNumber: 'A-001', description: 'Alfa pieza', revision: '1' }),
    makeView({ drawingId: 'c1', partNumber: 'C-001', description: 'Media pieza', revision: '2' }),
  ]);

  it('ordena por número de parte (default), asc y desc', () => {
    expect(sortToolcribGroups(groups, 'partNumber', 'asc').map((g) => g.partNumber)).toEqual([
      'A-001',
      'B-001',
      'C-001',
    ]);
    expect(sortToolcribGroups(groups, 'partNumber', 'desc').map((g) => g.partNumber)).toEqual([
      'C-001',
      'B-001',
      'A-001',
    ]);
  });

  it('ordena por descripción', () => {
    expect(sortToolcribGroups(groups, 'description', 'asc').map((g) => g.partNumber)).toEqual([
      'A-001',
      'C-001',
      'B-001',
    ]);
  });

  it('ordena por revisión del CAD', () => {
    expect(sortToolcribGroups(groups, 'revision', 'asc').map((g) => g.partNumber)).toEqual([
      'A-001',
      'C-001',
      'B-001',
    ]);
  });

  it('ordena por impresiones y por última impresión usando las métricas inyectadas', () => {
    const metricsFor = (group: (typeof groups)[number]): GroupPrintMetrics => {
      const table: Record<string, GroupPrintMetrics> = {
        'A-001': { count: 5, lastPrintedAtUTC: '2026-01-01T00:00:00.000Z' },
        'B-001': { count: 1, lastPrintedAtUTC: '2026-03-01T00:00:00.000Z' },
        'C-001': { count: 0, lastPrintedAtUTC: null },
      };
      return table[group.partNumber];
    };

    expect(
      sortToolcribGroups(groups, 'prints', 'desc', metricsFor).map((g) => g.partNumber),
    ).toEqual(['A-001', 'B-001', 'C-001']);

    expect(
      sortToolcribGroups(groups, 'lastPrinted', 'desc', metricsFor).map((g) => g.partNumber),
    ).toEqual(['B-001', 'A-001', 'C-001']);
  });

  it('desempata siempre por número de parte para que el orden sea estable', () => {
    const tied = groupDrawingViews([
      makeView({ drawingId: 'x1', partNumber: 'X-002', description: 'Igual' }),
      makeView({ drawingId: 'x2', partNumber: 'X-001', description: 'Igual' }),
    ]);
    expect(sortToolcribGroups(tied, 'description', 'asc').map((g) => g.partNumber)).toEqual([
      'X-001',
      'X-002',
    ]);
  });

  it('sin metricsFor (default), ordenar por impresiones no revienta — todo cuenta 0', () => {
    expect(sortToolcribGroups(groups, 'prints', 'desc').map((g) => g.partNumber)).toEqual([
      'A-001',
      'B-001',
      'C-001',
    ]);
  });
});
