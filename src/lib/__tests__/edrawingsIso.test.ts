import { describe, expect, it } from 'vitest';
import {
  buildIsoPartNumber,
  buildIsoPdfFileName,
  parseEDrawingFileName,
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

describe('buildIsoPartNumber', () => {
  it('appends .ISO once', () => {
    expect(buildIsoPartNumber('ABC-123')).toBe('ABC-123.ISO');
    expect(buildIsoPartNumber('ABC-123.ISO')).toBe('ABC-123.ISO');
  });

  it('names pdf with .ISO in the stem', () => {
    expect(buildIsoPdfFileName('ABC-123').toLowerCase()).toContain('.iso.pdf');
  });
});
