import { describe, it, expect } from 'vitest';
import { generateJobTravelersPdf } from '../pdfGenerator';
import type { Order } from '../../types';

describe('Job Traveler PDF Generator (Setup Sheets)', () => {
  const sampleOrders: Order[] = [
    {
      pieza: 'PISTON GUIA DE SUJECION',
      numero_parte: 'PG-5020-01',
      cantidad: '12 Pieza',
      orden: 'SO0942',
      fecha: '2026-09-02',
      prioridad: 'Normal',
      poNumber: 'PO-98214',
      isometricView: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD',
      isometricSource: 'crop',
      material: 'ACERO 4140 BONIFICADO',
      dureza: '28-32 HRC',
      acabado: '32 Ra',
      sourcePdfName: 'PG-5020-01_REV_B.pdf',
      matchedDrawingRevision: 'B',
    },
    {
      pieza: 'BUSHING ESPACIADOR',
      numero_parte: 'BS-102',
      cantidad: '25 Pieza',
      orden: 'SO0943',
      fecha: '2026-09-02',
      prioridad: 'Normal',
      poNumber: 'PO-98215',
      isometricView: undefined,
      isometricSource: undefined,
    },
  ];

  it('runs generateJobTravelersPdf for multiple orders without crashing', async () => {
    await expect(
      generateJobTravelersPdf(sampleOrders, { customer: 'SUPRAJIT TEST' })
    ).resolves.not.toThrow();
  });

  it('runs generateJobTravelersPdf for a single order gracefully', async () => {
    await expect(
      generateJobTravelersPdf([sampleOrders[0]], { filename: 'test_traveler.pdf' })
    ).resolves.not.toThrow();
  });

  it('handles empty orders array by returning early without throwing', async () => {
    await expect(generateJobTravelersPdf([])).resolves.not.toThrow();
  });
});
