/**
 * Agrega una franja de OT fuera del dibujo y cubre únicamente la región
 * seleccionada por el operador en la copia de impresión. No modifica la fuente.
 */

// pdf-lib (~523 KB / 208 KB gzip) solo se necesita al sellar/imprimir un plano
// OT — se importa dinámicamente dentro de las funciones para no ir en el bundle inicial.

import { log } from './log';

export type PlanoOtHeaderStyle = 'slim' | 'classic';
export type PlanoOtPrintMode = 'blueprint' | 'board_ticket' | 'both';
export type FichaPhotoKind = 'iso' | 'stl' | 'ai' | 'none';

/** Foto ya resuelta para la ficha. El sello no descarga ni llama a Gemini. */
export interface PlanoOtFichaPhoto {
  kind: FichaPhotoKind;
  pdfDataUrl?: string;
  imageDataUrl?: string;
}

export interface PlanoOtStamp {
  soNumber: string;
  cantidad: string;
  fecha: string;
  /** PO del cliente; se omite del sello si viene vacía. */
  poNumber?: string;
  notas?: string;
  quantityMask?: PlanoOtMask | null;
  /** Metadatos para ficha de pizarrón / viajera */
  partNumber?: string;
  customer?: string;
  piezaDescripcion?: string;
  /** Estilo de encabezado en plano: 'slim' (ultra-compacto, defecto) o 'classic' (grande) */
  headerStyle?: PlanoOtHeaderStyle;
  /** Modo de impresión: 'blueprint' (defecto), 'board_ticket', o 'both' */
  mode?: PlanoOtPrintMode;
  /** Isométrica, STL o dibujo de IA. Ausente = recuadro "Sin isométrica". */
  fichaPhoto?: PlanoOtFichaPhoto;
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

/** Sanitiza nombres de archivo para descargas seguras en cualquier sistema operativo. */
export function cleanFilename(name?: string | null, fallback = 'orden'): string {
  const cleaned = (name ?? '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '-')
    .trim();
  return cleaned || fallback;
}

/**
 * Sanitiza textos para fuentes estándar de PDF (Helvetica / WinAnsiEncoding).
 * Reemplaza comillas curvas, dashes largos, bullets y emojis por caracteres ASCII seguros.
 */
export function sanitizeWinAnsi(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '*')
    .replace(/[✓✔]/g, '[OK]')
    .replace(/[✂✄]/g, '-')
    .replace(/[^\x00-\xFF]/gu, '?');
}

/** Una sola línea legible y segura para WinAnsi (SO/fecha pueden venir multi-línea). */
function oneLine(value?: string | null): string {
  return sanitizeWinAnsi((value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Renglón secundario del sello: fecha y, si la hay, la PO del cliente. */
export function stampDetailLine(stamp: Pick<PlanoOtStamp, 'fecha' | 'poNumber'>): string {
  const po = oneLine(stamp.poNumber ?? '');
  const fecha = `FECHA: ${oneLine(stamp.fecha) || '—'}`;
  return po ? `${fecha}     PO: ${po}` : fecha;
}

interface FichaDrawAsset {
  kind: FichaPhotoKind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image: any;
  srcWidth: number;
  srcHeight: number;
  rotation: number;
}

async function loadFichaPhoto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any,
  photo: PlanoOtFichaPhoto | undefined,
): Promise<FichaDrawAsset> {
  const empty: FichaDrawAsset = {
    kind: 'none', page: null, image: null, srcWidth: 1, srcHeight: 1, rotation: 0,
  };
  if (!photo || photo.kind === 'none') return empty;

  if (photo.pdfDataUrl) {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const source = await PDFDocument.load(dataUrlToUint8Array(photo.pdfDataUrl));
      const original = source.getPage(0);
      const crop = original.getCropBox();
      const rotation = ((original.getRotation().angle % 360) + 360) % 360;
      const sideways = rotation === 90 || rotation === 270;
      const page = original.node.Contents()
        ? await pdfDoc.embedPage(original, {
          left: crop.x,
          bottom: crop.y,
          right: crop.x + crop.width,
          top: crop.y + crop.height,
        })
        : null;
      if (page) {
        return {
          kind: photo.kind,
          page,
          image: null,
          srcWidth: sideways ? crop.height : crop.width,
          srcHeight: sideways ? crop.width : crop.height,
          rotation,
        };
      }
    } catch (error) {
      log.warn('[ficha-ot] no se pudo incrustar el PDF de la foto', error);
    }
  }

  if (photo.imageDataUrl) {
    try {
      const bytes = dataUrlToUint8Array(photo.imageDataUrl);
      const mime = photo.imageDataUrl.slice(0, photo.imageDataUrl.indexOf(',')).toLowerCase();
      const image = mime.includes('image/jp')
        ? await pdfDoc.embedJpg(bytes)
        : await pdfDoc.embedPng(bytes);
      return {
        kind: photo.kind,
        page: null,
        image,
        srcWidth: image.width,
        srcHeight: image.height,
        rotation: 0,
      };
    } catch (error) {
      log.warn('[ficha-ot] no se pudo incrustar la imagen de la foto', error);
    }
  }

  return empty;
}

/**
 * Dibuja la ficha de pizarrón y viajera (media carta x2) en blanco y negro.
 * La foto ocupa el espacio que antes usaba la ruta de fabricación.
 */
function addFichaPizarronPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any,
  asset: FichaDrawAsset,
  stamp: PlanoOtStamp,
  pageWidth: number,
  pageHeight: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fontBold: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fontRegular: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rgb: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  degrees: any,
): void {
  const ticketPage = pdfDoc.addPage([pageWidth, pageHeight]);
  const isLandscape = pageWidth >= pageHeight;
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);

