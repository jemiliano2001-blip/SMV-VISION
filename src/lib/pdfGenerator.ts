/**
 * PDF generation functions for SMV Vision reports.
 *
 * Pure extraction from App.tsx — no new logic. All implicit dependencies
 * from the React component are made explicit via parameters.
 */

// jsPDF + jspdf-autotable (~373 KB / 122 KB gzip) solo se cargan al generar un
// PDF — bajo demanda dentro de cada función, en vez de en el bundle inicial.
import type { CellHookData, RowInput } from 'jspdf-autotable';
import type { Order } from '../types';
import { consolidateHotStamps } from './hotStamp';
import {
  collapseDuplicateOrders,
  summarizeOrders,
  computeDueDate,
  dueLabel,
  fmtISOToDisplay,
  dueSeverity,
  dueDaysOrInfinity,
  withPartNumber,
  cleanPieceName,
} from './reportFormat';
import { formatAgeDays, getOrderAgeDays } from './age';
import { formatCajetinLine } from './reportViewMeta';
import { log } from './log';

function jsPdfImageFormat(dataUrl: string): 'JPEG' | 'PNG' {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
}

export interface ReportPdfOptions {
  hotStampRefImage?: string | null;
}

export async function generateSingleOrderPdf(order: Order): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const generatedAt = new Date();
  const pageW = doc.internal.pageSize.getWidth();

  // ── Header bar ──────────────────────────────────────────────────────────
  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, pageW, 48, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text('SMV // VISION', 40, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(180, 180, 180);
  doc.text('ORDEN DE TRABAJO INDIVIDUAL // SUPRAJIT', 40, 34);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(generatedAt.toLocaleString(), pageW - 40, 27, { align: 'right' });

  // ── Piece name ──────────────────────────────────────────────────────────
  let y = 72;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(0, 0, 0);
  const pieceLines = doc.splitTextToSize(order.pieza.toUpperCase(), pageW - 80) as string[];
  doc.text(pieceLines, 40, y);
  y += pieceLines.length * 26 + 4;

  if (order.numero_parte) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`N° PARTE: ${order.numero_parte}`, 40, y);
    y += 16;
  }

  // ── Divider ─────────────────────────────────────────────────────────────
  y += 6;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(2);
  doc.line(40, y, pageW - 40, y);
  y += 16;

  // ── Isometric view + detail grid ────────────────────────────────────────
  const imgSize = 180;
  const detailX = 40 + imgSize + 24;
  const detailW = pageW - detailX - 40;

  if (order.isometricView) {
    try {
      doc.addImage(
        order.isometricView,
        jsPdfImageFormat(order.isometricView),
        40,
        y,
        imgSize,
        imgSize,
      );
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(1.5);
      doc.rect(40, y, imgSize, imgSize);
      if (order.isometricSource === 'ai-generated') {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(180, 0, 0);
        doc.text('IA · NO ACOTAR', 40, y + imgSize + 12);
      }
    } catch (e) {
      log.warn('No se pudo incrustar la imagen isométrica', e);
    }
  }

  const fields: [string, string][] = [
    ['CANTIDAD', order.cantidad.split(/[\r\n]+/)[0].trim()],
    ['SO / ORDEN', order.orden.replace(/\n/g, ' / ')],
    ['FECHA', order.fecha.replace(/\n/g, ' / ')],
    ['PLANO', order.sourcePdfName ?? '—'],
  ];

  const ageDays = getOrderAgeDays(order.fecha.split('\n')[0]);
  if (ageDays !== null) {
    fields.push(['ANTIGÜEDAD', formatAgeDays(ageDays)]);
  }
  const cajetin = formatCajetinLine(order);
  if (cajetin) {
    fields.push(['CAJETÍN', cajetin]);
  }

  let detailY = y + 8;
  for (const [label, value] of fields) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(label, detailX, detailY);
    detailY += 13;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(0, 0, 0);
    const valLines = doc.splitTextToSize(value, detailW) as string[];
    doc.text(valLines, detailX, detailY);
    detailY += valLines.length * 16 + 10;
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  const footerY = doc.internal.pageSize.getHeight() - 28;
  doc.setFillColor(0, 0, 0);
  doc.rect(0, footerY, pageW, 28, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('SMV VISION // Servicios y Maquinados Vázquez', 40, footerY + 17);
  doc.text(`Generado: ${generatedAt.toLocaleString()}`, pageW - 40, footerY + 17, { align: 'right' });

  const safeName = order.pieza.replace(/[^A-Z0-9_\-]/gi, '_').slice(0, 40);
  doc.save(`orden_${safeName}_${generatedAt.toISOString().split('T')[0]}.pdf`);
  try {
    window.open(doc.output('bloburl'), '_blank');
  } catch (e) {
    log.warn('No fue posible abrir el preview del PDF', e);
  }
}

