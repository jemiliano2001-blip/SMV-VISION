import { describe, it, expect } from 'vitest';
import { decodeThreadInsertCode } from '../threadInsertDecoder';

describe('Threading Insert Decoder (independent from ISO 1832 turning inserts)', () => {
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

  it('decodes a partial-profile internal threading insert (AG60)', () => {
    const decoded = decodeThreadInsertCode('16IR AG60');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.side).toBe('internal');
    expect(decoded.isFullProfile).toBe(false);
    expect(decoded.profileFamily).toBe('UN_60');
  });

  it('decodes an inch/TPI-style Unified threading insert', () => {
    const decoded = decodeThreadInsertCode('11ER 20UN');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.unitSystem).toBe('inch');
    expect(decoded.tpi).toBe(20);
    expect(decoded.pitchMm).toBeUndefined();
  });

  it('does not collide with ISO 1832 turning insert codes', () => {
    // CNMG/WNMG no empiezan con 2 dígitos, así que nunca deben decodificarse aquí
    expect(decodeThreadInsertCode('CNMG 120408')).toBeNull();
    expect(decodeThreadInsertCode('WNMG 080408')).toBeNull();
  });

  it('rejects an unknown size code or profile family instead of guessing', () => {
    expect(decodeThreadInsertCode('99ER 1.5 ISO')).toBeNull();
    expect(decodeThreadInsertCode('16ER 1.5 XYZ')).toBeNull();
    expect(decodeThreadInsertCode('GARBAGE')).toBeNull();
  });
});
