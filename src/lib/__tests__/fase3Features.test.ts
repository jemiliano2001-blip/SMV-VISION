import { describe, it, expect } from 'vitest';
import { parseBlueprintResponse } from '../blueprintParsers';
import { generateOrdersCsv } from '../excelExport';
import type { Order } from '../../types';

describe('parseBlueprintResponse with title block metadata', () => {
  it('parses piece label, bounding box, material, hardness, and treatments', () => {
    const rawJson = JSON.stringify([
      {
        pieza_detectada: 'PUNZON FORMADOR',
        isometricBoundingBox: [100, 150, 600, 750],
        material: 'D2',
        dureza: '58-60 HRC',
        tratamiento: 'TEMPLE Y REVENIDO',
        acabado: 'RECTIFICADO',
      },
    ]);

    const specs = parseBlueprintResponse(rawJson);
    expect(specs).toHaveLength(1);
    expect(specs[0].pieza_detectada).toBe('PUNZON FORMADOR');
    expect(specs[0].isometricBoundingBox).toEqual([100, 150, 600, 750]);
    expect(specs[0].material).toBe('D2');
    expect(specs[0].dureza).toBe('58-60 HRC');
    expect(specs[0].tratamiento).toBe('TEMPLE Y REVENIDO');
    expect(specs[0].acabado).toBe('RECTIFICADO');
  });

  it('sanitizes runaway LLM reasoning or prompt leakage into null', () => {
    const rawJson = JSON.stringify([
      {
        pieza_detectada: 'BLADE CUTTER',
        isometricBoundingBox: [100, 150, 600, 750],
        material: '4150',
        dureza: 'null',
        tratamiento:
          'PARAMETRO DETECTADO POR COLORACIÓN OSCURA (OPCIONAL O NO ESPECIFICADO EN TEXTO DETALLADO, RECOMENDADO DEJAR NULL SI NO SE ASEGURA CON TEXTO DIRECTO - POR REGLA 10: NULL EN CASO DE DUDA NO INVENTAR DESCRIPCIÓN EXTRAVAGANTE)',
        acabado: 'none',
      },
    ]);

    const specs = parseBlueprintResponse(rawJson);
    expect(specs).toHaveLength(1);
    expect(specs[0].material).toBe('4150');
    expect(specs[0].dureza).toBeNull();
    expect(specs[0].tratamiento).toBeNull();
    expect(specs[0].acabado).toBeNull();
  });
});

describe('generateOrdersCsv', () => {
  it('generates valid Excel-compatible CSV with UTF-8 BOM', () => {
    const testOrders: Order[] = [
      {
        pieza: 'PUNZON "SPECIAL", CORTE',
        numero_parte: '90-1012-05',
        cantidad: '10',
        orden: '2026/S00100',
        poNumber: 'PO-5544',
        fecha: '2026-08-20',
        prioridad: 'URGENTE',
        material: 'D2',
        dureza: '60 HRC',
        tratamiento: 'TEMPLADO',
        acabado: 'RECTIFICADO',
        sourcePdfName: '90-1012-05.pdf',
        matchScore: 95,
        isometricSource: 'crop',
        isometricView: 'data:image/jpeg;base64,...',
      },
    ];

    const csv = generateOrdersCsv(testOrders);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('SO (Orden)');
    expect(csv).toContain('Material');
    expect(csv).toContain('Dureza');
    expect(csv).toContain('"PUNZON ""SPECIAL"", CORTE"');
    expect(csv).toContain('"D2"');
    expect(csv).toContain('"60 HRC"');
    expect(csv).toContain('Recorte CAD');
  });

  it('neutralizes spreadsheet formulas from Odoo fields', () => {
    const csv = generateOrdersCsv([{
      pieza: '=HYPERLINK("https://malicious.example", "abrir")',
      cantidad: '1', orden: '2026/S00101', fecha: '2026-08-21', prioridad: 'Normal',
    }]);

    expect(csv).toContain(`"'=HYPERLINK(""https://malicious.example"", ""abrir"")"`);
  });
});
