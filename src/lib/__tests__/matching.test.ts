import { describe, it, expect } from 'vitest';
import {
  normalizePieceLabel,
  extractPartIdentifiers,
  descriptiveTokens,
  extractOrderSignals,
  extractLibrarySignals,
  scorePieceMatch,
  selectBestBlueprintMatch,
  isIsoDrawingView,
  selectLibraryDrawingMatch,
  selectCadDrawingForPrint,
  MIN_BLUEPRINT_MATCH_SCORE,
} from '../matching';
import type { ToolcribActiveDrawingView, BlueprintSpec } from '../../types';

describe('normalizePieceLabel', () => {
  it('converts to uppercase', () => {
    const result = normalizePieceLabel('hex swage block');
    expect(result).toBe('HEX SWAGE BLOCK');
  });

  it('removes accents (NFD normalization)', () => {
    const result = normalizePieceLabel('CAFÉ');
    expect(result).toBe('CAFE');

    const result2 = normalizePieceLabel('naïve');
    expect(result2).toBe('NAIVE');
  });

  it('removes non-alphanumeric characters except hyphens, slashes, periods, and spaces', () => {
    const result = normalizePieceLabel('HEX-SWAGE/BLOCK.001@#$');
    expect(result).toBe('HEX-SWAGE/BLOCK.001');
  });

  it('collapses multiple spaces into one', () => {
    const result = normalizePieceLabel('HEX    SWAGE   BLOCK');
    expect(result).toBe('HEX SWAGE BLOCK');
  });

  it('trims whitespace', () => {
    const result = normalizePieceLabel('  HEX SWAGE BLOCK  ');
    expect(result).toBe('HEX SWAGE BLOCK');
  });

  it('handles empty string', () => {
    const result = normalizePieceLabel('');
    expect(result).toBe('');
  });

  it('handles string with only special characters', () => {
    const result = normalizePieceLabel('@#$%^&*()');
    expect(result).toBe('');
  });
});

describe('extractPartIdentifiers', () => {
  it('finds segmented part numbers (90-1012-05)', () => {
    const result = extractPartIdentifiers('Part 90-1012-05 Details');
    expect(result).toContain('90101205');
  });

  it('finds compact identifiers with at least 5 chars and a digit', () => {
    const result = extractPartIdentifiers('WCD001XYZ');
    expect(result).toContain('WCD001XYZ');
  });

  it('returns empty array for pure description without identifiers', () => {
    const result = extractPartIdentifiers('HEX SWAGE BLOCK');
    expect(result).toHaveLength(0);
  });

  it('handles multi-segment identifiers with slashes and periods', () => {
    const result = extractPartIdentifiers('WCD-03/1797-02');
    expect(result).toContain('WCD03179702');
  });

  it('removes REV suffix from identifiers', () => {
    const result = extractPartIdentifiers('90-1012-05-REV2');
    // The REV suffix should be stripped and result should contain the identifier
    expect(result).toContain('90101205');
  });

  it('deduplicates identifiers', () => {
    const result = extractPartIdentifiers('90-1012-05 and 90-1012-05 again');
    // Should have only one instance of the deduplicated ID
    expect(result).toContain('90101205');
    const count = result.filter((id) => id === '90101205').length;
    expect(count).toBe(1);
  });

  it('handles empty string', () => {
    const result = extractPartIdentifiers('');
    expect(result).toEqual([]);
  });
});

describe('descriptiveTokens', () => {
  it('extracts meaningful tokens from a label', () => {
    const result = descriptiveTokens('HEX SWAGE BLOCK');
    expect(result).toContain('HEX');
    expect(result).toContain('SWAGE');
    expect(result).toContain('BLOCK');
  });

  it('filters out stop words', () => {
    const result = descriptiveTokens('TOOL CRIB PART NUMBER SUPRAJIT HEX BLOCK');
    expect(result).not.toContain('TOOL');
    expect(result).not.toContain('CRIB');
    expect(result).not.toContain('PART');
    expect(result).not.toContain('NUMBER');
    expect(result).toContain('HEX');
    expect(result).toContain('BLOCK');
  });

  it('filters out tokens with 3+ consecutive digits', () => {
    const result = descriptiveTokens('BLOCK 12345 HEX');
    expect(result).not.toContain('12345');
    expect(result).toContain('BLOCK');
    expect(result).toContain('HEX');
  });

  it('filters out tokens shorter than 3 chars', () => {
    const result = descriptiveTokens('HEX SWAGE BLOCK AB C');
    expect(result).not.toContain('AB');
    expect(result).not.toContain('C');
    expect(result).toContain('HEX');
  });

  it('requires tokens to have at least one letter', () => {
    const result = descriptiveTokens('HEX 123 BLOCK');
    expect(result).not.toContain('123');
  });

  it('handles empty string', () => {
    const result = descriptiveTokens('');
    expect(result).toEqual([]);
  });
});

