/**
 * Agrega una franja de OT fuera del dibujo y cubre únicamente la región
 * seleccionada por el operador en la copia de impresión. No modifica la fuente.
 */

// pdf-lib (~523 KB / 208 KB gzip) solo se necesita al sellar/imprimir un plano
// OT — se importa dinámicamente dentro de las funciones para no ir en el bundle inicial.

export type PlanoOtHeaderStyle = 'slim' | 'classic';
export type PlanoOtPrintMode = 'blueprint' | 'board_ticket' | 'both';

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

/**
 * Dibuja la Ficha Viajera / Pizarrón con 2 tarjetas (Media Carta):
 * - Tarjeta 1: Pizarrón / Kanban de control de producción
 * - Tarjeta 2: Viajera de piso / Contenedor de piezas
 * Incluye miniatura vectorial del plano, datos en grande y checklist de procesos.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addFichaPizarronPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  embedded: any,
  cropWidth: number,
  cropHeight: number,
  rotation: number,
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

  const drawCard = (cardX: number, cardY: number, cardW: number, cardH: number, isBoard: boolean) => {
    // 1. Marco exterior
    ticketPage.drawRectangle({
      x: cardX,
      y: cardY,
      width: cardW,
      height: cardH,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.12, 0.16, 0.22),
      borderWidth: 2,
    });

    // 2. Banner superior
    const bannerH = 28;
    const bannerY = cardY + cardH - bannerH;
    ticketPage.drawRectangle({
      x: cardX,
      y: bannerY,
      width: cardW,
      height: bannerH,
      color: rgb(0.05, 0.17, 0.3), // #0D2B4D
    });

    ticketPage.drawText('SMV // CONTROL DE TALLER', {
      x: cardX + 10,
      y: bannerY + bannerH - 12,
      size: 9,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    ticketPage.drawText('HOJA DE RUTA Y SEGUIMIENTO EN PISO', {
      x: cardX + 10,
      y: bannerY + 4,
      size: 6.5,
      font: fontRegular,
      color: rgb(0.75, 0.85, 0.95),
    });

    // Badge derecho
    const badgeW = 75;
    const badgeH = bannerH - 8;
    const badgeX = cardX + cardW - badgeW - 8;
    const badgeY = bannerY + 4;
    ticketPage.drawRectangle({
      x: badgeX,
      y: badgeY,
      width: badgeW,
      height: badgeH,
      color: isBoard ? rgb(0.85, 0.4, 0.05) : rgb(0.1, 0.52, 0.35),
    });
    ticketPage.drawText(isBoard ? 'PIZARRÓN' : 'VIAJERA', {
      x: badgeX + (isBoard ? 15 : 18),
      y: badgeY + 4.5,
      size: 8,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    // 3. Bloque de métricas operativas (SO, CANTIDAD, PO/FECHA)
    const metricsH = 46;
    const metricsY = bannerY - metricsH;
    ticketPage.drawRectangle({
      x: cardX,
      y: metricsY,
      width: cardW,
      height: metricsH,
      color: rgb(0.96, 0.97, 0.98),
      borderColor: rgb(0.8, 0.85, 0.9),
      borderWidth: 1,
    });

    // Sección 1: SO
    const soVal = oneLine(stamp.soNumber) || '—';
    ticketPage.drawText('ORDEN (SO):', {
      x: cardX + 8,
      y: metricsY + metricsH - 12,
      size: 7,
      font: fontBold,
      color: rgb(0.4, 0.45, 0.5),
    });
    ticketPage.drawText(soVal, {
      x: cardX + 8,
      y: metricsY + 8,
      size: 14,
      font: fontBold,
      color: rgb(0.05, 0.17, 0.3),
    });

    // Sección 2: CANTIDAD
    const cantX = cardX + cardW * 0.42;
    ticketPage.drawLine({
      start: { x: cantX, y: metricsY },
      end: { x: cantX, y: metricsY + metricsH },
      color: rgb(0.8, 0.85, 0.9),
      thickness: 1,
    });
    ticketPage.drawText('CANTIDAD TOTAL:', {
      x: cantX + 8,
      y: metricsY + metricsH - 12,
      size: 7,
      font: fontBold,
      color: rgb(0.4, 0.45, 0.5),
    });
    ticketPage.drawText(`${oneLine(stamp.cantidad) || '1'} PZS`, {
      x: cantX + 8,
      y: metricsY + 8,
      size: 16,
      font: fontBold,
      color: rgb(0.85, 0.15, 0.15),
    });

    // Sección 3: PO y Fecha
    const poX = cardX + cardW * 0.7;
    ticketPage.drawLine({
      start: { x: poX, y: metricsY },
      end: { x: poX, y: metricsY + metricsH },
      color: rgb(0.8, 0.85, 0.9),
      thickness: 1,
    });
    const poVal = oneLine(stamp.poNumber) || 'S/N';
    ticketPage.drawText(`PO: ${poVal}`, {
      x: poX + 6,
      y: metricsY + metricsH - 13,
      size: 8,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    ticketPage.drawText(`F: ${oneLine(stamp.fecha) || '—'}`, {
      x: poX + 6,
      y: metricsY + 7,
      size: 7,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3),
    });

    // 4. Bloque central: Pieza & Miniatura
    const middleH = Math.min(130, Math.max(95, cardH * 0.28));
    const middleY = metricsY - middleH;

    // Miniatura a la derecha
    const thumbW = Math.min(125, cardW * 0.35);
    const thumbH = middleH - 10;
    const thumbX = cardX + cardW - thumbW - 8;
    const thumbY = middleY + 5;

    ticketPage.drawRectangle({
      x: thumbX,
      y: thumbY,
      width: thumbW,
      height: thumbH,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.75, 0.78, 0.82),
      borderWidth: 1,
    });
    ticketPage.drawText('PLANO / DIBUJO', {
      x: thumbX + 4,
      y: thumbY + thumbH - 8,
      size: 5.5,
      font: fontBold,
      color: rgb(0.5, 0.5, 0.5),
    });

    if (embedded) {
      const maxW = thumbW - 8;
      const maxH = thumbH - 12;
      const tScale = Math.min(maxW / cropWidth, maxH / cropHeight);
      const txOffset = thumbX + 4 + (maxW - cropWidth * tScale) / 2;
      const tyOffset = thumbY + 3 + (maxH - cropHeight * tScale) / 2;
      ticketPage.drawPage(embedded, {
        x: rotation === 180 || rotation === 270 ? txOffset + cropWidth * tScale : txOffset,
        y: rotation === 90 || rotation === 180 ? tyOffset + cropHeight * tScale : tyOffset,
        xScale: tScale,
        yScale: tScale,
        rotate: degrees(-rotation),
      });

      if (stamp.quantityMask) {
        ticketPage.drawRectangle({
          x: txOffset + stamp.quantityMask.x * cropWidth * tScale,
          y: tyOffset + (1 - stamp.quantityMask.y - stamp.quantityMask.height) * cropHeight * tScale,
          width: stamp.quantityMask.width * cropWidth * tScale,
          height: stamp.quantityMask.height * cropHeight * tScale,
          color: rgb(1, 1, 1),
        });
      }
    }

    // Datos de pieza a la izquierda de la miniatura
    const infoW = thumbX - cardX - 16;
    const partNum = sanitizeWinAnsi(stamp.partNumber || stamp.soNumber || '—');
    ticketPage.drawText('PIEZA / NÚMERO DE PARTE:', {
      x: cardX + 8,
      y: middleY + middleH - 12,
      size: 7,
      font: fontBold,
      color: rgb(0.4, 0.45, 0.5),
    });
    ticketPage.drawText(partNum, {
      x: cardX + 8,
      y: middleY + middleH - 26,
      size: 13,
      font: fontBold,
      color: rgb(0.05, 0.17, 0.3),
    });
    ticketPage.drawText(`CLIENTE: ${sanitizeWinAnsi(stamp.customer || 'SUPRAJIT')}`, {
      x: cardX + 8,
      y: middleY + middleH - 39,
      size: 7.5,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });

    let currentTextY = middleY + middleH - 51;
    if (stamp.piezaDescripcion) {
      const descRows = wrapStampText(sanitizeWinAnsi(stamp.piezaDescripcion), t => fontRegular.widthOfTextAtSize(t, 7), infoW);
      for (const row of descRows.slice(0, 2)) {
        ticketPage.drawText(row, {
          x: cardX + 8,
          y: currentTextY,
          size: 7,
          font: fontRegular,
          color: rgb(0.3, 0.35, 0.4),
        });
        currentTextY -= 9;
      }
    }

    if (stamp.notas) {
      const notaRows = wrapStampText(`NOTAS: ${sanitizeWinAnsi(stamp.notas)}`, t => fontBold.widthOfTextAtSize(t, 7), infoW);
      for (const row of notaRows.slice(0, 2)) {
        ticketPage.drawText(row, {
          x: cardX + 8,
          y: currentTextY,
          size: 7,
          font: fontBold,
          color: rgb(0.85, 0.15, 0.15),
        });
        currentTextY -= 9;
      }
    }

    // 5. Tabla de procesos del taller (Checklist)
    const tableHeaderH = 14;
    const tableHeaderY = middleY - 6;
    ticketPage.drawRectangle({
      x: cardX + 6,
      y: tableHeaderY - tableHeaderH,
      width: cardW - 12,
      height: tableHeaderH,
      color: rgb(0.9, 0.93, 0.96),
      borderColor: rgb(0.7, 0.75, 0.8),
      borderWidth: 0.75,
    });
    ticketPage.drawText('RUTA DE FABRICACIÓN Y LIBERACIÓN EN TALLER', {
      x: cardX + 10,
      y: tableHeaderY - tableHeaderH + 3.5,
      size: 6.5,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.3),
    });

    const colOperadorX = cardX + cardW * 0.52;
    const colFechaX = cardX + cardW * 0.74;
    const colStatusX = cardX + cardW * 0.89;

    ticketPage.drawText('OPERADOR', {
      x: colOperadorX + 4,
      y: tableHeaderY - tableHeaderH + 3.5,
      size: 6,
      font: fontBold,
      color: rgb(0.3, 0.35, 0.4),
    });
    ticketPage.drawText('FECHA / TURNO', {
      x: colFechaX + 4,
      y: tableHeaderY - tableHeaderH + 3.5,
      size: 6,
      font: fontBold,
      color: rgb(0.3, 0.35, 0.4),
    });
    ticketPage.drawText('LIB. [OK]', {
      x: colStatusX + 1,
      y: tableHeaderY - tableHeaderH + 3.5,
      size: 6,
      font: fontBold,
      color: rgb(0.3, 0.35, 0.4),
    });

    const stepRows = [
      '1. PREPARACIÓN Y CORTE MATERIAL',
      '2. TORNO (CONVENCIONAL / CNC)',
      '3. FRESA / CENTRO DE MAQUINADO',
      '4. RECTIFICADO (PLANO / CILÍNDRICO)',
      '5. TRATAMIENTO TÉRMICO / DUREZA',
      '6. INSPECCIÓN FINAL Y CALIDAD',
    ];

    const rowH = Math.min(17, Math.max(12, (tableHeaderY - tableHeaderH - cardY - 18) / stepRows.length));
    let stepY = tableHeaderY - tableHeaderH - rowH;

    for (const step of stepRows) {
      ticketPage.drawRectangle({
        x: cardX + 6,
        y: stepY,
        width: cardW - 12,
        height: rowH,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.85, 0.88, 0.9),
        borderWidth: 0.5,
      });

      ticketPage.drawText(`[  ] ${step}`, {
        x: cardX + 10,
        y: stepY + 3.5,
        size: 6,
        font: fontRegular,
        color: rgb(0.1, 0.15, 0.2),
      });

      // Líneas divisorias de columnas
      ticketPage.drawLine({
        start: { x: colOperadorX, y: stepY },
        end: { x: colOperadorX, y: stepY + rowH },
        color: rgb(0.85, 0.88, 0.9),
        thickness: 0.5,
      });
      ticketPage.drawLine({
        start: { x: colFechaX, y: stepY },
        end: { x: colFechaX, y: stepY + rowH },
        color: rgb(0.85, 0.88, 0.9),
        thickness: 0.5,
      });
      ticketPage.drawLine({
        start: { x: colStatusX, y: stepY },
        end: { x: colStatusX, y: stepY + rowH },
        color: rgb(0.85, 0.88, 0.9),
        thickness: 0.5,
      });

      stepY -= rowH;
    }

    // 6. Pie de tarjeta
    ticketPage.drawText(`SMV VISION // FOLIO: ${soVal} · LIBERACIÓN PISO`, {
      x: cardX + 8,
      y: cardY + 5,
      size: 6,
      font: fontRegular,
      color: rgb(0.45, 0.45, 0.45),
    });
    ticketPage.drawText('FIRMA DE RECIBIDO: _____________________', {
      x: cardX + cardW - 165,
      y: cardY + 5,
      size: 6,
      font: fontRegular,
      color: rgb(0.45, 0.45, 0.45),
    });
  };

  if (isLandscape) {
    // Tarjeta 1 (Izquierda) y Tarjeta 2 (Derecha)
    const cardW = (pageWidth / 2) - 18;
    const cardH = pageHeight - 24;
    drawCard(12, 12, cardW, cardH, true);
    drawCard(pageWidth / 2 + 6, 12, cardW, cardH, false);

    // Línea de corte vertical al centro
    ticketPage.drawLine({
      start: { x: pageWidth / 2, y: 8 },
      end: { x: pageWidth / 2, y: pageHeight - 8 },
      dashArray: [5, 4],
      thickness: 1,
      color: rgb(0.5, 0.5, 0.5),
    });
    ticketPage.drawText('- - CORTE (MEDIA CARTA) - -', {
      x: (pageWidth / 2) - 48,
      y: pageHeight - 10,
      size: 6.5,
      font: fontRegular,
      color: rgb(0.5, 0.5, 0.5),
    });
  } else {
    // Tarjeta 1 (Arriba) y Tarjeta 2 (Abajo)
    const cardW = pageWidth - 24;
    const cardH = (pageHeight / 2) - 18;
    drawCard(12, pageHeight / 2 + 6, cardW, cardH, true);
    drawCard(12, 12, cardW, cardH, false);

    // Línea de corte horizontal al centro
    ticketPage.drawLine({
      start: { x: 8, y: pageHeight / 2 },
      end: { x: pageWidth - 8, y: pageHeight / 2 },
      dashArray: [5, 4],
      thickness: 1,
      color: rgb(0.5, 0.5, 0.5),
    });
    ticketPage.drawText('- - CORTE (MEDIA CARTA) - -', {
      x: (pageWidth / 2) - 48,
      y: (pageHeight / 2) + 2,
      size: 6.5,
      font: fontRegular,
      color: rgb(0.5, 0.5, 0.5),
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
    addFichaPizarronPage(
      pdfDoc,
      embedded,
      crop.width,
      crop.height,
      rotation,
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
      color: row.notes ? rgb(0.8, 0.1, 0.1) : rgb(0, 0, 0),
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

