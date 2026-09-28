import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import {
  cleanFilename,
  createStampedPlanoOtBatch,
  createStampedPlanoOtSet,
  isValidPlanoOtMask,
  sanitizeWinAnsi,
  stampDetailLine,
  stampPlanoOt,
  wrapStampText,
} from '../planoOt';

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
    // La hoja de salida conserva el tamaño del CropBox normalizado: el sello
    // se acomoda encogiendo el plano hacia abajo, nunca crece la página
    // (eso es justo lo que antes dejaba bandas muertas al imprimir en papel real).
    expect(pdf.getPage(0).getWidth()).toBe(rotation % 180 ? 700 : 500);
    expect(pdf.getPage(0).getHeight()).toBe(rotation % 180 ? 500 : 700);
    expect(pdf.getPage(1).getSize()).toEqual({ width: 400, height: 500 });
    const original = await PDFDocument.load(source.split(',')[1]);
    expect(original.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
    expect(original.getPage(0).getRotation().angle).toBe(rotation);
  });

  it('mantiene el tamaño de página igual sin importar el largo de las notas', async () => {
    const source = await fixture();
    const short = await PDFDocument.load(await stampPlanoOt(source, stamp));
    const long = await PDFDocument.load(await stampPlanoOt(source, { ...stamp, notas: 'Acabado especial. '.repeat(10) }));
    expect(long.getPage(0).getSize()).toEqual(short.getPage(0).getSize());
  });

  it('rechaza notas tan largas que encogerían el plano más de la mitad', async () => {
    await expect(stampPlanoOt(await fixture(), { ...stamp, notas: 'Acabado especial. '.repeat(60) }))
      .rejects.toThrow('Acórtalas');
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

describe('PO en el sello de la OT', () => {
  it('agrega la PO junto a la fecha y la omite si viene vacía', () => {
    expect(stampDetailLine({ fecha: '2026-09-24 10:00', poNumber: '00089314' }))
      .toBe('FECHA: 2026-09-24 10:00     PO: 00089314');
    expect(stampDetailLine({ fecha: '2026-09-24 10:00', poNumber: '  ' })).toBe('FECHA: 2026-09-24 10:00');
    expect(stampDetailLine({ fecha: '' })).toBe('FECHA: —');
  });

  it('sella un plano con PO sin cambiar el número de páginas', async () => {
    const bytes = await stampPlanoOt(await fixture(), { ...stamp, poNumber: '00089314' });
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2);
  });
});

describe('Ficha de Pizarrón y Encabezado Slim', () => {
  it('genera sólo la ficha de pizarrón (1 página con 2 tarjetas) en mode=board_ticket', async () => {
    const bytes = await stampPlanoOt(await fixture(), {
      ...stamp,
      mode: 'board_ticket',
      partNumber: '386306',
      customer: 'SUPRAJIT',
      piezaDescripcion: 'Cuchilla con filo',
    });
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    expect(out.getPage(0).getWidth()).toBe(600);
    expect(out.getPage(0).getHeight()).toBe(800);
  });

  it('genera ficha de pizarrón + plano de taller en mode=both (pág 1 ficha, pág 2 plano)', async () => {
    const bytes = await stampPlanoOt(await fixture(), {
      ...stamp,
      mode: 'both',
      partNumber: '386306',
      customer: 'SUPRAJIT',
    });
    const out = await PDFDocument.load(bytes);
    // 1 ficha + 2 páginas originales del fixture = 3 páginas
    expect(out.getPageCount()).toBe(3);
  });

  it('admite headerStyle=classic y headerStyle=slim', async () => {
    const slimBytes = await stampPlanoOt(await fixture(), { ...stamp, headerStyle: 'slim' });
    const classicBytes = await stampPlanoOt(await fixture(), { ...stamp, headerStyle: 'classic' });
    expect((await PDFDocument.load(slimBytes)).getPageCount()).toBe(2);
    expect((await PDFDocument.load(classicBytes)).getPageCount()).toBe(2);
  });
});

describe('Sanitización y Programación Defensiva', () => {
  it('cleanFilename elimina slashes, comillas, dos puntos y espacios para descargas seguras', () => {
    expect(cleanFilename('2026/S01991')).toBe('2026-S01991');
    expect(cleanFilename('PLANO "ESPECIAL": 1/2"')).toBe('PLANO_-ESPECIAL-_1-2-');
    expect(cleanFilename('')).toBe('orden');
    expect(cleanFilename(null)).toBe('orden');
  });

  it('sanitizeWinAnsi convierte comillas tipográficas, guiones largos, bullets y emojis a caracteres seguros', () => {
    expect(sanitizeWinAnsi('“Prueba de comillas”')).toBe('"Prueba de comillas"');
    expect(sanitizeWinAnsi("‘Cuchilla’")).toBe("'Cuchilla'");
    expect(sanitizeWinAnsi('Taller — SMV')).toBe('Taller - SMV');
    expect(sanitizeWinAnsi('• Paso 1 • Paso 2')).toBe('* Paso 1 * Paso 2');
    expect(sanitizeWinAnsi('Liberación ✓')).toBe('Liberación [OK]');
    expect(sanitizeWinAnsi('Emoji 🚀')).toBe('Emoji ?');
    expect(sanitizeWinAnsi(null)).toBe('');
  });

  it('sella un plano con notas y descripciones con caracteres tipográficos sin arrojar error WinAnsi', async () => {
    const source = await fixture();
    const bytes = await stampPlanoOt(source, {
      ...stamp,
      notas: '“Atención: verificar cara posterior” • Requisito crítico — Inspección ✓',
      piezaDescripcion: 'Cuchilla con tratamiento ‘dureza 58-62 HRC’',
      mode: 'both',
    });
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(3);
  });
});

describe('Juegos de Planos Complementarios (createStampedPlanoOtSet)', () => {
  it('combina plano base y hoja 2 en un solo PDF ordenado con Ficha + Planos', async () => {
    const source1 = await fixture();
    const source2 = await fixture();

    const items = [
      {
        pdfDataUrl: source1,
        partNumber: '90-1012-06',
        description: 'PUNZON DE CORTE',
      },
      {
        pdfDataUrl: source2,
        partNumber: '90-1012-06-2',
        companionLabel: 'Hoja 2',
        isCompanion: true,
      },
    ];

    const bytes = await createStampedPlanoOtSet(items, {
      ...stamp,
      mode: 'both',
      headerStyle: 'slim',
    });

    const out = await PDFDocument.load(bytes);
    // 1 página de Ficha Pizarrón + 2 páginas de source1 + 2 páginas de source2 (el fixture tiene 2 pág) = 5 páginas
    expect(out.getPageCount()).toBe(5);
  });
});



