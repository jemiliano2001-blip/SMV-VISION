import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { createStampedPlanoOtBatch, isValidPlanoOtMask, stampPlanoOt, wrapStampText } from '../planoOt';

const stamp = { soNumber: 'SO-18252', cantidad: '25', fecha: '2026-09-10 10:30' };
async function fixture(rotation = 0, cropped = false) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  page.drawRectangle({ x: 100, y: 100, width: 20, height: 20, color: rgb(0, 0, 0) });
  page.setRotation(degrees(rotation));
  if (cropped) page.setCropBox(50, 60, 500, 700);
  pdf.addPage([400, 500]);
  return `data:application/pdf;base64,${Buffer.from(await pdf.save()).toString('base64')}`;
}

describe('OT de impresión', () => {
  it('acepta recuadros válidos y rechaza NaN, áreas vacías y zonas fuera de página', () => {
    expect(isValidPlanoOtMask({ x: 0.4, y: 0.8, width: 0.1, height: 0.02 })).toBe(true);
    for (const invalid of [
      { x: NaN, y: 0, width: 0.1, height: 0.1 },
      { x: -0.1, y: 0, width: 0.1, height: 0.1 },
      { x: 0, y: 0, width: 0, height: 0.1 },
      { x: 0.95, y: 0, width: 0.1, height: 0.1 },
      { x: 0, y: 0.95, width: 0.1, height: 0.1 },
    ]) expect(isValidPlanoOtMask(invalid)).toBe(false);
  });

  it('envuelve notas e identificadores largos sin rebasar el ancho', () => {
    const text = 'SO-MUY-LARGA-SIN-ESPACIOS-123456789';
    const lines = wrapStampText(text, t => t.length * 10, 100);
    expect(lines.join('')).toBe(text);
    expect(lines.every(line => line.length <= 10)).toBe(true);
    expect(() => wrapStampText(text, t => t.length, NaN)).toThrow();
  });

  it.each([0, 90, 180, 270])('normaliza la orientación %i y respeta CropBox/páginas posteriores', async rotation => {
    const source = await fixture(rotation, true);
    const bytes = await stampPlanoOt(source, { ...stamp, quantityMask: { x: 0.4, y: 0.8, width: 0.1, height: 0.02 } });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getRotation().angle).toBe(0);
    expect(pdf.getPage(0).getWidth()).toBe(rotation % 180 ? 700 : 500);
    expect(pdf.getPage(0).getHeight()).toBeGreaterThan(rotation % 180 ? 500 : 700);
    expect(pdf.getPage(1).getSize()).toEqual({ width: 400, height: 500 });
    const original = await PDFDocument.load(source.split(',')[1]);
    expect(original.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
    expect(original.getPage(0).getRotation().angle).toBe(rotation);
  });

  it('conserva encabezados y notas largos agregando altura', async () => {
    const source = await fixture();
    const short = await PDFDocument.load(await stampPlanoOt(source, stamp));
    const long = await PDFDocument.load(await stampPlanoOt(source, { ...stamp, notas: 'Acabado especial. '.repeat(30) }));
    expect(long.getPage(0).getHeight()).toBeGreaterThan(short.getPage(0).getHeight());
  });

  it('falla ante selección inválida en vez de imprimir una máscara desplazada', async () => {
    await expect(stampPlanoOt(await fixture(), { ...stamp, quantityMask: { x: Infinity, y: 0, width: 1, height: 1 } })).rejects.toThrow('zona');
  });

  it('mantiene compatible la impresión en lote sin recuadro', async () => {
    const source = await fixture();
    const bytes = await createStampedPlanoOtBatch([{ pdfDataUrl: source, stamp }, { pdfDataUrl: source, stamp }]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(4);
  });
});