export async function generateReportPdf(orders: Order[], options?: ReportPdfOptions): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  // Cambiado a 'portrait' (vertical)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const generatedAt = new Date();
  const dateLabel = generatedAt.toLocaleDateString();
  // Derivados siempre de `orders` (no de analysisSummary, fijado al final de
  // la corrida original): así el encabezado refleja excluir/restaurar órdenes
  // en modo edición en vez de imprimir los totales de antes de editar.
  const auditedTotal = orders.filter((entry) => entry.haSidoAuditada).length;
  const totalOrders = orders.length;
  const headerY = 40;

  // Consolida los punzones de estampado (hot stamps) en un solo renglón antes
  // de dividir en secciones. Es puramente de presentación del PDF — el panel
  // de control y Firestore siguen viendo una orden por punzón. Si se rasterizó
  // un ISO de referencia, el renglón sintético va a la tabla principal con imagen.
  const reportOrders = consolidateHotStamps(orders, options?.hotStampRefImage ?? undefined);
  const withBlueprint = reportOrders.filter((o) => !!o.isometricView);
  // Audited y pendientes son mutuamente exclusivos por `isometricView`. Las
  // pendientes pueden traer renglones visualmente idénticos (mismo nombre/SO/
  // fecha/cant) que el extractor duplica — se colapsan en "×N".
  const pendientes = collapseDuplicateOrders(reportOrders.filter((o) => !o.isometricView));

  const renglones = withBlueprint.length + pendientes.length;
  const summary = summarizeOrders([...withBlueprint, ...pendientes]);
  const piezasLabel = Number.isInteger(summary.totalPiezas)
    ? String(summary.totalPiezas)
    : summary.totalPiezas.toFixed(2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('REPORTE DE TRABAJO: SUPRAJIT', 40, headerY);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Fecha: ${dateLabel}   |   Órdenes: ${totalOrders}   |   Renglones: ${renglones}   |   Auditadas: ${auditedTotal}`,
    40,
    headerY + 12,
  );
  // Banda de resumen: lo accionable de un vistazo.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  // Nota: jsPDF (fuente estándar) solo soporta Latin-1 — los símbolos ≤ y ≈
  // salen como basura. Se usa texto ASCII. El · y × sí están en Latin-1.
  doc.text(
    `${summary.vencidas} vencidas  ·  ${summary.criticas} críticas (3 días o menos)  ·  ${piezasLabel} piezas en total`,
    40,
    headerY + 26,
  );
  doc.setFont('helvetica', 'normal');

  // Orden por urgencia: lo más vencido primero; sin fecha parseable al final.
  // Las fechas multi-línea usan la primera línea (en computeDueDate).
  const sortByUrgency = (a: Order, b: Order): number => dueDaysOrInfinity(a) - dueDaysOrInfinity(b);
  const sortedWithBlueprint = [...withBlueprint].sort(sortByUrgency);
  const sortedPendientes = [...pendientes].sort(sortByUrgency);

  const formatFechaCell = (raw: string): string => raw.split('\n').map((f) => {
    const days = getOrderAgeDays(f);
    return days !== null ? `${f}\n(${formatAgeDays(days)})` : f;
  }).join('\n');

  // Keep the unit suffix (Pieza/Set) so aggregated rows don't show a bare number.
  const formatCantidadCell = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

  // Celda ENTREGA: fecha límite (fecha de orden + 14d) y días restantes.
  const formatEntregaCell = (order: Order): string => {
    const due = computeDueDate(order);
    if (!due) return '—';
    const label = dueLabel(due);
    return label ? `${fmtISOToDisplay(due)}\n${label}` : fmtISOToDisplay(due);
  };

  // Nombre mostrado: sin prefijo "(WESCON)" y con el número de parte si no
  // está ya en la descripción (desambigua piezas con nombre genérico).
  // Cajetín (material/dureza/…) va en una segunda línea cuando Vision lo extrajo.
  const displayName = (order: Order): string => {
    const base = withPartNumber(cleanPieceName(order.pieza), order.numero_parte);
    const cajetin = formatCajetinLine(order);
    return cajetin ? `${base}\n${cajetin}` : base;
  };

  const buildRows = (orders: Order[]): RowInput[] => orders.map((order) => [
    '',
    displayName(order),
    formatCantidadCell(order.cantidad),
    order.orden,
    formatFechaCell(order.fecha),
    formatEntregaCell(order),
  ]);

  // Rows for the PENDIENTES table — DIBUJO column omitted entirely.
  const buildPendienteRows = (orders: Order[]): RowInput[] => orders.map((order) => [
    displayName(order),
    formatCantidadCell(order.cantidad),
    order.orden,
    formatFechaCell(order.fecha),
    formatEntregaCell(order),
  ]);

  const sharedColumnStyles = {
    0: { cellWidth: 80,  halign: 'center' as const },
    1: { cellWidth: 183, fontStyle: 'bold' as const, fontSize: 9 },
    2: { cellWidth: 38,  halign: 'center' as const, fontStyle: 'bold' as const, fontSize: 10 },
    3: { cellWidth: 62,  halign: 'center' as const, fontStyle: 'bold' as const },
    4: { cellWidth: 64,  halign: 'center' as const, fontSize: 7 },
    5: { cellWidth: 88,  halign: 'center' as const, fontSize: 7 },
  };
  const sharedStyles = {
    fontSize: 8,
    cellPadding: 4,
    overflow: 'linebreak' as const,
    valign: 'middle' as const,
    lineWidth: 1,
    lineColor: [0, 0, 0] as [number, number, number],
  };
  const sharedHeadStyles = {
    fillColor: [0, 0, 0] as [number, number, number],
    textColor: [255, 255, 255] as [number, number, number],
    fontStyle: 'bold' as const,
    fontSize: 9,
    halign: 'center' as const,
  };

  // Colorea la celda ENTREGA según la severidad de la fecha límite. El color
  // se pierde en fotocopias B/N, así que las vencidas además llevan una barra
  // negra (drawOverdueIndicator) que sí sobrevive.
  const applyDueStyle = (hookData: CellHookData, order: Order | undefined): void => {
    if (!order) return;
    const sev = dueSeverity(computeDueDate(order));
    if (sev === 'overdue') {
      hookData.cell.styles.textColor = [190, 0, 0];
      hookData.cell.styles.fontStyle = 'bold';
    } else if (sev === 'critical') {
      hookData.cell.styles.textColor = [200, 80, 0];
      hookData.cell.styles.fontStyle = 'bold';
    } else if (sev === 'warning') {
      hookData.cell.styles.fontStyle = 'bold';
    }
  };

  const drawOverdueIndicator = (order: Order | undefined, hookData: CellHookData): void => {
    if (!order || dueSeverity(computeDueDate(order)) !== 'overdue') return;
    doc.setFillColor(0, 0, 0);
    doc.rect(hookData.cell.x, hookData.cell.y, 4, hookData.cell.height, 'F');
  };

  // Render main table: orders with blueprints
  if (sortedWithBlueprint.length > 0) {
    autoTable(doc, {
      startY: headerY + 40,
      head: [['DIBUJO', 'NOMBRE DE LA PIEZA', 'CANT.', 'SO', 'FECHA', 'ENTREGA']],
      body: buildRows(sortedWithBlueprint),
      theme: 'grid',
      headStyles: sharedHeadStyles,
      styles: sharedStyles,
      columnStyles: sharedColumnStyles,
      rowPageBreak: 'avoid',
      didParseCell: (hookData: CellHookData) => {
        if (hookData.section !== 'body') return;
        const order = sortedWithBlueprint[hookData.row.index];
        if (hookData.column.index === 0 && order?.isometricView) {
          hookData.cell.styles.minCellHeight = 82;
        }
        if (hookData.column.index === 5) {
          applyDueStyle(hookData, order);
        }
      },
      didDrawCell: (hookData: CellHookData) => {
        if (hookData.section !== 'body') return;
        const order = sortedWithBlueprint[hookData.row.index];
        if (hookData.column.index === 5) drawOverdueIndicator(order, hookData);
        if (hookData.column.index !== 0 || !order?.isometricView) return;
        const imageSize = 72;
        const imageX = hookData.cell.x + (hookData.cell.width - imageSize) / 2;
        const imageY = hookData.cell.y + (hookData.cell.height - imageSize) / 2;
        try {
          doc.addImage(
            order.isometricView,
            jsPdfImageFormat(order.isometricView),
            imageX,
            imageY,
            imageSize,
            imageSize,
          );
        } catch (error) {
          log.error('PDF image embedding error', error);
        }
      },
    });
  }

  // Render PENDIENTES section: orders without a matched blueprint
  if (sortedPendientes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lastY = (doc as any).lastAutoTable?.finalY ?? headerY + 40;
    const sectionHeaderY = lastY + 28;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text('OTRAS ÓRDENES (fabricación / sin plano de catálogo)', 40, sectionHeaderY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(
      `${sortedPendientes.length} órden${sortedPendientes.length === 1 ? '' : 'es'} sin plano de catálogo.`,
      40,
      sectionHeaderY + 12,
    );

    // Pendientes never have a blueprint image — drop the DIBUJO column entirely
    // and let NOMBRE DE LA PIEZA reclaim the width.
    const pendientesColumnStyles = {
      0: { cellWidth: 263, fontStyle: 'bold' as const, fontSize: 9 },
      1: { cellWidth: 38,  halign: 'center' as const, fontStyle: 'bold' as const, fontSize: 10 },
      2: { cellWidth: 62,  halign: 'center' as const, fontStyle: 'bold' as const },
      3: { cellWidth: 64,  halign: 'center' as const, fontSize: 7 },
      4: { cellWidth: 88,  halign: 'center' as const, fontSize: 7 },
    };
    autoTable(doc, {
      startY: sectionHeaderY + 20,
      head: [['NOMBRE DE LA PIEZA', 'CANT.', 'SO', 'FECHA', 'ENTREGA']],
      body: buildPendienteRows(sortedPendientes),
      theme: 'grid',
      headStyles: sharedHeadStyles,
      styles: sharedStyles,
      columnStyles: pendientesColumnStyles,
      rowPageBreak: 'avoid',
      didParseCell: (hookData: CellHookData) => {
        if (hookData.section === 'body' && hookData.column.index === 4) {
          applyDueStyle(hookData, sortedPendientes[hookData.row.index]);
        }
      },
      didDrawCell: (hookData: CellHookData) => {
        if (hookData.section !== 'body') return;
        const order = sortedPendientes[hookData.row.index];
        if (!order) return;
        if (hookData.column.index === 4) drawOverdueIndicator(order, hookData);
      },
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(`SMV VISION // ${generatedAt.toLocaleString()}`, 40, 820);
    doc.text(`Página ${page} de ${pageCount}`, 555, 820, { align: 'right' });
  }

  doc.save(`reporte_smv_${generatedAt.toISOString().split('T')[0]}.pdf`);

  // Abrir en nueva pestaña como preview (opcional pero solicitado)
  try {
    const blobUrl = doc.output('bloburl');
    window.open(blobUrl, '_blank');
  } catch (e) {
    log.warn('No fue posible abrir el preview del PDF', e);
  }
}

