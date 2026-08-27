import { describe, it, expect } from 'vitest';
import { decodeInsertCode } from '../isoInsertDecoder';

describe('ISO 1832 & ANSI Insert Decoder', () => {
  it('decodes ISO CNMG 120408 correctly', () => {
    const decoded = decodeInsertCode('CNMG 120408-PM');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.shape.letter).toBe('C');
    expect(decoded.shape.name).toBe('Rombo 80°');
    expect(decoded.shape.cuttingEdges).toBe(4);
    expect(decoded.clearance.letter).toBe('N');
    expect(decoded.clearance.type).toBe('negative');
    expect(decoded.size.cuttingEdgeLengthMm).toBe(12);
    expect(decoded.thickness.thicknessMm).toBeCloseTo(4.76, 2);
    expect(decoded.noseRadius.radiusMm).toBe(0.8);
    expect(decoded.chipbreaker).toBe('PM');
    expect(decoded.compatibleHolders.some(h => h.includes('MCLNR'))).toBe(true);
  });

  it('decodes ANSI WNMG 432 correctly', () => {
    const decoded = decodeInsertCode('WNMG 432');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.shape.letter).toBe('W');
    expect(decoded.shape.name).toBe('Trígono 80°');
    expect(decoded.shape.cuttingEdges).toBe(6);
    expect(decoded.size.cuttingEdgeLengthMm).toBe(12);
    expect(decoded.thickness.thicknessMm).toBeCloseTo(4.76, 2);
    expect(decoded.noseRadius.radiusMm).toBe(0.8);
    expect(decoded.compatibleHolders.some(h => h.includes('MWLNR'))).toBe(true);
  });

  it('decodes positive insert CCMT 09T304', () => {
    const decoded = decodeInsertCode('CCMT 09T304');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    expect(decoded.shape.letter).toBe('C');
    expect(decoded.clearance.letter).toBe('C');
    expect(decoded.clearance.angleDegrees).toBe(7);
    expect(decoded.clearance.type).toBe('positive');
    expect(decoded.noseRadius.radiusMm).toBe(0.4);
    expect(decoded.compatibleHolders.some(h => h.includes('SCLCR'))).toBe(true);
  });
});