  const drawCard = (cardX: number, cardY: number, cardW: number, cardH: number, isBoard: boolean) => {
    ticketPage.drawRectangle({
      x: cardX, y: cardY, width: cardW, height: cardH,
      color: white, borderColor: black, borderWidth: 1.5,
    });

    const bannerH = 26;
    const bannerY = cardY + cardH - bannerH;
    ticketPage.drawRectangle({
      x: cardX, y: bannerY, width: cardW, height: bannerH, color: black,
    });
    ticketPage.drawText('SMV', {
      x: cardX + 10, y: bannerY + 8, size: 11, font: fontBold, color: white,
    });
    const badge = isBoard ? 'PIZARRÓN' : 'VIAJERA';
    ticketPage.drawText(badge, {
      x: cardX + cardW - fontBold.widthOfTextAtSize(badge, 9) - 10,
      y: bannerY + 8,
      size: 9,
      font: fontBold,
      color: white,
    });

    const metricsH = 40;
    const metricsY = bannerY - metricsH;
    ticketPage.drawRectangle({
      x: cardX, y: metricsY, width: cardW, height: metricsH,
      color: white, borderColor: black, borderWidth: 0.8,
    });
    const soVal = oneLine(stamp.soNumber) || '—';
    ticketPage.drawText('ORDEN (SO)', {
      x: cardX + 8, y: metricsY + metricsH - 12, size: 7, font: fontBold, color: black,
    });
    ticketPage.drawText(soVal, {
      x: cardX + 8, y: metricsY + 8, size: 13, font: fontBold, color: black,
    });

    const cantX = cardX + cardW * 0.42;
    ticketPage.drawLine({
      start: { x: cantX, y: metricsY }, end: { x: cantX, y: metricsY + metricsH },
      color: black, thickness: 0.8,
    });
    ticketPage.drawText('CANTIDAD', {
      x: cantX + 8, y: metricsY + metricsH - 12, size: 7, font: fontBold, color: black,
    });
    ticketPage.drawText(`${oneLine(stamp.cantidad) || '1'} PZS`, {
      x: cantX + 8, y: metricsY + 8, size: 14, font: fontBold, color: black,
    });

    const poX = cardX + cardW * 0.7;
    ticketPage.drawLine({
      start: { x: poX, y: metricsY }, end: { x: poX, y: metricsY + metricsH },
      color: black, thickness: 0.8,
    });
    ticketPage.drawText(`PO: ${oneLine(stamp.poNumber) || 'S/N'}`, {
      x: poX + 6, y: metricsY + metricsH - 14, size: 8, font: fontBold, color: black,
    });
    ticketPage.drawText(`F: ${oneLine(stamp.fecha) || '—'}`, {
      x: poX + 6, y: metricsY + 8, size: 7, font: fontRegular, color: black,
    });

    const footerH = 16;
    const infoH = 48;
    const photoX = cardX + 8;
    const photoW = cardW - 16;
    const photoY = cardY + footerH + 4;
    const photoH = Math.max(40, metricsY - infoH - photoY);
    const infoY = photoY + photoH;

    ticketPage.drawText('PIEZA', {
      x: cardX + 8, y: infoY + infoH - 11, size: 7, font: fontBold, color: black,
    });
    const partNum = sanitizeWinAnsi(stamp.partNumber || stamp.soNumber || '—');
    ticketPage.drawText(partNum, {
      x: cardX + 40, y: infoY + infoH - 12, size: 10, font: fontBold, color: black,
    });
    ticketPage.drawText(`CLIENTE: ${sanitizeWinAnsi(stamp.customer || 'SUPRAJIT')}`, {
      x: cardX + 8, y: infoY + infoH - 24, size: 7, font: fontRegular, color: black,
    });
    const detail = sanitizeWinAnsi(stamp.piezaDescripcion || stamp.notas || '');
    if (detail) {
      const row = wrapStampText(detail, (text) => fontRegular.widthOfTextAtSize(text, 7), cardW - 20)[0] ?? '';
      if (row) {
        ticketPage.drawText(row, {
          x: cardX + 8, y: infoY + 6, size: 7, font: fontRegular, color: black,
        });
      }
    }

    ticketPage.drawRectangle({
      x: photoX, y: photoY, width: photoW, height: photoH,
      color: white, borderColor: black, borderWidth: 1,
    });

    const pad = 8;
    const caption = asset.kind === 'ai' && (asset.page || asset.image)
      ? 'Isométrica generada'
      : '';
    const missing = !asset.page && !asset.image;
    const maxW = photoW - pad * 2;
    const maxH = photoH - pad * 2 - (caption ? 12 : 0);
    if (asset.page && asset.srcWidth > 0 && asset.srcHeight > 0 && maxW > 0 && maxH > 0) {
      const tScale = Math.min(maxW / asset.srcWidth, maxH / asset.srcHeight);
      const txOffset = photoX + pad + (maxW - asset.srcWidth * tScale) / 2;
      const tyOffset = photoY + pad + (maxH - asset.srcHeight * tScale) / 2;
      const rotation = asset.rotation;
      ticketPage.drawPage(asset.page, {
        x: rotation === 180 || rotation === 270 ? txOffset + asset.srcWidth * tScale : txOffset,
        y: rotation === 90 || rotation === 180 ? tyOffset + asset.srcHeight * tScale : tyOffset,
        xScale: tScale,
        yScale: tScale,
        rotate: degrees(-rotation),
      });
    } else if (asset.image && asset.srcWidth > 0 && asset.srcHeight > 0 && maxW > 0 && maxH > 0) {
      const tScale = Math.min(maxW / asset.srcWidth, maxH / asset.srcHeight);
      const dw = asset.srcWidth * tScale;
      const dh = asset.srcHeight * tScale;
      ticketPage.drawImage(asset.image, {
        x: photoX + pad + (maxW - dw) / 2,
        y: photoY + pad + (caption ? 12 : 0) + (maxH - dh) / 2,
        width: dw,
        height: dh,
      });
    }

    const label = missing ? 'Sin isométrica' : caption;
    if (label) {
      ticketPage.drawText(label, {
        x: photoX + 8,
        y: photoY + 6,
        size: 8,
        font: fontBold,
        color: black,
      });
    }

    ticketPage.drawText(`SMV VISION // FOLIO: ${soVal}`, {
      x: cardX + 8, y: cardY + 5, size: 6, font: fontRegular, color: black,
    });
    ticketPage.drawText('FIRMA DE RECIBIDO: _____________________', {
      x: cardX + cardW - 168, y: cardY + 5, size: 6, font: fontRegular, color: black,
    });
  };