export interface JobTravelerOptions {
  shopName?: string;
  customer?: string;
  filename?: string;
}

/**
 * Genera un PDF compilado de Hojas de Maquinado / Job Travelers (Setup Sheets) para piso de taller.
 * Cada página corresponde a una pieza/orden de maquinado con:
 * - Vista isométrica 3D o plano en tamaño grande
 * - Datos técnicos de cajetín (material, dureza, tolerancias, acabado)
 * - Checklist de calidad para el operador
 * - Firmas de liberación
 */
export async function generateJobTravelersPdf(
  orders: Order[],
  options?: JobTravelerOptions
): Promise<void> {
  if (!orders || orders.length === 0) return;

  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const generatedAt = new Date();
  const pageW = doc.internal.pageSize.getWidth(); // 595.28 pt
  const pageH = doc.internal.pageSize.getHeight(); // 841.89 pt
  const customer = options?.customer ?? 'SUPRAJIT';

  orders.forEach((order, index) => {
    if (index > 0) {
      doc.addPage();
    }

    // ── Header Bar brutalist / industrial ──
    doc.setFillColor(13, 43, 77); // #0D2B4D
    doc.rect(0, 0, pageW, 52, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text('SMV MAQUINADOS // HOJA DE RUTA & SETUP CNC', 36, 24);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(200, 215, 235);
    doc.text(`CLIENTE: ${customer}   |   TRAVELER DE PRODUCCIÓN PISO`, 36, 38);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(
      `HOJA ${index + 1} DE ${orders.length}   |   ${generatedAt.toLocaleDateString()}`,
      pageW - 36,
      30,
      { align: 'right' }
    );

    // ── Datos de la Pieza (Caja de Identificación) ──
    let y = 68;

    // Caja de título de pieza
    doc.setFillColor(245, 247, 250);
    doc.rect(36, y, pageW - 72, 48, 'F');
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1.5);
    doc.rect(36, y, pageW - 72, 48);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(0, 0, 0);
    const pieceName = (order.pieza || 'PIEZA SIN NOMBRE').toUpperCase();
    const pieceLines = doc.splitTextToSize(pieceName, pageW - 190) as string[];
    doc.text(pieceLines.slice(0, 2), 48, y + 20);

    // Cantidad requerida en grande
    doc.setFillColor(0, 0, 0);
    doc.rect(pageW - 136, y, 100, 48, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text('CANT. TOTAL', pageW - 86, y + 16, { align: 'center' });
    doc.setFontSize(18);
    const cantidadStr = String(order.cantidad || '1').split('\n')[0] || '1';
    doc.text(cantidadStr, pageW - 86, y + 38, { align: 'center' });

    y += 56;

    // ── Sub-tarjetas de Metadatos (SO, Parte, Entrega, Material) ──
    const colW = (pageW - 72) / 4;
    const ordenStr = String(order.orden || '—').split('\n')[0] || '—';
    const metaCards = [
      { label: 'ORDEN (SO / OT)', value: ordenStr },
      { label: 'N° DE PARTE', value: order.numero_parte || 'VER PLANO' },
      { label: 'P.O. / REQ', value: order.poNumber || 'S/N' },
      { label: 'REVISIÓN PLANO', value: order.matchedDrawingRevision ? `REV ${order.matchedDrawingRevision}` : 'ORIGINAL' },
    ];

    metaCards.forEach((card, i) => {
      const cardX = 36 + i * colW;
      doc.setFillColor(255, 255, 255);
      doc.rect(cardX, y, colW, 32, 'F');
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(1);
      doc.rect(cardX, y, colW, 32);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(card.label, cardX + 6, y + 11);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      doc.text(doc.splitTextToSize(card.value, colW - 12)[0] || '', cardX + 6, y + 24);
    });

    y += 40;

    // ── Imagen Isométrica 3D / Plano y Caja de Material ──
    const imgSize = 250;
    const imgX = 36;
    const detailX = imgX + imgSize + 16;
    const detailW = pageW - detailX - 36;

    if (order.isometricView) {
      try {
        doc.addImage(
          order.isometricView,
          jsPdfImageFormat(order.isometricView),
          imgX,
          y,
          imgSize,
          imgSize
        );
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(2);
        doc.rect(imgX, y, imgSize, imgSize);

        // Badge de fuente
        doc.setFillColor(0, 0, 0);
        doc.rect(imgX + 4, y + 4, 75, 14, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(255, 255, 255);
        doc.text(order.isometricSource === 'ai-generated' ? 'VISTA IA 3D' : 'VISTA ISOMÉTRICA', imgX + 8, y + 14);
      } catch (err) {
        log.warn('Error al incrustar imagen en traveler', err);
      }
    } else {
      // Placeholder si no tiene plano
      doc.setFillColor(245, 245, 245);
      doc.rect(imgX, y, imgSize, imgSize, 'F');
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(1);
      doc.rect(imgX, y, imgSize, imgSize);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(120, 120, 120);
      doc.text('SIN VISTA ISOMÉTRICA', imgX + imgSize / 2, y + imgSize / 2, { align: 'center' });
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('CONSULTAR CARPETA DE TALLER', imgX + imgSize / 2, y + imgSize / 2 + 16, { align: 'center' });
    }

    // ── Panel lateral derecho: Material y Datos de Cajetín ──
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1.5);
    doc.setFillColor(255, 255, 255);
    doc.rect(detailX, y, detailW, imgSize);

    // Encabezado del panel
    doc.setFillColor(235, 240, 245);
    doc.rect(detailX, y, detailW, 24, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text('ESPECIFICACIONES TÉCNICAS', detailX + 8, y + 16);

    let specY = y + 36;
    const specItems = [
      { k: 'Material:', v: order.material || 'ACERO 1018 / 4140 (CONFIRMAR)' },
      { k: 'Dureza / Trat:', v: order.dureza || order.tratamiento || 'NATURAL DE MAQUINADO' },
      { k: 'Acabado Superficial:', v: order.acabado || 'N6 / 63 Ra estándar' },
      { k: 'Tolerancia General:', v: '± 0.005" / ± 0.13 mm' },
      { k: 'Archivo CAD/PDF:', v: order.sourcePdfName || 'No adjunto' },
    ];

    specItems.forEach((item) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(90, 90, 90);
      doc.text(item.k, detailX + 8, specY);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      const valLines = doc.splitTextToSize(item.v, detailW - 16) as string[];
      doc.text(valLines[0] || '—', detailX + 8, specY + 11);
      specY += 24;
    });

    // Cuadro de notas del maquinista en el panel
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(1);
    doc.setFillColor(250, 250, 250);
    doc.rect(detailX + 8, specY + 4, detailW - 16, imgSize - (specY - y) - 12, 'F');
    doc.rect(detailX + 8, specY + 4, detailW - 16, imgSize - (specY - y) - 12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text('NOTAS / HERRAMIENTAS ASIGNADAS:', detailX + 12, specY + 16);

    y += imgSize + 16;

    // ── Checklist de Calidad y Liberación de Maquinado ──
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1.5);
    doc.rect(36, y, pageW - 72, 130);

    doc.setFillColor(0, 0, 0);
    doc.rect(36, y, pageW - 72, 20, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text('CONTROL DE CALIDAD EN PISO & LIBERACIÓN DE MAQUINADO', 44, y + 14);

    const checklistItems = [
      '1. Material en bruto, dimensiones iniciales y aleación verificados contra plano.',
      '2. Montaje y fijación en mordazas / prensa rígida, cero de pieza (G54) comprobado.',
      '3. Herramental CNC calibrado (correctores de altura y radio de inserto).',
      '4. Inspección de primera pieza (First Article Inspection) con vernier / micrómetro.',
      '5. Rebabado, chaflanes, limpieza y conteo de piezas terminadas al 100%.',
    ];

    let checkY = y + 36;
    checklistItems.forEach((text) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(1.5);
      doc.rect(48, checkY - 8, 10, 10);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text(text, 66, checkY);
      checkY += 18;
    });

    y += 142;

    // ── Firmas de Operador e Inspector ──
    const signBoxW = (pageW - 72 - 24) / 3;
    const signBoxes = ['OPERADOR MAQUINISTA', 'INSPECCIÓN CALIDAD', 'FECHA DE LIBERACIÓN'];
    signBoxes.forEach((label, i) => {
      const boxX = 36 + i * (signBoxW + 12);
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(1);
      doc.line(boxX, y + 24, boxX + signBoxW, y + 24);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(label, boxX + signBoxW / 2, y + 34, { align: 'center' });
    });

    // Footer de página
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    doc.text(
      `DOCUMENTO INTERNO DE PRODUCCIÓN — SMV VISION // GENERADO: ${generatedAt.toLocaleString()}`,
      36,
      pageH - 20
    );
    doc.text(`PÁG. ${index + 1} / ${orders.length}`, pageW - 36, pageH - 20, { align: 'right' });
  });

  const cleanPieza = (orders[0]?.pieza || 'pieza')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .toLowerCase();

  const filename =
    options?.filename ??
    (orders.length === 1
      ? `traveler_${cleanPieza}.pdf`
      : `travelers_maquinado_${generatedAt.toISOString().split('T')[0]}.pdf`);

  doc.save(filename);

  try {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      const blobUrl = doc.output('bloburl');
      window.open(blobUrl, '_blank');
    }
  } catch (e) {
    log.warn('No fue posible abrir el preview del Traveler PDF', e);
  }
}
