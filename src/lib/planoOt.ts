/**
 * Sella el blueprint ORIGINAL (con medidas) con un recuadro arriba-izquierda:
 * SO · cantidad · fecha. No recorta nada: el tornero necesita las cotas.
 * El cajetín del plano suele ir abajo-derecha, así que arriba-izquierda es
 * zona segura.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
  const pdfDoc = await PDFDocument.load(dataUrlToUint8Array(pdfDataUrl));
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  if (pages.length === 0) throw new Error('El PDF no tiene páginas.');
  const page = pages[0];
  const { height } = page.getSize();

  const fontSize = 16;
  const padding = 10;
  const margin = 12;
  const availableWidth = page.getWidth() - margin * 2;
  
  const soText = `SO: ${oneLine(stamp.soNumber) || '—'}`;
  const cantText = `CANT: ${oneLine(stamp.cantidad) || '—'}`;
  const fechaText = `FECHA: ${oneLine(stamp.fecha) || '—'}`;
  const notasText = stamp.notas && stamp.notas.trim() !== '' ? `NOTAS: ${oneLine(stamp.notas)}` : null;

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
