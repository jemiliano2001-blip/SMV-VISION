/**
 * src/lib/deliverySlipGenerator.ts
 *
 * Generadores de PDF para remisiones (preview) y reportes de órdenes de Odoo.
 * Extraído de OdooOrdersPanel para mantener separación limpia de responsabilidades (SRP).
 */

import type { OdooOrderView, ProductionStatus } from './firebase/odooOrders';

/**
 * Genera y descarga el PDF de vista previa de remisión para una orden de Odoo.
 */
export async function exportDeliverySlip(order: OdooOrderView): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const generatedAt = new Date();

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(0, 0, 0);
  doc.text('REMISIÓN (PREVIEW)', 40, 50);

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('MAQUINADOS VÁZQUEZ', 40, 70);
  doc.text('SMV // VISION ERP', 40, 85);

  // Right side header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(`Orden: ${order.name}`, pageW - 40, 50, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Fecha: ${generatedAt.toLocaleString()}`, pageW - 40, 70, { align: 'right' });

  // Customer & Requisitor info
  doc.setFillColor(240, 240, 240);
  doc.rect(40, 110, pageW - 80, 60, 'F');

  doc.setFont('helvetica', 'bold');
  doc.text('CLIENTE:', 50, 130);
  doc.setFont('helvetica', 'normal');
  doc.text(order.partner, 110, 130);

  doc.setFont('helvetica', 'bold');
  doc.text('PO / REF:', 50, 150);
  doc.setFont('helvetica', 'normal');
  doc.text(order.client_order_ref || 'N/A', 110, 150);

  doc.setFont('helvetica', 'bold');
  doc.text('REQUISITOR:', pageW / 2 + 10, 130);
  doc.setFont('helvetica', 'normal');
  doc.text(order.requisitor || 'Sin asignar', pageW / 2 + 90, 130);

  // Table
  const y = 200;
  const linesToDeliver = order.order_lines.filter((l) => l.qty_pending > 0);

  autoTable(doc, {
    startY: y,
    margin: { left: 40, right: 40 },
    theme: 'grid',
    headStyles: {
      fillColor: [13, 43, 77],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    head: [['Código / Producto', 'Descripción', 'Cant. Entregar']],
    body: linesToDeliver.map((l) => [
      l.product.split('] ')[1] || l.product,
      l.description || '—',
      String(l.qty_pending),
    ]),
    columnStyles: {
      0: { cellWidth: 150 },
      2: { halign: 'center', cellWidth: 80 },
    },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 40;

  // Signature lines
  doc.setLineWidth(1);
  doc.line(80, finalY, 220, finalY);
  doc.line(pageW - 220, finalY, pageW - 80, finalY);

  doc.setFontSize(9);
  doc.text('Entregado por (Firma)', 150, finalY + 15, { align: 'center' });
  doc.text('Recibido por (Firma / Sello)', pageW - 150, finalY + 15, { align: 'center' });

  doc.save(`Remision_${order.name}_Preview.pdf`);
}

/**
 * Genera y descarga el reporte PDF consolidado de órdenes Odoo pendientes de facturación.
 */
export async function exportOdooOrdersReportPdf(
  orders: OdooOrderView[],
  productionMap: Map<string, ProductionStatus>,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const generatedAt = new Date();

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, pageW, 48, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('SMV // VISION', 40, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(180, 180, 180);
  doc.text('REPORTE DE ÓRDENES ODOO — PENDIENTES DE FACTURACIÓN', 40, 34);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(generatedAt.toLocaleString(), pageW - 40, 27, { align: 'right' });
  doc.setFontSize(7);
  doc.setTextColor(180, 180, 180);
  doc.text(`${orders.length} órdenes`, pageW - 40, 39, { align: 'right' });

  let y = 64;

  for (const order of orders) {
    const prod = productionMap.get(order.name);
    const statusLabel =
      !prod || prod.total === 0
        ? 'SIN OTs'
        : prod.entregadas >= prod.total
        ? 'LISTO'
        : `${prod.entregadas}/${prod.total} OTs`;

    // Check page space
    if (y > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage();
      y = 40;
    }

    // Order header row
    doc.setFillColor(13, 43, 77);
    doc.rect(40, y, pageW - 80, 20, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(order.name, 46, y + 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(180, 220, 255);
    doc.text(
      `PO: ${order.client_order_ref || 'N/A'}   REQ: ${order.requisitor || 'Sin asignar'}   FECHA: ${order.date_order?.split(' ')[0] ?? '—'}   PROD: ${statusLabel}`,
      130,
      y + 13,
    );
    y += 20;

    const pendingLines = order.order_lines.filter((l) => l.qty_pending > 0);
    if (pendingLines.length === 0) {
      y += 4;
      continue;
    }

    autoTable(doc, {
      startY: y,
      margin: { left: 40, right: 40 },
      theme: 'grid',
      headStyles: {
        fillColor: [220, 230, 240],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        fontSize: 7,
        cellPadding: 3,
      },
      bodyStyles: { fontSize: 7, cellPadding: 3 },
      head: [['Producto', 'Descripción', 'Pendiente', 'Entregado', 'Total']],
      body: pendingLines.map((l) => [
        l.product.split('] ')[1] || l.product,
        l.description || '—',
        String(l.qty_pending),
        String(l.qty_delivered),
        String(l.qty),
      ]),
      columnStyles: {
        0: { cellWidth: 160 },
        2: { halign: 'center', cellWidth: 55 },
        3: { halign: 'center', cellWidth: 55 },
        4: { halign: 'center', cellWidth: 55 },
      },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  doc.save(`ordenes-odoo-${generatedAt.toISOString().slice(0, 10)}.pdf`);
}
