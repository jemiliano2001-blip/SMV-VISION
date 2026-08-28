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

  it('rejects codes with an unrecognized shape letter instead of guessing', () => {
    // Antes: cualquier letra no reconocida en la posición de forma se mostraba como
    // "Rombo 80°" con dimensiones inventadas. Ahora debe rechazarse.
    expect(decodeInsertCode('HOLA123')).toBeNull();
  });

  it('rejects a threading insert code (not an ISO 1832 turning/milling shape)', () => {
    // Los insertos de roscar (16ER 1.5 ISO, 16IR AG60) usan una designación completamente
    // distinta a ISO 1832 — no deben decodificarse como si fueran un inserto de torneado.
    expect(decodeInsertCode('16ER 1.5 ISO')).toBeNull();
    expect(decodeInsertCode('16IR AG60')).toBeNull();
  });

  it('rejects a grooving insert code (MGMN uses its own designation system)', () => {
    expect(decodeInsertCode('MGMN 300-M')).toBeNull();
  });

  it('rejects an unrecognized clearance/tolerance/fixing letter', () => {
    expect(decodeInsertCode('CZMG 120408')).toBeNull(); // 'Z' no es un desahogo válido
  });

  it('never shows a thickness/radius/IC in mm that contradicts its own inch label', () => {
    const decoded = decodeInsertCode('CNMG 120408');
    expect(decoded).not.toBeNull();
    if (!decoded) return;

    // Regresión del bug real: CCMT 09T304 mostraba "3.97mm" junto con "3/16\"" (que en
    // realidad son 4.76mm) — verificamos que el texto en pulgadas siempre se derive del mm.
    const mmToInches = (mm: number) => mm / 25.4;
    const parseFractionInch = (label: string): number => {
      const match = label.match(/(\d+)\/(\d+)"/);
      if (!match) throw new Error(`No se pudo parsear fracción de: ${label}`);
      return Number(match[1]) / Number(match[2]);
    };

    expect(parseFractionInch(decoded.thickness.thicknessInch)).toBeCloseTo(
      mmToInches(decoded.thickness.thicknessMm), 2
    );
    expect(parseFractionInch(decoded.noseRadius.radiusInch)).toBeCloseTo(
      mmToInches(decoded.noseRadius.radiusMm), 2
    );
    expect(parseFractionInch(decoded.size.inscribedCircleInch)).toBeCloseTo(
      mmToInches(decoded.size.inscribedCircleMm), 2
    );
  });

  it('marks ANSI 3-digit dimensions as exact and ISO 6-digit size as estimated', () => {
    const ansi = decodeInsertCode('CNMG 432');
    expect(ansi).not.toBeNull();
    if (ansi) {
      expect(ansi.thickness.isEstimate).toBe(false);
      expect(ansi.noseRadius.isEstimate).toBe(false);
    }

    const iso = decodeInsertCode('CNMG 120408');
    expect(iso).not.toBeNull();
    if (iso) {
      expect(iso.size.isEstimate).toBe(true);
    }
  });
});
