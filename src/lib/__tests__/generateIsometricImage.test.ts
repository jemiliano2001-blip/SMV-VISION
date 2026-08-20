import { describe, expect, it } from 'vitest';
import {
  canGenerateAiIsometric,
  extractGeneratedImageDataUrl,
  isRealIsoPdfLabel,
} from '../generateIsometricImage';

describe('extractGeneratedImageDataUrl', () => {
  it('returns null for empty parts', () => {
    expect(extractGeneratedImageDataUrl(undefined)).toBeNull();
    expect(extractGeneratedImageDataUrl([])).toBeNull();
  });

  it('builds data URL from first inline image part', () => {
    const url = extractGeneratedImageDataUrl([
      { inlineData: { data: 'abc123', mimeType: 'image/png' } },
    ]);
    expect(url).toBe('data:image/png;base64,abc123');
  });

  it('defaults mime to image/png when missing', () => {
    const url = extractGeneratedImageDataUrl([
      { inlineData: { data: 'xyz' } },
    ]);
    expect(url).toBe('data:image/png;base64,xyz');
  });
});

describe('isRealIsoPdfLabel / canGenerateAiIsometric', () => {
  it('detects ISO labels case-insensitively', () => {
    expect(isRealIsoPdfLabel('FOO.ISO.pdf')).toBe(true);
    expect(isRealIsoPdfLabel('foo.iso')).toBe(true);
    expect(isRealIsoPdfLabel('FOO_CAD.pdf')).toBe(false);
  });

  it('allows AI gen only with 2D source and non-ISO label', () => {
    expect(
      canGenerateAiIsometric({
        sourceImageDataUrl: 'data:image/jpeg;base64,xx',
        sourcePdfName: 'PART.pdf',
      }),
    ).toBe(true);
    expect(
      canGenerateAiIsometric({
        sourceImageDataUrl: 'data:image/jpeg;base64,xx',
        sourcePdfName: 'PART.ISO.pdf',
      }),
    ).toBe(false);
    expect(
      canGenerateAiIsometric({
        sourcePdfName: 'PART.pdf',
      }),
    ).toBe(false);
  });
});
