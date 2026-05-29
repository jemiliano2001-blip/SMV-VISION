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

  const lines = [
    `SO: ${oneLine(stamp.soNumber) || '—'}`,
    `CANT: ${oneLine(stamp.cantidad) || '—'}`,
    `FECHA: ${oneLine(stamp.fecha) || '—'}`,
  ];
  const fontSize = 11;
  const padding = 6;
  const lineHeight = fontSize + 4;
  const boxW = Math.max(
    ...lines.map((l) => font.widthOfTextAtSize(l, fontSize)),
  ) + padding * 2;
  const boxH = lineHeight * lines.length + padding;
  const margin = 12;
  const top = height - margin;

  // Fondo blanco con borde negro para legibilidad sobre el dibujo.
  page.drawRectangle({
    x: margin, y: top - boxH, width: boxW, height: boxH,
    color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1.5,
  });
  lines.forEach((line, i) => {
    page.drawText(line, {
      x: margin + padding,
      y: top - padding - fontSize - i * lineHeight,
      size: fontSize, font, color: rgb(0, 0, 0),
    });
  });

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
