import { describe, it, expect } from 'vitest';
import { decodeGrooveInsertCode } from '../grooveInsertDecoder';

describe('Groove & Parting Insert Decoder', () => {
  it('decodes standard MGMN parting inserts with inch dimensions', () => {
    const decoded = decodeGrooveInsertCode('MGMN 300-M');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.series).toBe('MGMN');
    expect(decoded.widthMm).toBe(3.0);
    expect(decoded.widthInch).toBeCloseTo(0.118, 3);
    expect(decoded.widthFraction).toContain('1/8');
    expect(decoded.style).toBe('parting_grooving');
    expect(decoded.compatibleHolders.some((h) => h.includes('MGEHR'))).toBe(true);
  });

  it('decodes MGMN 200 with narrow width for parting', () => {
    const decoded = decodeGrooveInsertCode('MGMN 200');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.widthMm).toBe(2.0);
    expect(decoded.widthInch).toBeCloseTo(0.079, 3);
    expect(decoded.widthFraction).toContain('5/64');
  });

  it('decodes MRMN full radius inserts for profiling and toroidal grooves', () => {
    const decoded = decodeGrooveInsertCode('MRMN 300');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.series).toBe('MRMN');
    expect(decoded.style).toBe('full_radius');
    expect(decoded.cornerNoseRadiusMm).toBe(1.5); // Radio = W / 2
    expect(decoded.styleLabel).toContain('Full Radius');
  });

  it('decodes MGGN polished inserts for aluminum', () => {
    const decoded = decodeGrooveInsertCode('MGGN 200-AL');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.series).toBe('MGGN');
    expect(decoded.style).toBe('polished_aluminum');
  });

  it('decodes Iscar / Kennametal style Self-Grip GTN and GFN inserts', () => {
    const gtn3 = decodeGrooveInsertCode('GTN-3');
    expect(gtn3).not.toBeNull();
    if (!gtn3) return;

    expect(gtn3.series).toBe('GTN');
    expect(gtn3.widthMm).toBe(3.1);
    expect(gtn3.compatibleHolders.some((h) => h.includes('SGIH'))).toBe(true);

    const gfn2 = decodeGrooveInsertCode('GFN 2');
    expect(gfn2).not.toBeNull();
    if (!gfn2) return;

    expect(gfn2.series).toBe('GFN');
    expect(gfn2.widthMm).toBe(2.2);
  });

  it('returns null for non-groove codes', () => {
    expect(decodeGrooveInsertCode('CNMG 120408')).toBeNull();
    expect(decodeGrooveInsertCode('16ER 20UN')).toBeNull();
    expect(decodeGrooveInsertCode('RANDOM')).toBeNull();
  });
});
