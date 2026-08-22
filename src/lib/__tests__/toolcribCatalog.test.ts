import { describe, expect, it } from 'vitest';
import type { ToolcribActiveDrawingView } from '../../types';
import {
  attachDrawingForGroup,
  canonicalPartNumber,
  groupDrawingViews,
  matchesAssetFilter,
  matchesFamily,
  matchesFamilyGroup,
  pickPreferredDrawing,
  previewDrawingForGroup,
  printDrawingForGroup,
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
});