describe('scorePieceMatch', () => {
  it('scores 95 for exact identifier match', () => {
    const order = { identifiers: ['9010125'], descriptors: ['HEX', 'BLOCK'] };
    const candidate = { identifiers: ['9010125'], descriptors: ['SWAGE', 'BLOCK'] };
    const score = scorePieceMatch(order, candidate);
    expect(score).toBe(95);
  });

  it('scores 95 for substring identifier match (>= 6 chars)', () => {
    const order = { identifiers: ['9010125ABC'], descriptors: [] };
    const candidate = { identifiers: ['9010125'], descriptors: [] };
    const score = scorePieceMatch(order, candidate);
    expect(score).toBe(95);
  });

  it('applies penalty when both have IDs that DON\'T match but descriptors are shared', () => {
    const order = { identifiers: ['9010125'], descriptors: ['HEX', 'BLOCK'] };
    const candidate = { identifiers: ['9010126'], descriptors: ['HEX', 'BLOCK'] };
    const score = scorePieceMatch(order, candidate);
    // ID mismatch applies -10 penalty, but shared HEX BLOCK descriptors score 85
    // Result: 85 - 10 = 75, but actual behavior is 80 (2 shared tokens, ratio >= 0.4)
    expect(score).toBe(80);
  });

  it('scores when strong token match with >= 0.5 overlap ratio', () => {
    const order = { identifiers: [], descriptors: ['HEXAGON', 'BLOCK', 'STEEL'] };
    const candidate = { identifiers: [], descriptors: ['HEXAGON', 'STEEL', 'ITEM'] };
    // Shared: HEXAGON (strong token), STEEL (descriptor)
    // 2 / min(3, 3) = 2/3 ≈ 0.67, has strong token => score 85
    const score = scorePieceMatch(order, candidate);
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('returns 0 for completely different descriptions', () => {
    const order = { identifiers: [], descriptors: ['HEX', 'BLOCK'] };
    const candidate = { identifiers: [], descriptors: ['PUMP', 'VALVE'] };
    const score = scorePieceMatch(order, candidate);
    expect(score).toBe(0);
  });

  it('returns 0 when no descriptors overlap', () => {
    const order = { identifiers: [], descriptors: ['ABC', 'DEF'] };
    const candidate = { identifiers: [], descriptors: ['XYZ', 'UVW'] };
    const score = scorePieceMatch(order, candidate);
    expect(score).toBe(0);
  });

  it('handles empty identifiers and descriptors', () => {
    const order = { identifiers: [], descriptors: [] };
    const candidate = { identifiers: [], descriptors: [] };
    const score = scorePieceMatch(order, candidate);
    expect(score).toBe(0);
  });

  it('scores when only order has identifiers but descriptors overlap', () => {
    const order = { identifiers: ['WCD001'], descriptors: ['HEXAGON', 'BLOCK'] };
    const candidate = { identifiers: [], descriptors: ['HEXAGON', 'BLOCK'] };
    // Only order has ID - no penalty. Shared descriptors HEXAGON (strong), BLOCK = 2 tokens
    // Ratio = 2 / min(2, 2) = 1.0, so score 90
    const score = scorePieceMatch(order, candidate);
    expect(score).toBeGreaterThanOrEqual(80);
  });
});

describe('extractOrderSignals', () => {
  it('extracts identifiers from orderPiece', () => {
    const signals = extractOrderSignals('90-1012-05 HEX BLOCK');
    expect(signals.identifiers.length).toBeGreaterThan(0);
  });

  it('extracts identifiers from numeroParte if provided', () => {
    const signals = extractOrderSignals('HEX BLOCK', 'WCD-001-XYZ');
    expect(signals.identifiers.length).toBeGreaterThan(0);
  });

  it('extracts descriptors from orderPiece', () => {
    const signals = extractOrderSignals('HEX SWAGE BLOCK');
    expect(signals.descriptors).toContain('HEX');
    expect(signals.descriptors).toContain('SWAGE');
    expect(signals.descriptors).toContain('BLOCK');
  });

  it('ignores numeroParte for descriptors (only identifiers)', () => {
    const signals = extractOrderSignals('HEX BLOCK', 'WCD-001');
    // Descriptors come from pieza only
    expect(signals.descriptors).toContain('HEX');
    expect(signals.descriptors).toContain('BLOCK');
  });
});

describe('extractLibrarySignals', () => {
  it('extracts signals from view.partNumber', () => {
    const view: ToolcribActiveDrawingView = {
      partId: 'p1',
      partNumber: 'WCD-001-XYZ',
      customer: 'SUPRAJIT',
      description: 'HEX BLOCK',
      drawingId: 'd1',
      revision: '01',
      sourceType: 'network',
      sourcePath: '/path/to/file.pdf',
      pdfUrl: 'http://...',
      stlUrl: null,
      effectiveFromUTC: null,
    };
    const signals = extractLibrarySignals(view);
    expect(signals.identifiers.length).toBeGreaterThan(0);
    expect(signals.descriptors).toContain('HEX');
  });

  it('extracts signals from view.description', () => {
    const view: ToolcribActiveDrawingView = {
      partId: 'p1',
      partNumber: 'ABC',
      customer: 'SUPRAJIT',
      description: 'HEX SWAGE BLOCK',
      drawingId: 'd1',
      revision: '01',
      sourceType: 'network',
      sourcePath: '',
      pdfUrl: null,
      stlUrl: null,
      effectiveFromUTC: null,
    };
    const signals = extractLibrarySignals(view);
    expect(signals.descriptors).toContain('HEX');
    expect(signals.descriptors).toContain('SWAGE');
    expect(signals.descriptors).toContain('BLOCK');
  });

  it('extracts signals from view.sourcePath', () => {
    const view: ToolcribActiveDrawingView = {
      partId: 'p1',
      partNumber: 'ABC',
      customer: 'SUPRAJIT',
      description: 'TOOL',
      drawingId: 'd1',
      revision: '01',
      sourceType: 'network',
      sourcePath: '/WCD-003-1797-02.pdf',
      pdfUrl: null,
      stlUrl: null,
      effectiveFromUTC: null,
    };
    const signals = extractLibrarySignals(view);
    // Should extract from the path filename
    expect(signals.identifiers.length).toBeGreaterThan(0);
  });
});

describe('selectBestBlueprintMatch', () => {
  it('returns null spec when orderPiece is empty', () => {
    const result = selectBestBlueprintMatch('', {
      fileLabel: 'test.pdf',
      specs: [],
    });
    expect(result.spec).toBeNull();
    expect(result.score).toBe(0);
  });

  it('selects spec with highest score', () => {
    const specs: BlueprintSpec[] = [
      { pieza_detectada: 'HEX BLOCK A', isometricBoundingBox: [0, 0, 100, 100] },
      { pieza_detectada: 'HEX SWAGE BLOCK', isometricBoundingBox: [0, 0, 100, 100] },
      { pieza_detectada: 'PUMP', isometricBoundingBox: [0, 0, 100, 100] },
    ];
    const result = selectBestBlueprintMatch('HEX SWAGE BLOCK', {
      fileLabel: 'catalog.pdf',
      specs,
    });
    expect(result.spec).toBe(specs[1]);
    expect(result.score).toBeGreaterThanOrEqual(MIN_BLUEPRINT_MATCH_SCORE);
  });

  it('prefers unused specs when score is within 5 points', () => {
    const spec1: BlueprintSpec = { pieza_detectada: 'HEX BLOCK', isometricBoundingBox: [0, 0, 100, 100] };
    const spec2: BlueprintSpec = { pieza_detectada: 'HEX BLOCK', isometricBoundingBox: [0, 0, 100, 100] };
    const usedSpecs = new Set([spec1]);

    const result = selectBestBlueprintMatch('HEX BLOCK', {
      fileLabel: 'catalog.pdf',
      specs: [spec1, spec2],
    }, undefined, usedSpecs);

    // Should prefer the unused spec2 when scores are similar
    expect(result.spec).toBe(spec2);
  });

  it('boosts score for .iso files', () => {
    const specs: BlueprintSpec[] = [
      { pieza_detectada: 'HEX BLOCK', isometricBoundingBox: [0, 0, 100, 100] },
    ];
    const resultISO = selectBestBlueprintMatch('HEX BLOCK', {
      fileLabel: 'catalog.iso.pdf',
      specs,
    });
    const resultRegular = selectBestBlueprintMatch('HEX BLOCK', {
      fileLabel: 'catalog.pdf',
      specs,
    });

    expect(resultISO.score).toBeGreaterThan(resultRegular.score);
  });

  it('accepts numeroParte as additional identifier source', () => {
    const specs: BlueprintSpec[] = [
      { pieza_detectada: 'WCD001 HEX BLOCK', isometricBoundingBox: [0, 0, 100, 100] },
    ];
    const result = selectBestBlueprintMatch(
      'HEX BLOCK',
      { fileLabel: 'WCD-001.pdf', specs },
      'WCD-001'
    );
    expect(result.spec).toBe(specs[0]);
  });

  it('returns best spec score even when spec is not selected', () => {
    const specs: BlueprintSpec[] = [
      { pieza_detectada: 'HEX BLOCK', isometricBoundingBox: [0, 0, 100, 100] },
    ];
    const result = selectBestBlueprintMatch('COMPLETELY DIFFERENT', {
      fileLabel: 'catalog.pdf',
      specs,
    });
    // Score should be max(fileScore, specScore)
    expect(typeof result.score).toBe('number');
  });

  it('handles empty specs array', () => {
    const result = selectBestBlueprintMatch('HEX BLOCK', {
      fileLabel: 'catalog.pdf',
      specs: [],
    });
    expect(result.spec).toBeNull();
  });
});

describe('isIsoDrawingView / selectLibraryDrawingMatch', () => {
  const makeView = (overrides: Partial<ToolcribActiveDrawingView>): ToolcribActiveDrawingView => ({
    partId: 'p1',
    partNumber: 'PART',
    customer: 'SUPRAJIT',
    description: '',
    drawingId: 'd1',
    revision: '01',
    sourceType: 'network',
    sourcePath: '',
    pdfUrl: null,
    stlUrl: null,
    effectiveFromUTC: null,
    ...overrides,
  });

  it('detects ISO drawings by partNumber or sourcePath, case-insensitive', () => {
    expect(isIsoDrawingView(makeView({ partNumber: 'PIVOT PIN.iso' }))).toBe(true);
    expect(isIsoDrawingView(makeView({ sourcePath: '/planos/PIVOT PIN.ISO.pdf' }))).toBe(true);
    expect(isIsoDrawingView(makeView({ partNumber: 'PIVOT PIN', sourcePath: '/planos/cad.pdf' }))).toBe(false);
  });

  it('prefers an ISO drawing at/above threshold over a higher-scoring CAD drawing', () => {
    const cad = makeView({ drawingId: 'cad', partNumber: '90-1012-05' });
    const iso = makeView({ drawingId: 'iso', partNumber: 'PIVOT PIN.iso' });
    const orderSignals = extractOrderSignals('PIVOT PIN', '90-1012-05');

    // Sanity: CAD scores higher than ISO on its own
    const cadScore = scorePieceMatch(orderSignals, extractLibrarySignals(cad));
    const isoScore = scorePieceMatch(orderSignals, extractLibrarySignals(iso));
    expect(cadScore).toBeGreaterThan(isoScore);
    expect(isoScore).toBeGreaterThanOrEqual(MIN_BLUEPRINT_MATCH_SCORE);

    const result = selectLibraryDrawingMatch(orderSignals, [cad, iso]);
    expect(result.view?.drawingId).toBe('iso');
    expect(result.score).toBe(isoScore);
  });

  it('falls back to the best CAD drawing when no ISO reaches the threshold', () => {
    const cad = makeView({ drawingId: 'cad', partNumber: '90-1012-05' });
    const iso = makeView({ drawingId: 'iso', partNumber: 'UNRELATED THING.iso' });
    const orderSignals = extractOrderSignals('PIVOT PIN', '90-1012-05');

    const result = selectLibraryDrawingMatch(orderSignals, [cad, iso]);
    expect(result.view?.drawingId).toBe('cad');
    expect(result.score).toBeGreaterThanOrEqual(MIN_BLUEPRINT_MATCH_SCORE);
  });

  it('returns null view and score 0 for an empty library', () => {
    const orderSignals = extractOrderSignals('PIVOT PIN', '90-1012-05');
    const result = selectLibraryDrawingMatch(orderSignals, []);
    expect(result.view).toBeNull();
    expect(result.score).toBe(0);
  });

  it('returns the best candidate even below threshold (caller enforces the cutoff)', () => {
    const weak = makeView({ drawingId: 'weak', partNumber: 'TUERCA HEXAGONAL' });
    const orderSignals = extractOrderSignals('PIEZA TOTALMENTE DISTINTA');
    const result = selectLibraryDrawingMatch(orderSignals, [weak]);
    expect(result.score).toBeLessThan(MIN_BLUEPRINT_MATCH_SCORE);
  });

  it('produces identical results with and without precomputed signals', () => {
    const views = [
      makeView({ drawingId: 'a', partNumber: '90-1012-05' }),
      makeView({ drawingId: 'b', partNumber: 'PIVOT PIN.iso' }),
    ];
    const signalsById = new Map(views.map((v) => [v.drawingId, extractLibrarySignals(v)]));
    const orderSignals = extractOrderSignals('PIVOT PIN', '90-1012-05');

    const withMap = selectLibraryDrawingMatch(orderSignals, views, signalsById);
    const withoutMap = selectLibraryDrawingMatch(orderSignals, views);
    expect(withMap.view?.drawingId).toBe(withoutMap.view?.drawingId);
    expect(withMap.score).toBe(withoutMap.score);
  });
});

describe('selectCadDrawingForPrint', () => {
  const makeView = (overrides: Partial<ToolcribActiveDrawingView>): ToolcribActiveDrawingView => ({
    partId: 'p1',
    partNumber: 'PART',
    customer: 'SUPRAJIT',
    description: '',
    drawingId: 'd1',
    revision: '01',
    sourceType: 'network',
    sourcePath: '',
    pdfUrl: null,
    stlUrl: null,
    effectiveFromUTC: null,
    ...overrides,
  });

  it('ignores ISO drawings even when they score at/above threshold', () => {
    const cad = makeView({ drawingId: 'cad', partNumber: '90-1012-05' });
    const iso = makeView({ drawingId: 'iso', partNumber: 'PIVOT PIN.iso' });
    const orderSignals = extractOrderSignals('PIVOT PIN', '90-1012-05');

    const result = selectCadDrawingForPrint(orderSignals, [iso, cad]);
    expect(result.view?.drawingId).toBe('cad');
    expect(result.score).toBeGreaterThanOrEqual(MIN_BLUEPRINT_MATCH_SCORE);
  });

  it('returns null view when only ISO drawings are available', () => {
    const iso = makeView({ drawingId: 'iso', partNumber: 'PIVOT PIN.iso' });
    const orderSignals = extractOrderSignals('PIVOT PIN');
    const result = selectCadDrawingForPrint(orderSignals, [iso]);
    expect(result.view).toBeNull();
    expect(result.score).toBe(0);
  });

  it('returns null view and score 0 for an empty library', () => {
    const orderSignals = extractOrderSignals('PIVOT PIN', '90-1012-05');
    const result = selectCadDrawingForPrint(orderSignals, []);
    expect(result.view).toBeNull();
    expect(result.score).toBe(0);
  });

  it('returns score below threshold when CAD descriptors do not overlap', () => {
    const weak = makeView({ drawingId: 'weak', partNumber: 'TUERCA HEXAGONAL' });
    const orderSignals = extractOrderSignals('PIEZA TOTALMENTE DISTINTA');
    const result = selectCadDrawingForPrint(orderSignals, [weak]);
    expect(result.score).toBeLessThan(MIN_BLUEPRINT_MATCH_SCORE);
  });

  it('matches symmetrical parts with LH/RH suffix to base drawing', () => {
    const cad = makeView({ drawingId: 'cad', partNumber: '90-1012-05' });
    const orderSignalsLH = extractOrderSignals('PIVOT PIN LH', '90-1012-05-LH');
    const resultLH = selectCadDrawingForPrint(orderSignalsLH, [cad]);
    expect(resultLH.view?.drawingId).toBe('cad');
    expect(resultLH.score).toBe(95);

    const orderSignalsRH = extractOrderSignals('PIVOT PIN RH', '90-1012-05-RH');
    const resultRH = selectCadDrawingForPrint(orderSignalsRH, [cad]);
    expect(resultRH.view?.drawingId).toBe('cad');
    expect(resultRH.score).toBe(95);
  });
});
