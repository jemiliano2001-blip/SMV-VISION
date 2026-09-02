import { describe, it, expect } from 'vitest';
import { decodeThreadInsertCode } from '../threadInsertDecoder';

describe('Threading Insert Decoder (ANSI & ISO inch-first)', () => {
  it('decodes a full-profile external metric threading insert', () => {
    const decoded = decodeThreadInsertCode('16ER 1.5 ISO');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.side).toBe('external');
    expect(decoded.hand).toBe('right');
    expect(decoded.sizeCode).toBe('16');
    expect(decoded.isFullProfile).toBe(true);
    expect(decoded.pitchMm).toBe(1.5);
    expect(decoded.profileFamily).toBe('ISO_METRIC_60');
  });

  it('decodes an ANSI 1-digit style insert (3ER 14UN = size 16)', () => {
    const decoded = decodeThreadInsertCode('3ER 14UN');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.sizeCode).toBe('16');
    expect(decoded.ansiSizeCode).toBe('3ER');
    expect(decoded.inscribedCircleInch).toContain('3/8"');
    expect(decoded.tpi).toBe(14);
    expect(decoded.profileFamily).toBe('UN_60');
    expect(decoded.isFullProfile).toBe(true);
  });

  it('decodes partial-profile internal threading inserts (3IR AG60, A60, G60)', () => {
    const ag60 = decodeThreadInsertCode('3IR AG60');
    expect(ag60).not.toBeNull();
    if (!ag60) return;

    expect(ag60.side).toBe('internal');
    expect(ag60.isFullProfile).toBe(false);
    expect(ag60.tpiRange).toBe('48 - 8 TPI');

    const g60 = decodeThreadInsertCode('16ER G60');
    expect(g60).not.toBeNull();
    if (!g60) return;
    expect(g60.tpiRange).toBe('14 - 8 TPI');
  });

  it('decodes NPT pipe thread full-profile inserts', () => {
    const npt = decodeThreadInsertCode('16ER 18NPT');
    expect(npt).not.toBeNull();
    if (!npt) return;

    expect(npt.profileFamily).toBe('NPT_60');
    expect(npt.tpi).toBe(18);
    expect(npt.isFullProfile).toBe(true);
  });

  it('decodes ACME and UNJ aerospace inserts', () => {
    const acme = decodeThreadInsertCode('3ER 10ACME');
    expect(acme).not.toBeNull();
    if (!acme) return;

    expect(acme.profileFamily).toBe('ACME_29');
    expect(acme.tpi).toBe(10);

    const unj = decodeThreadInsertCode('16ER 16UNJ');
    expect(unj).not.toBeNull();
    if (!unj) return;

    expect(unj.profileFamily).toBe('UNJ_60');
    expect(unj.tpi).toBe(16);
  });

  it('does not collide with ISO 1832 turning insert codes or grooving codes', () => {
    expect(decodeThreadInsertCode('CNMG 120408')).toBeNull();
    expect(decodeThreadInsertCode('WNMG 080408')).toBeNull();
    expect(decodeThreadInsertCode('MGMN 300')).toBeNull();
  });

  it('rejects an unknown size code or profile family instead of guessing', () => {
    expect(decodeThreadInsertCode('99ER 1.5 ISO')).toBeNull();
    expect(decodeThreadInsertCode('16ER 1.5 XYZ')).toBeNull();
    expect(decodeThreadInsertCode('GARBAGE')).toBeNull();
  });
});