  if (isLandscape) {
    const cardW = (pageWidth / 2) - 18;
    const cardH = pageHeight - 24;
    drawCard(12, 12, cardW, cardH, true);
    drawCard(pageWidth / 2 + 6, 12, cardW, cardH, false);
    ticketPage.drawLine({
      start: { x: pageWidth / 2, y: 8 },
      end: { x: pageWidth / 2, y: pageHeight - 8 },
      dashArray: [5, 4],
      thickness: 1,
      color: rgb(0.35, 0.35, 0.35),
    });
  } else {
    const cardW = pageWidth - 24;
    const cardH = (pageHeight / 2) - 18;
    drawCard(12, pageHeight / 2 + 6, cardW, cardH, true);
    drawCard(12, 12, cardW, cardH, false);
    ticketPage.drawLine({
      start: { x: 8, y: pageHeight / 2 },
      end: { x: pageWidth - 8, y: pageHeight / 2 },
      dashArray: [5, 4],
      thickness: 1,
      color: rgb(0.35, 0.35, 0.35),
    });
  }
}
/**
 * Toma el dataURL de un PDF y devuelve los bytes del PDF sellado.
 * Admite:
 * - Modo 'blueprint' (por defecto): Plano de taller sellado.
 * - Modo 'board_ticket': Ficha viajera para el pizarrón (media carta x2).
 * - Modo 'both': Ficha de pizarrón en pág 1 + Plano de taller en pág 2.
 * - Estilo 'slim' (por defecto): Encabezado ultra-compacto (escala ~93%).
 * - Estilo 'classic': Encabezado clásico grande.
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
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const printMode: PlanoOtPrintMode = stamp.mode || 'blueprint';
  const isSlim = stamp.headerStyle !== 'classic';

  // Si se solicitó la ficha de pizarrón (o ambas), se inserta primero la página de Ficha Viajera
  if (printMode === 'board_ticket' || printMode === 'both') {
    const photoAsset = await loadFichaPhoto(pdfDoc, stamp.fichaPhoto);
    addFichaPizarronPage(
      pdfDoc,
      photoAsset,
      stamp,
      width,
      height,
      fontBold,
      fontRegular,
      rgb,
      degrees,
    );
  }

  // Si solo era la ficha de pizarrón, guardamos y salimos aquí
  if (printMode === 'board_ticket') {
    return pdfDoc.save();
  }

  // Dimensiones del encabezado en el plano de taller
  const margin = isSlim ? Math.max(6, Math.min(10, width * 0.012)) : width * 0.02;
  const padding = isSlim ? Math.max(4, Math.min(7, width * 0.008)) : width * 0.016;
  const usableWidth = width - (margin + padding) * 2;
  const largeSize = isSlim ? Math.max(10.5, Math.min(14, width * 0.018)) : width * 0.044;
  const detailSize = isSlim ? Math.max(8, Math.min(10.5, width * 0.013)) : width * 0.03;

  const soText = `SO: ${oneLine(stamp.soNumber) || '—'}`;
  const cantText = `CANT: ${oneLine(stamp.cantidad) || '—'}`;
  const rows: { text: string; size: number; notes: boolean }[] = [];

  if (isSlim) {
    // Encabezado ultra-compacto: consolida datos en una sola línea si caben
    const detailLine = stampDetailLine(stamp);
    const primary = `${soText}     ${cantText}     ${detailLine}`;
    rows.push(...wrapStampText(primary, t => fontBold.widthOfTextAtSize(t, largeSize), usableWidth)
      .map(text => ({ text, size: largeSize, notes: false })));

    if (oneLine(stamp.notas)) {
      rows.push(...wrapStampText(`NOTAS: ${oneLine(stamp.notas)}`, t => fontBold.widthOfTextAtSize(t, detailSize), usableWidth)
        .map(text => ({ text, size: detailSize, notes: true })));
    }
  } else {
    // Encabezado clásico grande
    const primary = `${soText}     ${cantText}`;
    rows.push(...wrapStampText(primary, t => fontBold.widthOfTextAtSize(t, largeSize), usableWidth)
      .map(text => ({ text, size: largeSize, notes: false })));

    for (const [text, notes] of [
      [stampDetailLine(stamp), false],
      ...(oneLine(stamp.notas) ? [[`NOTAS: ${oneLine(stamp.notas)}`, true]] : []),
    ] as [string, boolean][]) {
      rows.push(...wrapStampText(text, t => fontBold.widthOfTextAtSize(t, detailSize), usableWidth)
        .map(text => ({ text, size: detailSize, notes })));
    }
  }

  const boxH = padding * 2 + rows.reduce((sum, row) => sum + row.size * (isSlim ? 1.25 : 1.3), 0);
  const headerHeight = boxH + margin * 2;
  const scale = (height - headerHeight) / height;
  const minScale = isSlim ? 0.85 : 0.5;
  if (scale < minScale || (isSlim && oneLine(stamp.notas).length > 300)) {
    throw new Error('Las notas son muy largas para caber sin reducir demasiado el plano. Acórtalas.');
  }

  const availableHeight = height * scale;
  const xOffset = (width - width * scale) / 2;
  const page = pdfDoc.addPage([width, height]);

  if (embedded) {
    page.drawPage(embedded, {
      x: rotation === 180 || rotation === 270 ? xOffset + width * scale : xOffset,
      y: rotation === 90 || rotation === 180 ? availableHeight : 0,
      xScale: scale,
      yScale: scale,
      rotate: degrees(-rotation),
    });
  }

  const mask = stamp.quantityMask;
  if (mask) {
    page.drawRectangle({
      x: xOffset + mask.x * width * scale,
      y: (1 - mask.y - mask.height) * height * scale,
      width: mask.width * width * scale,
      height: mask.height * height * scale,
      color: rgb(1, 1, 1),
    });
  }

  page.drawRectangle({
    x: margin,
    y: availableHeight + margin,
    width: width - margin * 2,
    height: boxH,
    color: rgb(1, 1, 1),
    borderColor: rgb(0, 0, 0),
    borderWidth: isSlim ? 1.5 : 2,
  });

  let y = height - margin - padding;
  for (const row of rows) {
    y -= row.size;
    page.drawText(row.text, {
      x: margin + padding,
      y,
      size: row.size,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    y -= row.size * (isSlim ? 0.25 : 0.3);
  }

  // Las páginas restantes se conservan
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
    a.download = `plano-ot-${cleanFilename(stamp.soNumber)}.pdf`;
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

export interface PlanoOtSetItem {
  pdfDataUrl: string;
  partNumber: string;
  revision?: string;
  description?: string;
  customer?: string;
  /** Piezas de este plano por cada juego pedido (1 por defecto). */
  cantidadPorJuego?: number;
  isCompanion?: boolean;
  companionLabel?: string;
}

