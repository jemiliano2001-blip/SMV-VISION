/**
 * PDF generation functions for SMV Vision reports.
 *
 * Pure extraction from App.tsx — no new logic. All implicit dependencies
 * from the React component are made explicit via parameters.
 */

import jsPDF from 'jspdf';
import autoTable, { type CellHookData, type RowInput } from 'jspdf-autotable';
import type { Order, AnalysisRunSummary } from '../types';
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

function jsPdfImageFormat(dataUrl: string): 'JPEG' | 'PNG' {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
}

export interface ReportPdfOptions {
  hotStampRefImage?: string | null;
  analysisSummary?: AnalysisRunSummary | null;
}

export function generateSingleOrderPdf(order: Order): void {
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

  if (order.prioridad === 'URGENTE') {
    doc.setFillColor(255, 78, 0);
    doc.rect(pageW - 110, 8, 70, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text('URGENTE', pageW - 75, 22, { align: 'center' });
  }

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
      console.warn('No se pudo incrustar la imagen isométrica', e);
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
    console.warn('No fue posible abrir el preview del PDF', e);
  }
}

export function generateReportPdf(orders: Order[], options?: ReportPdfOptions): void {
  // Cambiado a 'portrait' (vertical)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const generatedAt = new Date();
  const dateLabel = generatedAt.toLocaleDateString();
  const auditedTotal = options?.analysisSummary?.totalAudited ?? orders.filter((entry) => entry.haSidoAuditada).length;
  const totalOrders = options?.analysisSummary?.totalOrders ?? orders.length;
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
    `${summary.vencidas} vencidas  ·  ${summary.criticas} críticas (3 días o menos)  ·  ${summary.urgentes} urgentes  ·  ${piezasLabel} piezas en total`,
    40,
    headerY + 26,
  );
  doc.setFont('helvetica', 'normal');

  // Orden por urgencia: lo más vencido primero; sin fecha parseable al final.
  // Se conserva el bloque URGENTE arriba del bloque Normal (prioridad del
  // cliente). Las fechas multi-línea usan la primera línea (en computeDueDate).
  const sortByUrgency = (a: Order, b: Order): number => dueDaysOrInfinity(a) - dueDaysOrInfinity(b);
  const sortGroup = (group: Order[]): Order[] => [
    ...group.filter((o) => o.prioridad === 'URGENTE').sort(sortByUrgency),
    ...group.filter((o) => o.prioridad !== 'URGENTE').sort(sortByUrgency),
  ];
  const sortedWithBlueprint = sortGroup(withBlueprint);
  const sortedPendientes = sortGroup(pendientes);

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
  const displayName = (order: Order): string =>
    withPartNumber(cleanPieceName(order.pieza), order.numero_parte);

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

  // Draws a 4pt-wide black bar on the left edge of the DIBUJO cell for URGENTE
  // orders. B&W-friendly visual marker that survives photocopying.
  const drawUrgenteIndicator = (
    order: Order | undefined,
    hookData: CellHookData,
  ): void => {
    if (!order || order.prioridad !== 'URGENTE' || hookData.column.index !== 0) return;
    doc.setFillColor(0, 0, 0);
    doc.rect(hookData.cell.x, hookData.cell.y, 4, hookData.cell.height, 'F');
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
        drawUrgenteIndicator(order, hookData);
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
          console.error('PDF image embedding error', error);
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
        // Barra URGENTE en la primera columna (ahora NOMBRE) en vez de DIBUJO.
        if (order.prioridad === 'URGENTE' && hookData.column.index === 0) {
          doc.setFillColor(0, 0, 0);
          doc.rect(hookData.cell.x, hookData.cell.y, 4, hookData.cell.height, 'F');
        }
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
    console.warn('No fue posible abrir el preview del PDF', e);
  }
}
