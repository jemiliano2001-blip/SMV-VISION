import { describe, it, expect } from 'vitest';
import { normalizeToolcribPrintLog } from '../firebase/toolcribValidators';
import { matchesFamily } from '../toolcribCatalog';
import type { ToolcribActiveDrawingView } from '../../types';

describe('normalizeToolcribPrintLog', () => {
  it('normalizes valid raw print log object', () => {
    const raw = {
      drawingId: 'dwg_123',
      partId: 'part_456',
      copies: 3,
      orderRef: '2026/S00781',
      origin: 'toolcrib-v1-ui',
      printedByUid: 'user_abc',
      printedAtUTC: '2026-08-20T20:00:00.000Z',
    };
    const res = normalizeToolcribPrintLog('log_1', raw);
    expect(res).not.toBeNull();
    expect(res?.id).toBe('log_1');
    expect(res?.drawingId).toBe('dwg_123');
    expect(res?.copies).toBe(3);
    expect(res?.orderRef).toBe('2026/S00781');
    expect(res?.printedByUid).toBe('user_abc');
  });

  it('rejects invalid objects missing drawingId or partId', () => {
    expect(normalizeToolcribPrintLog('log_2', null)).toBeNull();
    expect(normalizeToolcribPrintLog('log_3', { drawingId: '' })).toBeNull();
    expect(normalizeToolcribPrintLog('log_4', { drawingId: 'dwg_1', partId: '' })).toBeNull();
  });
});

describe('matchesFamily', () => {
  const baseView: ToolcribActiveDrawingView = {
    partId: 'p1',
    partNumber: '90-1012-05',
    customer: 'SUPRAJIT',
    description: 'PUNZON DE MARCA M',
    drawingId: 'd1',
    revision: 'A',
    sourceType: 'storage',
    sourcePath: 'toolcrib/uploads/PUNZON_90-1012-05.pdf',
    pdfUrl: 'https://example.com/p1.pdf',
    stlUrl: null,
    effectiveFromUTC: null,
  };

  it('matches all family', () => {
    expect(matchesFamily(baseView, 'all')).toBe(true);
  });

  it('matches punzones correctly', () => {
    expect(matchesFamily(baseView, 'punzones')).toBe(true);
    expect(
      matchesFamily(
        {
          ...baseView,
          description: 'MATRIZ DE CORTE',
          sourcePath: 'toolcrib/uploads/MATRIZ_90.pdf',
        },
        'punzones',
      ),
    ).toBe(false);
  });

  it('matches matrices correctly', () => {
    const matrizView = { ...baseView, partNumber: 'MAT-01', description: 'MATRIZ INFERIOR DIE' };
    expect(matchesFamily(matrizView, 'matrices')).toBe(true);
  });

  it('matches bujes correctly', () => {
    const bujeView = { ...baseView, partNumber: 'BUJ-01', description: 'BUJE GUIA TEMPLADO' };
    expect(matchesFamily(bujeView, 'bujes')).toBe(true);
  });

  it('matches placas correctly', () => {
    const placaView = { ...baseView, partNumber: 'PLC-01', description: 'PLACA BASE DE MONTAJE' };
    expect(matchesFamily(placaView, 'placas')).toBe(true);
  });

  it('matches gavilanes/cuchillas correctly', () => {
    const gavilanView = { ...baseView, partNumber: 'GAV-01', description: 'GAVILAN DE CORTE' };
    expect(matchesFamily(gavilanView, 'cuchillas')).toBe(true);
  });

  it('matches ensambles correctly', () => {
    const ensambleView = { ...baseView, partNumber: 'ENS-01', description: 'DISPOSITIVO FIXTURE DE CONTROL' };
    expect(matchesFamily(ensambleView, 'ensambles')).toBe(true);
  });
});
