import { describe, expect, it } from 'vitest';
import type { PlanoOtStamp } from '../planoOt';
import { buildSeparatePrintJobs, type SetPrintPiece } from '../setPrintJobs';

const baseStamp: PlanoOtStamp = {
  soNumber: 'SO-1234',
  cantidad: '10',
  fecha: '2026-09-29 10:00',
  poNumber: 'PO-9',
  notas: '',
  partNumber: '1012-05-CHICO',
  customer: 'SUPRAJIT',
  piezaDescripcion: 'Hex swage block',
  mode: 'both',
  headerStyle: 'slim',
  quantityMask: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
};

const pieces: SetPrintPiece[] = [
  { pdfDataUrl: 'data:a', partNumber: '1012-05-CHICO', description: 'Chica', cantidadPorJuego: 1, permanentNotes: ['Rebabear'] },
  { pdfDataUrl: 'data:b', partNumber: '1012-05-GRANDE', description: 'Grande', companionLabel: 'Mitad Grande', customer: 'SUPRAJIT', cantidadPorJuego: 2, permanentNotes: [] },
];

describe('buildSeparatePrintJobs', () => {
  it('genera un trabajo por pieza con SO, PO y fecha compartidos', () => {
    const jobs = buildSeparatePrintJobs(pieces, baseStamp, 10, 'Urgente');
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.stamp.soNumber === 'SO-1234' && j.stamp.poNumber === 'PO-9')).toBe(true);
    expect(jobs.every((j) => j.stamp.fecha === '2026-09-29 10:00')).toBe(true);
  });

  it('multiplica la cantidad por las piezas por juego', () => {
    const jobs = buildSeparatePrintJobs(pieces, baseStamp, 10, '');
    expect(jobs.map((j) => j.stamp.cantidad)).toEqual(['10', '20']);
  });

  it('solo la pieza base conserva la máscara de cantidad', () => {
    const jobs = buildSeparatePrintJobs(pieces, baseStamp, 10, '');
    expect(jobs[0].stamp.quantityMask).not.toBeNull();
    expect(jobs[1].stamp.quantityMask).toBeNull();
  });

  it('cada pieza lleva sus notas permanentes y la nota de la corrida', () => {
    const jobs = buildSeparatePrintJobs(pieces, baseStamp, 10, 'Urgente');
    expect(jobs[0].stamp.notas).toBe('Rebabear · Urgente');
    expect(jobs[1].stamp.notas).toBe('Urgente');
  });

  it('cada pieza usa su número de parte, cliente y descripción con el rol', () => {
    const jobs = buildSeparatePrintJobs(pieces, baseStamp, 10, '');
    expect(jobs[1].stamp.partNumber).toBe('1012-05-GRANDE');
    expect(jobs[1].stamp.piezaDescripcion).toBe('Grande · Mitad Grande');
    expect(jobs[0].stamp.customer).toBe('SUPRAJIT');
  });

  it('no modifica el sello base recibido', () => {
    buildSeparatePrintJobs(pieces, baseStamp, 10, 'x');
    expect(baseStamp.notas).toBe('');
    expect(baseStamp.cantidad).toBe('10');
  });
});
