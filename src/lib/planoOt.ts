/**
 * Sella el blueprint ORIGINAL (con medidas) con un recuadro arriba-izquierda:
 * SO · cantidad · fecha. No recorta nada: el tornero necesita las cotas.
 * El cajetín del plano suele ir abajo-derecha, así que arriba-izquierda es
 * zona segura.
 */

// pdf-lib (~523 KB / 208 KB gzip) solo se necesita al sellar/imprimir un plano
// OT — se importa dinámicamente dentro de las funciones para no ir en el bundle inicial.

export interface PlanoOtStamp {
  soNumber: string;
  cantidad: string;
  fecha: string;
  notas?: string;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const STAMP_MAX_FONT_SIZE = 16;
const STAMP_MIN_FONT_SIZE = 6;
/** Aire mínimo entre las tres columnas del sello, en múltiplos del cuerpo. */
const STAMP_GAP_RATIO = 0.6;

/**
 * Mayor cuerpo (≤16) con el que SO + CANT + FECHA caben en una línea sin
 * encimarse. Exportada para prueba: es geometría pura, sin pdf-lib.
 */
export function fitStampFontSize(
  texts: readonly string[],
  measure: (text: string, size: number) => number,
  usableWidth: number,
): number {
  if (usableWidth <= 0) return STAMP_MIN_FONT_SIZE;
  for (let size = STAMP_MAX_FONT_SIZE; size > STAMP_MIN_FONT_SIZE; size -= 0.5) {
    const textWidth = texts.reduce((total, text) => total + measure(text, size), 0);
    const gaps = Math.max(0, texts.length - 1) * size * STAMP_GAP_RATIO;
    if (textWidth + gaps <= usableWidth) return size;
  }
  return STAMP_MIN_FONT_SIZE;
}

/** Una sola línea legible (SO/fecha pueden venir multi-línea). */
function oneLine(value: string): string {
  return (value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Toma el dataURL de un PDF y devuelve los bytes del PDF sellado en la página 1.
 */
export async function stampPlanoOt(
  pdfDataUrl: string,
  stamp: PlanoOtStamp,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(dataUrlToUint8Array(pdfDataUrl));
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  if (pages.length === 0) throw new Error('El PDF no tiene páginas.');
  const page = pages[0];
  const { height } = page.getSize();

  const padding = 10;
  const margin = 12;
  const availableWidth = page.getWidth() - margin * 2;

  const soText = `SO: ${oneLine(stamp.soNumber) || '—'}`;
  const cantText = `CANT: ${oneLine(stamp.cantidad) || '—'}`;
  const fechaText = `FECHA: ${oneLine(stamp.fecha) || '—'}`;
  const notasText = stamp.notas && stamp.notas.trim() !== '' ? `NOTAS: ${oneLine(stamp.notas)}` : null;

  // SO va a la izquierda, CANT centrado y FECHA a la derecha: en una página
  // angosta los tres se encimaban y salía "CANECHMA2026-09-04". Bajamos el
  // cuerpo hasta que las tres cadenas quepan con una separación mínima.
  const fontSize = fitStampFontSize(
    [soText, cantText, fechaText],
    (text, size) => font.widthOfTextAtSize(text, size),
    availableWidth - padding * 2,
  );

  const lineHeight = fontSize + 6;
  // Si hay notas, usamos 2 líneas de alto, si no, 1.
  const linesCount = notasText ? 2 : 1;
  const boxH = (lineHeight * linesCount) + padding * 2;

  // Ampliar el tamaño de la página para que el recuadro NUNCA obstruya el dibujo
  const extraHeight = boxH + margin * 2;
  page.setSize(page.getWidth(), height + extraHeight);
  
  const newHeight = height + extraHeight;
  const top = newHeight - margin;

  // Fondo blanco para TODA la franja nueva
  page.drawRectangle({
    x: 0, y: height, width: page.getWidth(), height: extraHeight,
    color: rgb(1, 1, 1),
  });

  // Fondo del recuadro a lo ancho de toda la página
  page.drawRectangle({
    x: margin, y: top - boxH, width: availableWidth, height: boxH,
    color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 2,
  });

  // Dibujar Línea 1: SO (Izquierda), CANT (Centro), FECHA (Derecha)
  const line1Y = top - padding - fontSize;
  
  // SO a la izquierda
  page.drawText(soText, {
    x: margin + padding,
    y: line1Y,
    size: fontSize, font, color: rgb(0, 0, 0),
  });

  // CANT al centro
  const cantWidth = font.widthOfTextAtSize(cantText, fontSize);
  page.drawText(cantText, {
    x: margin + (availableWidth / 2) - (cantWidth / 2),
    y: line1Y,
    size: fontSize, font, color: rgb(0, 0, 0),
  });

  // FECHA a la derecha
  const fechaWidth = font.widthOfTextAtSize(fechaText, fontSize);
  page.drawText(fechaText, {
    x: margin + availableWidth - padding - fechaWidth,
    y: line1Y,
    size: fontSize, font, color: rgb(0, 0, 0),
  });

  // Dibujar Línea 2: NOTAS (si existen)
  if (notasText) {
    page.drawText(notasText, {
      x: margin + padding,
      y: line1Y - lineHeight,
      size: fontSize, font, color: rgb(0.8, 0.1, 0.1), // Color rojo para resaltar las notas
    });
  }

  return pdfDoc.save();
}

/** Abre el PDF sellado en una pestaña nueva (para imprimir). */
export async function openStampedPlanoOt(
  pdfDataUrl: string,
  stamp: PlanoOtStamp,
): Promise<void> {
  const bytes = await stampPlanoOt(pdfDataUrl, stamp);
  // Copia a un ArrayBuffer "limpio" para el Blob (evita SharedArrayBuffer typing).
  const buffer = bytes.slice().buffer;
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    // Fallback: forzar descarga si el navegador bloqueó el pop-up.
    const a = document.createElement('a');
    a.href = url;
    a.download = `plano-ot-${oneLine(stamp.soNumber) || 'orden'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export interface BatchPlanoOtItem {
  pdfDataUrl: string;
  stamp: PlanoOtStamp;
  partNumber?: string;
  revision?: string;
}

/**
 * Genera un PDF combinado con todas las órdenes de trabajo selladas.
 */
export async function createStampedPlanoOtBatch(
  items: BatchPlanoOtItem[],
): Promise<Uint8Array> {
  if (items.length === 0) {
    throw new Error('No hay planos seleccionados para imprimir.');
  }

  const { PDFDocument } = await import('pdf-lib');
  const mergedDoc = await PDFDocument.create();

  for (const item of items) {
    const stampedBytes = await stampPlanoOt(item.pdfDataUrl, item.stamp);
    const subDoc = await PDFDocument.load(stampedBytes);
    const copiedPages = await mergedDoc.copyPages(subDoc, subDoc.getPageIndices());
    for (const page of copiedPages) {
      mergedDoc.addPage(page);
    }
  }

  return mergedDoc.save();
}

/**
 * Abre el lote de planos sellados en una sola pestaña para impresión continua en taller.
 */
export async function openStampedPlanoOtBatch(
  items: BatchPlanoOtItem[],
): Promise<void> {
  const bytes = await createStampedPlanoOtBatch(items);
  const buffer = bytes.slice().buffer;
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `lote-ots-${items.length}-planos.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

