import { useCallback, useEffect, useState } from 'react';
import { Loader2, CloudDownload, RefreshCw, AlertCircle, FileDown } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  listOrdersToInvoice,
  listWorkOrderStatusBySoNumbers,
  type OdooOrderView,
  type ProductionStatus,
} from '../lib/firebase/odooOrders';
import { formatAgeDays, formatRelativeTime, getOrderAgeDays } from '../lib/age';
import { useSyncMeta } from '../hooks/useSyncMeta';

function exportPdf(orders: OdooOrderView[], productionMap: Map<string, ProductionStatus>): void {
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
      `PO: ${order.client_order_ref || 'N/A'}   FECHA: ${order.date_order?.split(' ')[0] ?? '—'}   ESTADO: ${order.invoice_status.toUpperCase()}   PRODUCCIÓN: ${statusLabel}`,
      130, y + 13,
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

export function OdooOrdersPanel() {
  const [orders, setOrders] = useState<OdooOrderView[]>([]);
  const [productionMap, setProductionMap] = useState<Map<string, ProductionStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { meta } = useSyncMeta();

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listOrdersToInvoice();
    if (result.ok) {
      // Drop orders where every line has been delivered — nothing left to produce.
      const pending = result.value.filter((o) =>
        o.order_lines.some((l) => l.qty_pending > 0),
      );
      setOrders(pending);
      // Lanza la segunda query en paralelo — no bloquea el render de las tarjetas
      const soNumbers = pending.map((o) => o.name);
      void listWorkOrderStatusBySoNumbers(soNumbers).then((r) => {
        if (r.ok) setProductionMap(r.value);
      });
    } else {
      const reason = (result as { ok: false; reason: string }).reason;
      setError(
        reason === 'not-authenticated'
          ? 'No hay sesión activa.'
          : reason === 'not-configured'
          ? 'Firebase no está configurado.'
          : 'Error al leer la base de datos de Firestore.',
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* ── Header ── */}
      <header className="shrink-0 border-b-2 border-line bg-surface px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-accent text-bg flex items-center justify-center corner-ticks shadow-hard">
            <CloudDownload size={22} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="font-display font-black text-2xl uppercase tracking-tight italic leading-none">
              Órdenes Odoo
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-dim mt-1">
              Pendientes de facturación (to invoice + upselling)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {meta && (
            <div
              className={`font-mono text-[10px] uppercase tracking-widest px-3 py-2 border-2 ${
                meta.status === 'error'
                  ? 'border-danger/50 text-danger'
                  : 'border-line text-ink-dim'
              }`}
              title={meta.status === 'error' ? meta.errorMessage : undefined}
            >
              {meta.status === 'error'
                ? `ERROR SYNC · ${formatRelativeTime(meta.lastSyncAt)}`
                : `SYNC · ${formatRelativeTime(meta.lastSyncAt)} · ${meta.ordersProcessed} ÓRDENES`}
            </div>
          )}
          <button
            onClick={() => exportPdf(orders, productionMap)}
            disabled={loading || orders.length === 0}
            className="flex items-center gap-2 px-4 py-2 border-2 border-line bg-surface-2 hover:border-ok hover:text-ok transition-colors disabled:opacity-30 text-[11px] font-black uppercase tracking-widest"
          >
            <FileDown size={14} />
            PDF
          </button>
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 border-2 border-line bg-surface-2 hover:border-accent hover:text-accent transition-colors disabled:opacity-50 text-[11px] font-black uppercase tracking-widest"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Cargando…' : 'Refrescar'}
          </button>
        </div>
      </header>

      {/* ── Contenido ── */}
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-ink-dim space-y-4">
            <Loader2 size={32} className="animate-spin text-accent" />
            <p className="font-mono text-[11px] uppercase tracking-widest">Sincronizando con Firestore…</p>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-danger space-y-4">
            <AlertCircle size={48} />
            <p className="font-mono text-sm border border-danger/50 bg-danger/10 p-4">{error}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-ink-dim space-y-4 border-2 border-dashed border-line bg-surface-2/30 p-12 text-center max-w-2xl mx-auto">
            <CloudDownload size={48} className="text-line" />
            <p className="font-display font-black text-2xl uppercase italic">No hay órdenes pendientes</p>
            <p className="font-mono text-xs uppercase tracking-widest">
              Todas las órdenes de Odoo están facturadas o no hay datos sincronizados.
            </p>
          </div>
        ) : (
          <div className="space-y-6 max-w-6xl mx-auto">
            {orders.map((order) => {
              const ageDays = order.date_order ? getOrderAgeDays(order.date_order.split(' ')[0]) : null;
              const prod = productionMap.get(order.name);
              const badge =
                !prod || prod.total === 0
                  ? { label: '○ SIN OTs', cls: 'bg-line/40 text-ink-dim' }
                  : prod.entregadas >= prod.total
                  ? { label: '✓ LISTO', cls: 'bg-ok text-bg' }
                  : { label: `◐ ${prod.entregadas}/${prod.total} OTs`, cls: 'bg-warn text-bg' };

              return (
                <div key={order.id} className="border-2 border-line bg-surface flex flex-col shadow-hard">
                  <div className="border-b-2 border-line bg-[#0D2B4D] text-white px-5 py-3 flex items-center justify-between flex-wrap gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="font-display font-black text-xl tracking-tight uppercase">
                          {order.name}
                        </h2>
                        <span className="bg-accent text-bg px-2 py-0.5 text-[10px] font-black uppercase tracking-widest">
                          {order.partner}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 font-mono text-[10px] opacity-80 uppercase tracking-widest">
                        <span>PO: {order.client_order_ref || 'N/A'}</span>
                        {order.date_order && (
                          <span>
                            FECHA: {order.date_order.split(' ')[0]}
                            {ageDays !== null && ` (${formatAgeDays(ageDays)})`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest font-mono ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <div className="text-right">
                        <p className="text-[10px] uppercase font-black tracking-widest opacity-60">Líneas</p>
                        <p className="font-display text-xl font-black">{order.order_lines.length}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-0">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-2 text-[10px] font-black uppercase tracking-widest text-ink-dim border-b border-line">
                          <th className="px-5 py-2 font-bold w-1/3">Producto</th>
                          <th className="px-5 py-2 font-bold">Descripción</th>
                          <th className="px-5 py-2 font-bold text-center w-24">Pendiente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.order_lines.map((line, idx) => {
                          const fullyDelivered = line.qty_pending <= 0;
                          return (
                            <tr
                              key={idx}
                              className={`border-b border-line last:border-b-0 transition-colors ${
                                fullyDelivered
                                  ? 'opacity-40 bg-ok/5'
                                  : 'hover:bg-surface-2/40'
                              }`}
                            >
                              <td className="px-5 py-3 align-top">
                                <span className="font-display font-black uppercase tracking-tight text-sm text-ink block">
                                  {line.product.split('] ')[1] || line.product}
                                </span>
                                {line.product.includes(']') && (
                                  <span className="font-mono text-[9px] text-ink-dim">
                                    {line.product.split(']')[0] + ']'}
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-3 font-mono text-xs text-ink align-top leading-snug">
                                {line.description || '—'}
                              </td>
                              <td className="px-5 py-3 text-center align-top">
                                {fullyDelivered ? (
                                  <span className="font-mono text-[10px] text-ok uppercase tracking-widest">
                                    ✓ entregada
                                  </span>
                                ) : (
                                  <div>
                                    <span className="font-black text-xl italic">{line.qty_pending}</span>
                                    {line.qty_delivered > 0 && (
                                      <span className="block font-mono text-[9px] text-ink-dim">
                                        de {line.qty} ({line.qty_delivered} entregadas)
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {order.order_lines.length === 0 && (
                          <tr>
                            <td colSpan={3} className="px-5 py-8 text-center text-ink-dim font-mono text-[10px] uppercase tracking-widest">
                              No hay líneas de producto en esta orden
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
