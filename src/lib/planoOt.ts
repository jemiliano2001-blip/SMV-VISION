/**
 * Agrega una franja de OT fuera del dibujo y cubre únicamente la región
 * seleccionada por el operador en la copia de impresión. No modifica la fuente.
 */

// pdf-lib (~523 KB / 208 KB gzip) solo se necesita al sellar/imprimir un plano
// OT — se importa dinámicamente dentro de las funciones para no ir en el bundle inicial.

export interface PlanoOtStamp {
  soNumber: string;
  cantidad: string;
  fecha: string;
  notas?: string;
  quantityMask?: PlanoOtMask | null;
}

/** Fracciones de la primera página visible, con origen arriba-izquierda. */
export interface PlanoOtMask { x: number; y: number; width: number; height: number }

export function isValidPlanoOtMask(mask: PlanoOtMask): boolean {
  return !!mask && [mask.x, mask.y, mask.width, mask.height].every(Number.isFinite)
    && mask.x >= 0 && mask.y >= 0 && mask.width > 0 && mask.height > 0
    && mask.x + mask.width <= 1.000001 && mask.y + mask.height <= 1.000001;
}

/** Envuelve incluso identificadores sin espacios; nunca reduce la letra. */
export function wrapStampText(text: string, measure: (text: string) => number, width: number): string[] {
  if (!Number.isFinite(width) || width <= 0) throw new Error('Ancho de encabezado inválido.');
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    if (line && measure(line + char) > width) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += char;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
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
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib');
  const source = await PDFDocument.load(dataUrlToUint8Array(pdfDataUrl));
  if (source.getPageCount() === 0) throw new Error('El PDF no tiene páginas.');
  if (stamp.quantityMask && !isValidPlanoOtMask(stamp.quantityMask)) {
    throw new Error('La zona a ocultar no es válida. Vuelve a seleccionarla.');
  }
  // Normalizar CropBox y rotación: selección y salida comparten la misma
  // página visible, incluso en planos apaisados con /Rotate=90.
  const original = source.getPage(0);
  const crop = original.getCropBox();
  const rotation = ((original.getRotation().angle % 360) + 360) % 360;
  const sideways = rotation === 90 || rotation === 270;
  const width = sideways ? crop.height : crop.width;
  const height = sideways ? crop.width : crop.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 100 || height < 100) {
    throw new Error('El tamaño del plano no permite preparar una OT legible.');
  }
  const pdfDoc = await PDFDocument.create();
  const embedded = original.node.Contents() ? await pdfDoc.embedPage(original, {
    left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height,
  }) : null;
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = width * 0.02;
  const padding = width * 0.016;
  const usableWidth = width - (margin + padding) * 2;
  // Tamaño proporcional al papel: también se lee en PDFs exportados pequeños.
  const largeSize = width * 0.044;
  const detailSize = width * 0.03;
  const soText = `SO: ${oneLine(stamp.soNumber) || '—'}`;
  const cantText = `CANT: ${oneLine(stamp.cantidad) || '—'}`;
  const primary = `${soText}     ${cantText}`;
  const rows = wrapStampText(primary, t => font.widthOfTextAtSize(t, largeSize), usableWidth)
    .map(text => ({ text, size: largeSize, notes: false }));
  for (const [text, notes] of [
    [`FECHA: ${oneLine(stamp.fecha) || '—'}`, false],
    ...(oneLine(stamp.notas) ? [[`NOTAS: ${oneLine(stamp.notas)}`, true]] : []),
  ] as [string, boolean][]) {
    rows.push(...wrapStampText(text, t => font.widthOfTextAtSize(t, detailSize), usableWidth)
      .map(text => ({ text, size: detailSize, notes })));
  }
  const boxH = padding * 2 + rows.reduce((sum, row) => sum + row.size * 1.3, 0);
  // El sello vive DENTRO de la hoja original — nunca la crece. Agregar alto
  // extra cambia la proporción ancho:alto de la página, y al imprimir en papel
  // estándar el visor la ajusta y deja bandas muertas a los lados. En vez de
  // eso, el plano se encoge un poco y se recorre hacia abajo para abrir espacio
  // arriba, así la hoja de salida conserva el tamaño/proporción del plano fuente.
  const headerHeight = boxH + margin * 2;
  const scale = (height - headerHeight) / height;
  if (scale < 0.5) {
    throw new Error('Las notas son muy largas para caber sin reducir demasiado el plano. Acórtalas.');
  }
  const availableHeight = height * scale;
  const xOffset = (width - width * scale) / 2;
  const page = pdfDoc.addPage([width, height]);
  if (embedded) page.drawPage(embedded, {
    x: rotation === 180 || rotation === 270 ? xOffset + width * scale : xOffset,
    y: rotation === 90 || rotation === 180 ? availableHeight : 0,
    xScale: scale,
    yScale: scale,
    rotate: degrees(-rotation),
  });
  const mask = stamp.quantityMask;
  if (mask) {
    // Cubierta visual para impresión, no redacción de datos confidenciales.
    // Mismo escalado/offset que el plano incrustado, para seguir cubriendo lo correcto.
    page.drawRectangle({
      x: xOffset + mask.x * width * scale, y: (1 - mask.y - mask.height) * height * scale,
      width: mask.width * width * scale, height: mask.height * height * scale, color: rgb(1, 1, 1),
    });
  }
  page.drawRectangle({
    x: margin, y: availableHeight + margin, width: width - margin * 2, height: boxH,
    color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 2,
  });
  let y = height - margin - padding;
  for (const row of rows) {
    y -= row.size;
    page.drawText(row.text, { x: margin + padding, y, size: row.size, font,
      color: row.notes ? rgb(0.8, 0.1, 0.1) : rgb(0, 0, 0) });
    y -= row.size * 0.3;
  }
  // Las páginas restantes se conservan; la OT y su selección son de página 1.
  const remaining = source.getPageIndices().slice(1);
  if (remaining.length) {
    for (const other of await pdfDoc.copyPages(source, remaining)) pdfDoc.addPage(other);
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