/**
 * Genera un PDF sellado para un juego de planos (plano base + hojas secundarias o complementos).
 * Si hay ficha de pizarrón activa, se genera una sola ficha en la página 1 con la relación del juego completo,
 * seguida de las páginas del plano base y luego los planos complementarios sellados individualmente.
 */
export async function createStampedPlanoOtSet(
  items: PlanoOtSetItem[],
  baseStamp: PlanoOtStamp,
): Promise<Uint8Array> {
  if (items.length === 0) {
    throw new Error('No hay planos para sellar.');
  }

  if (items.length === 1) {
    return stampPlanoOt(items[0].pdfDataUrl, baseStamp);
  }

  const { PDFDocument } = await import('pdf-lib');
  const mergedDoc = await PDFDocument.create();

  // El primer plano es el base
  const baseItem = items[0];
  const totalCount = items.length;
  const companionNames = items.slice(1).map((i) => i.companionLabel || i.partNumber).join(', ');
  const setNotice = ` [JUEGO ${totalCount} PLANOS: Incluye ${companionNames}]`;

  const primaryStamp: PlanoOtStamp = {
    ...baseStamp,
    partNumber: baseItem.partNumber || baseStamp.partNumber,
    piezaDescripcion: (baseStamp.piezaDescripcion || baseItem.description || '') + (totalCount > 1 ? ` · Juego de ${totalCount} planos` : ''),
    notas: (baseStamp.notas ? `${baseStamp.notas} ` : '') + (baseStamp.notas?.length ? setNotice : setNotice.trim()),
  };

  const primaryBytes = await stampPlanoOt(baseItem.pdfDataUrl, primaryStamp);
  const primaryDoc = await PDFDocument.load(primaryBytes);
  const primaryPages = await mergedDoc.copyPages(primaryDoc, primaryDoc.getPageIndices());
  for (const page of primaryPages) {
    mergedDoc.addPage(page);
  }

  // Los planos secundarios se sellan en modo 'blueprint' (solo plano técnico con encabezado Slim)
  for (let idx = 1; idx < items.length; idx++) {
    const item = items[idx];
    const compLabel = item.companionLabel || `Hoja ${idx + 1}`;
    const secondaryStamp: PlanoOtStamp = {
      ...baseStamp,
      partNumber: item.partNumber,
      piezaDescripcion: item.description || baseStamp.piezaDescripcion,
      notas: `[COMPONENTE: ${compLabel.toUpperCase()}] Plano ${idx + 1} de ${totalCount}`,
      mode: 'blueprint',
      headerStyle: baseStamp.headerStyle || 'slim',
      quantityMask: null,
    };

    const secBytes = await stampPlanoOt(item.pdfDataUrl, secondaryStamp);
    const secDoc = await PDFDocument.load(secBytes);
    const secPages = await mergedDoc.copyPages(secDoc, secDoc.getPageIndices());
    for (const page of secPages) {
      mergedDoc.addPage(page);
    }
  }

  return mergedDoc.save();
}

/**
 * Abre el juego completo de planos sellados en una pestaña para imprimir.
 */
export async function openStampedPlanoOtSet(
  items: PlanoOtSetItem[],
  baseStamp: PlanoOtStamp,
): Promise<void> {
  const bytes = await createStampedPlanoOtSet(items, baseStamp);
  const buffer = bytes.slice().buffer;
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `plano-ot-${cleanFilename(baseStamp.soNumber)}-juego-${items.length}-planos.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

