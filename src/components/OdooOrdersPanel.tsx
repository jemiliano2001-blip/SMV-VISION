import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  CloudDownload,
  RefreshCw,
  AlertCircle,
  FileDown,
  Mail,
  Truck,
  User,
  Users,
  Search,
  ChevronDown,
  ChevronRight,
  List,
  X,
  Printer,
  FileSearch,
  Send,
  Building2,
  CheckSquare,
  Square,
  Sparkles,
  AlertTriangle,
  ShoppingCart,
} from 'lucide-react';
import { triggerOdooSync } from '../lib/firebase/syncOdoo';
import { InvoiceRequestPanel } from './InvoiceRequestPanel';
import { ToolcribPrintModal } from './ToolcribPrintModal';
import { QuickPurchaseModal } from './QuickPurchaseModal';
import { Button } from './ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import {
  listOrdersToInvoice,
  listWorkOrderStatusBySoNumbers,
  type OdooOrderView,
  type OdooOrderLineView,
  type ProductionStatus,
} from '../lib/firebase/odooOrders';
import { recordToolcribPrintLogFireAndForget } from '../lib/firebase/toolcrib';
import {
  makeOrderDrawingLinkKey,
  parseOdooLineLabels,
} from '../lib/orderDrawingBridge';
import type { OrderDrawingLink, ToolcribActiveDrawingView } from '../types';
import { useSyncMeta } from '../hooks/useSyncMeta';
import type { UseToolcribCatalogResult } from '../hooks/useToolcribCatalog';
import type { UseOrderDrawingBridgeResult } from '../hooks/useOrderDrawingBridge';
import { formatAgeDays, formatRelativeTime, getOrderAgeDays } from '../lib/age';
import { checkRevisionDiscrepancy } from '../lib/matching';
import { openStampedPlanoOtBatch, type BatchPlanoOtItem } from '../lib/planoOt';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { log } from '../lib/log';

export interface OdooOrdersPanelProps {
  catalog: UseToolcribCatalogResult;
  bridge: UseOrderDrawingBridgeResult;
  onSendToReport: (link: OrderDrawingLink) => Promise<void>;
  onOpenBiblioteca: (query: string, linkKey: string) => void;
}

async function exportDeliverySlip(order: OdooOrderView): Promise<void> {
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
  let y = 200;
  
  const linesToDeliver = order.order_lines.filter(l => l.qty_pending > 0);
  
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

async function exportPdf(orders: OdooOrderView[], productionMap: Map<string, ProductionStatus>): Promise<void> {
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

export function OdooOrdersPanel({
  catalog,
  bridge,
  onSendToReport,
  onOpenBiblioteca,
}: OdooOrdersPanelProps) {
  const [orders, setOrders] = useState<OdooOrderView[]>([]);
  const [productionMap, setProductionMap] = useState<Map<string, ProductionStatus>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingOdoo, setSyncingOdoo] = useState(false);
  const [syncElapsedSeconds, setSyncElapsedSeconds] = useState(0);
  const [invoicePanelOpen, setInvoicePanelOpen] = useState(false);
  const [printDrawing, setPrintDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const [printSoNumber, setPrintSoNumber] = useState('');
  const [printCantidad, setPrintCantidad] = useState('');
  const [lineBusyKey, setLineBusyKey] = useState<string | null>(null);
  const [lineActionError, setLineActionError] = useState<string | null>(null);
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  // Selección múltiple para Batch Print de OTs
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [batchPrintStatus, setBatchPrintStatus] = useState<string | null>(null);

  // Requisición rápida de material / Compras
  const [quickPurchaseData, setQuickPurchaseData] = useState<{
    soNumber?: string;
    poNumber?: string;
    pieza?: string;
    numeroParte?: string;
    cantidad?: number | string;
    material?: string | null;
  } | null>(null);
  const [purchaseToast, setPurchaseToast] = useState<string | null>(null);

  // Compañía (partner) — vacío hasta elegir; no carga todas las órdenes de golpe.
  const [selectedPartnerKey, setSelectedPartnerKey] = useState<string | null>(null);

  // Vistas y Filtros por Requisitor
  const [viewMode, setViewMode] = useState<'all' | 'by_requisitor'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRequisitor, setSelectedRequisitor] = useState<string>('ALL');
  const [collapsedRequisitores, setCollapsedRequisitores] = useState<Record<string, boolean>>({});

  const syncTriggeredAt = useRef<Date | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { meta } = useSyncMeta();
  const partners = meta?.partners ?? [];

  const catalogErrorMessage = useCallback((): string => {
    return catalog.errorReason === 'not-configured'
      ? 'Firebase no está configurado para la biblioteca.'
      : catalog.errorReason === 'not-authenticated'
        ? 'Inicia sesión para buscar planos en la biblioteca.'
        : 'No fue posible cargar la biblioteca de planos.';
  }, [catalog.errorReason]);

  const ensureCatalogViews = useCallback(async (): Promise<readonly ToolcribActiveDrawingView[] | null> => {
    if (catalog.status === 'ready') {
      return catalog.views;
    }
    if (catalog.status === 'loading') {
      setLineActionError('Cargando catálogo de planos…');
      return null;
    }
    const loaded = await catalog.reload();
    if (!loaded) {
      setLineActionError(catalogErrorMessage());
      return null;
    }
    return loaded;
  }, [catalog, catalogErrorMessage]);

  const resolveLineLink = useCallback(
    (
      order: OdooOrderView,
      line: OdooOrderLineView,
      lineIdx: number,
      library: readonly ToolcribActiveDrawingView[],
    ) => {
      const { pieza, numeroParte } = parseOdooLineLabels(line.product, line.description || '');
      return bridge.resolveAndStore(
        {
          orderId: order.id,
          lineIndex: lineIdx,
          soNumber: order.name,
          poNumber: order.client_order_ref ?? '',
          pieza,
          numeroParte,
          qtyPending: line.qty_pending,
        },
        library,
        undefined,
      );
    },
    [bridge],
  );

  const handlePrintLinePlano = useCallback(
    async (order: OdooOrderView, line: OdooOrderLineView, lineIdx: number) => {
      const key = makeOrderDrawingLinkKey(order.id, lineIdx);
      setLineBusyKey(key);
      setLineActionError(null);

      const library = await ensureCatalogViews();
      if (!library) {
        setLineBusyKey(null);
        return;
      }

      const link = resolveLineLink(order, line, lineIdx, library);
      const cadView = bridge.getCadViewForPrint(link);
      if (!cadView) {
        setLineActionError('No hay plano CAD en biblioteca para esta pieza.');
        setLineBusyKey(null);
        return;
      }

      setPrintSoNumber(order.name);
      setPrintCantidad(String(line.qty_pending));
      setPrintDrawing(cadView);
      setLineBusyKey(null);
    },
    [ensureCatalogViews, resolveLineLink, bridge],
  );

  const handleSendLineToReport = useCallback(
    async (order: OdooOrderView, line: OdooOrderLineView, lineIdx: number) => {
      const key = makeOrderDrawingLinkKey(order.id, lineIdx);
      setSendingKey(key);
      setLineActionError(null);

      const library = await ensureCatalogViews();
      if (!library) {
        setSendingKey(null);
        return;
      }

      const link = resolveLineLink(order, line, lineIdx, library);
      const reportSnap = bridge.getReportSnapshot(link);
      if (!reportSnap) {
        setLineActionError('No hay plano (ISO/CAD) para enviar al reporte.');
        setSendingKey(null);
        return;
      }
      if (!reportSnap.pdfUrl) {
        setLineActionError(`El plano ${reportSnap.partNumber} no tiene URL descargable.`);
        setSendingKey(null);
        return;
      }

      try {
        await onSendToReport(link);
      } catch {
        setLineActionError('No se pudo enviar al reporte. Revisa la conexión.');
      } finally {
        setSendingKey(null);
      }
    },
    [ensureCatalogViews, resolveLineLink, bridge, onSendToReport],
  );

  const handleOpenBibliotecaForLine = useCallback(
    (order: OdooOrderView, line: OdooOrderLineView, lineIdx: number) => {
      const library = catalog.views;
      resolveLineLink(order, line, lineIdx, library);
      const { pieza, numeroParte, productLabel } = parseOdooLineLabels(
        line.product,
        line.description || '',
      );
      const query = (numeroParte || productLabel || pieza).trim();
      const linkKey = makeOrderDrawingLinkKey(order.id, lineIdx);
      onOpenBiblioteca(query, linkKey);
    },
    [catalog.views, resolveLineLink, onOpenBiblioteca],
  );

  const toggleSelectLine = useCallback((lineKey: string) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineKey)) {
        next.delete(lineKey);
      } else {
        next.add(lineKey);
      }
      return next;
    });
  }, []);

  const toggleSelectAllInOrder = useCallback((order: OdooOrderView) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      const orderLineKeys = order.order_lines
        .map((l, idx) => ({ l, key: makeOrderDrawingLinkKey(order.id, idx) }))
        .filter(({ l }) => l.qty_pending > 0)
        .map(({ key }) => key);

      const allSelected = orderLineKeys.length > 0 && orderLineKeys.every((k) => next.has(k));
      if (allSelected) {
        orderLineKeys.forEach((k) => next.delete(k));
      } else {
        orderLineKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  }, []);

  const handleBatchPrintOts = useCallback(async () => {
    if (selectedLines.size === 0) return;
    setBatchPrinting(true);
    setLineActionError(null);
    setBatchPrintStatus(`Preparando catálogo para ${selectedLines.size} OTs…`);

    try {
      const library = await ensureCatalogViews();
      if (!library) {
        setLineActionError('No se pudo cargar el catálogo de planos.');
        setBatchPrinting(false);
        setBatchPrintStatus(null);
        return;
      }

      const items: BatchPlanoOtItem[] = [];
      const now = new Date();
      const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      let processedCount = 0;
      for (const order of orders) {
        for (let idx = 0; idx < order.order_lines.length; idx++) {
          const line = order.order_lines[idx];
          const lineKey = makeOrderDrawingLinkKey(order.id, idx);
          if (!selectedLines.has(lineKey) || line.qty_pending <= 0) continue;

          processedCount += 1;
          setBatchPrintStatus(`Descargando plano ${processedCount} de ${selectedLines.size}…`);

          const link = resolveLineLink(order, line, idx, library);
          const cadView = bridge.getCadViewForPrint(link);
          if (!cadView || !cadView.pdfUrl) {
            log.warn(`[batch-print] Sin plano accesible para ${line.product}`);
            continue;
          }

          try {
            const pdfDataUrl = await fetchPdfAsDataUrl(cadView.pdfUrl);
            items.push({
              pdfDataUrl,
              stamp: {
                soNumber: order.name,
                cantidad: String(line.qty_pending),
                fecha,
                notas: line.description ? line.description.slice(0, 80) : undefined,
              },
              partNumber: cadView.partNumber,
              revision: cadView.revision,
            });

            // Log de impresión audit trail
            recordToolcribPrintLogFireAndForget({
              drawingId: cadView.drawingId,
              partId: cadView.partId,
              copies: 1,
              orderRef: order.name,
            });
          } catch (err) {
            log.warn(`[batch-print] Error descargando ${cadView.partNumber}`, err);
          }
        }
      }

      if (items.length === 0) {
        setLineActionError('Ninguna de las líneas seleccionadas tiene un plano CAD descargable.');
        return;
      }

      setBatchPrintStatus(`Combinando y sellando ${items.length} planos…`);
      await openStampedPlanoOtBatch(items);
      setSelectedLines(new Set());
    } catch (err) {
      setLineActionError(err instanceof Error ? err.message : 'Error al procesar lote de OTs.');
    } finally {
      setBatchPrinting(false);
      setBatchPrintStatus(null);
    }
  }, [selectedLines, orders, ensureCatalogViews, resolveLineLink, bridge]);

  const fetchOrders = useCallback(async (partnerKey: string) => {
    setLoading(true);
    setError(null);
    const result = await listOrdersToInvoice({ partnerKey });
    if (result.ok) {
      setOrders(result.value);
      const soNumbers = result.value.map((o) => o.name);
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

  const selectPartner = useCallback(
    (partnerKey: string) => {
      setSelectedPartnerKey(partnerKey);
      setSearchTerm('');
      setSelectedRequisitor('ALL');
      void fetchOrders(partnerKey);
    },
    [fetchOrders],
  );

  useEffect(() => {
    if (!syncingOdoo || !meta || !syncTriggeredAt.current) return;
    if (meta.lastSyncAt > syncTriggeredAt.current) {
      setSyncingOdoo(false);
      setSyncElapsedSeconds(0);
      syncTriggeredAt.current = null;
      if (syncTimeoutRef.current) clearInterval(syncTimeoutRef.current);
      if (selectedPartnerKey) {
        const stillThere = meta.partners.some((p) => p.key === selectedPartnerKey);
        if (stillThere) {
          void fetchOrders(selectedPartnerKey);
        } else {
          setSelectedPartnerKey(null);
          setOrders([]);
          setProductionMap(new Map());
        }
      }
    }
  }, [meta, syncingOdoo, fetchOrders, selectedPartnerKey]);

  const startSyncTimer = useCallback(() => {
    setSyncingOdoo(true);
    setSyncElapsedSeconds(0);
    syncTriggeredAt.current = new Date();
    
    if (syncTimeoutRef.current) clearInterval(syncTimeoutRef.current);
    
    syncTimeoutRef.current = setInterval(() => {
      setSyncElapsedSeconds(prev => {
        if (prev >= 120) {
          clearInterval(syncTimeoutRef.current!);
          setSyncingOdoo(false);
          syncTriggeredAt.current = null;
          setError('El sync tardó demasiado (timeout). Verifica el log en Firebase.');
          return 0;
        }
        return prev + 1;
      });
    }, 1000);
  }, []);

  const handleRefresh = useCallback(async () => {
    startSyncTimer();

    const result = await triggerOdooSync();
    if (!result.ok && 'reason' in result) {
      clearInterval(syncTimeoutRef.current!);
      setSyncingOdoo(false);
      setError(
        result.reason === 'not-authenticated'
          ? 'Debes iniciar sesión para sincronizar.'
          : `No se pudo sincronizar con Odoo: ${result.reason}`,
      );
    }
  }, [startSyncTimer]);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearInterval(syncTimeoutRef.current);
    };
  }, []);

  // Si la compañía seleccionada ya no aparece en el catálogo del sync, limpiar.
  useEffect(() => {
    if (!selectedPartnerKey || !meta) return;
    if (meta.partners.length === 0) return;
    if (!meta.partners.some((p) => p.key === selectedPartnerKey)) {
      setSelectedPartnerKey(null);
      setOrders([]);
      setProductionMap(new Map());
    }
  }, [meta, selectedPartnerKey]);

  // Lista de Requisitores únicos para el filtro selector
  const uniqueRequisitores = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      set.add(o.requisitor || 'Sin Requisitor');
    }
    return Array.from(set).sort();
  }, [orders]);

  // Órdenes filtradas por texto de búsqueda y por requisitor seleccionado
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      // Filtro por requisitor seleccionado
      if (selectedRequisitor !== 'ALL') {
        const reqName = o.requisitor || 'Sin Requisitor';
        if (reqName !== selectedRequisitor) return false;
      }

      // Filtro por búsqueda libre
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      const nameMatch = o.name.toLowerCase().includes(term);
      const poMatch = (o.client_order_ref || '').toLowerCase().includes(term);
      const partnerMatch = o.partner.toLowerCase().includes(term);
      const reqMatch = (o.requisitor || '').toLowerCase().includes(term);
      const lineMatch = o.order_lines.some(
        (l) =>
          l.product.toLowerCase().includes(term) ||
          l.description.toLowerCase().includes(term),
      );

      return nameMatch || poMatch || partnerMatch || reqMatch || lineMatch;
    });
  }, [orders, selectedRequisitor, searchTerm]);

  // Agrupación de órdenes por Requisitor
  const groupedByRequisitor = useMemo(() => {
    const groups = new Map<string, OdooOrderView[]>();
    for (const order of filteredOrders) {
      const reqKey = order.requisitor || 'Sin Requisitor';
      if (!groups.has(reqKey)) {
        groups.set(reqKey, []);
      }
      groups.get(reqKey)!.push(order);
    }
    // Ordenar grupos alfabéticamente (poniendo "Sin Requisitor" al final)
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'Sin Requisitor') return 1;
      if (b === 'Sin Requisitor') return -1;
      return a.localeCompare(b);
    });
  }, [filteredOrders]);

  const toggleGroupCollapse = (reqKey: string) => {
    setCollapsedRequisitores((prev) => ({
      ...prev,
      [reqKey]: !prev[reqKey],
    }));
  };

  const renderOrderCard = (order: OdooOrderView) => {
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
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-display font-black text-xl tracking-tight uppercase">
                {order.name}
              </h2>
              <span className="bg-accent text-bg px-2 py-0.5 text-[10px] font-black uppercase tracking-widest">
                {order.partner}
              </span>
              {order.requisitor && (
                <span className="bg-surface-2 text-ink border border-line/40 px-2.5 py-0.5 text-[10px] font-mono font-bold flex items-center gap-1.5 uppercase tracking-wide">
                  <User size={11} className="text-accent" />
                  {order.requisitor}
                </span>
              )}
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { exportDeliverySlip(order).catch((e) => log.error('[smv-vision] exportDeliverySlip falló', e)); }}
              className="flex items-center gap-2 bg-surface text-ink hover:bg-line ml-2"
              title="Generar PDF de Remisión (Preview)"
            >
              <Truck size={14} />
              <span className="text-[10px] font-black tracking-widest uppercase">Remisión (Test)</span>
            </Button>
          </div>
        </div>
        
        <div className="p-0">
          <Table className="w-full text-left border-collapse">
            <TableHeader>
              <TableRow className="bg-surface-2 text-[10px] font-black uppercase tracking-widest text-ink-dim border-b border-line hover:bg-surface-2">
                <TableHead className="w-10 px-3 py-2 text-center h-auto">
                  <button
                    type="button"
                    onClick={() => toggleSelectAllInOrder(order)}
                    className="text-ink hover:text-accent flex items-center justify-center mx-auto"
                    title="Seleccionar / deseleccionar todas las líneas de esta orden"
                  >
                    {order.order_lines.filter((l) => l.qty_pending > 0).length > 0 &&
                    order.order_lines
                      .filter((l) => l.qty_pending > 0)
                      .every((_, idx) => selectedLines.has(makeOrderDrawingLinkKey(order.id, idx))) ? (
                      <CheckSquare size={16} className="text-accent" />
                    ) : (
                      <Square size={16} className="text-ink-dim" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="px-5 py-2 font-bold w-1/3 text-ink-dim h-auto">Producto</TableHead>
                <TableHead className="px-5 py-2 font-bold text-ink-dim h-auto">Descripción</TableHead>
                <TableHead className="px-5 py-2 font-bold text-center w-28 text-ink-dim h-auto">Pendiente</TableHead>
                <TableHead className="px-5 py-2 font-bold text-center min-w-[220px] text-ink-dim h-auto">Plano</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.order_lines.map((line, idx) => {
                const fullyDelivered = line.qty_pending <= 0;
                const lineKey = makeOrderDrawingLinkKey(order.id, idx);
                const isMatching = lineBusyKey === lineKey;
                const isSending = sendingKey === lineKey;
                const link = bridge.links[lineKey];
                const partLabel =
                  link?.cadDrawing?.partNumber ??
                  link?.reportDrawing?.partNumber ??
                  null;
                const isSelected = selectedLines.has(lineKey);

                return (
                  <TableRow
                    key={idx}
                    className={`border-b border-line last:border-b-0 transition-colors ${
                      fullyDelivered
                        ? 'opacity-40 bg-ok/5 hover:bg-ok/5'
                        : isSelected
                          ? 'bg-accent/5 hover:bg-accent/10'
                          : 'hover:bg-surface-2/40'
                    }`}
                  >
                    <TableCell className="w-10 px-3 py-3 text-center align-middle">
                      {!fullyDelivered ? (
                        <button
                          type="button"
                          onClick={() => toggleSelectLine(lineKey)}
                          className="text-ink hover:text-accent flex items-center justify-center mx-auto"
                          title={isSelected ? 'Deseleccionar OT' : 'Seleccionar para imprimir en lote'}
                        >
                          {isSelected ? (
                            <CheckSquare size={16} className="text-accent" />
                          ) : (
                            <Square size={16} className="text-ink-dim" />
                          )}
                        </button>
                      ) : (
                        <span className="text-ink-dim opacity-30 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-3 align-top">
                      <span className="font-display font-black uppercase tracking-tight text-sm text-ink block">
                        {line.product.split('] ')[1] || line.product}
                      </span>
                      {line.product.includes(']') && (
                        <span className="font-mono text-[9px] text-ink-dim">
                          {line.product.split(']')[0] + ']'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-3 font-mono text-xs text-ink align-top leading-snug">
                      <div className="space-y-1.5">
                        <div>{line.description || '—'}</div>
                        {(() => {
                          const drawingRev = link?.cadDrawing?.revision ?? link?.reportDrawing?.revision;
                          if (drawingRev) {
                            const revCheck = checkRevisionDiscrepancy(
                              `${line.description || ''} ${line.product || ''}`,
                              drawingRev,
                            );
                            if (revCheck.hasMismatch) {
                              return (
                                <div
                                  className="inline-flex items-center gap-1.5 bg-warn/15 border border-warn text-warn font-mono text-[9px] font-bold px-2 py-0.5"
                                  title={`Discrepancia detectada: Odoo pide Rev "${revCheck.orderRev}" pero el catálogo tiene Rev "${revCheck.drawingRev}".`}
                                >
                                  <AlertTriangle size={11} className="shrink-0" />
                                  <span>Odoo pide Rev {revCheck.orderRev} (Plano es Rev {revCheck.drawingRev})</span>
                                </div>
                              );
                            }
                          }
                          return null;
                        })()}
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-3 text-center align-top">
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
                    </TableCell>
                    <TableCell className="px-5 py-3 text-center align-top">
                      {!fullyDelivered && (
                        <div className="flex flex-col items-stretch gap-1.5 min-w-[200px]">
                          {link && link.status !== 'no_match' && partLabel ? (
                            <div className="flex flex-col items-center">
                              <span
                                className="font-mono text-[9px] text-ok uppercase tracking-wide truncate max-w-[200px]"
                                title={`Score ${link.matchScore}`}
                              >
                                {partLabel}
                                {link.matchScore > 0 ? ` · ${link.matchScore}` : ''}
                              </span>
                              {link.status === 'manual' && (
                                <span className="inline-flex items-center gap-1 font-mono text-[8px] text-accent font-bold uppercase tracking-wider bg-accent/10 px-1.5 py-0.2 rounded mt-0.5">
                                  <Sparkles size={9} />
                                  Alias aprendido
                                </span>
                              )}
                            </div>
                          ) : link?.status === 'no_match' ? (
                            <span className="font-mono text-[9px] text-warn uppercase tracking-wide">
                              Sin plano
                            </span>
                          ) : null}
                          <div className="flex flex-wrap justify-center gap-1">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={lineBusyKey !== null || sendingKey !== null}
                              onClick={() => void handlePrintLinePlano(order, line, idx)}
                              className="inline-flex items-center gap-1"
                              title="Buscar plano CAD e imprimir OT"
                            >
                              {isMatching ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Printer size={12} />
                              )}
                              <span className="text-[9px] font-black uppercase tracking-widest">
                                Imprimir
                              </span>
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={lineBusyKey !== null || sendingKey !== null}
                              onClick={() => void handleSendLineToReport(order, line, idx)}
                              className="inline-flex items-center gap-1"
                              title="Adjuntar plano al reporte y abrir Generar Reporte"
                            >
                              {isSending ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Send size={12} />
                              )}
                              <span className="text-[9px] font-black uppercase tracking-widest">
                                Reporte
                              </span>
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                const parsed = parseOdooLineLabels(line.product, line.description);
                                setQuickPurchaseData({
                                  soNumber: order.name,
                                  poNumber: order.client_order_ref || undefined,
                                  pieza: parsed.pieza || line.product,
                                  numeroParte: parsed.numeroParte || undefined,
                                  cantidad: line.qty_pending,
                                });
                              }}
                              className="inline-flex items-center gap-1 hover:border-accent hover:text-accent"
                              title="Requisitar material o insumos para esta orden en Compras"
                            >
                              <ShoppingCart size={12} />
                              <span className="text-[9px] font-black uppercase tracking-widest">
                                Comprar
                              </span>
                            </Button>
                            {(link?.status === 'no_match' || !link || !link.cadDrawing) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={lineBusyKey !== null || sendingKey !== null}
                                onClick={() => handleOpenBibliotecaForLine(order, line, idx)}
                                className="inline-flex items-center gap-1"
                                title="Buscar plano en Biblioteca"
                              >
                                <FileSearch size={12} />
                                <span className="text-[9px] font-black uppercase tracking-widest">
                                  Biblioteca
                                </span>
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {order.order_lines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="px-5 py-8 text-center text-ink-dim font-mono text-[10px] uppercase tracking-widest">
                    No hay líneas de producto en esta orden
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* ── Header Principal ── */}
      <header className="shrink-0 border-b-2 border-line bg-surface px-6 py-4 flex items-center justify-between flex-wrap gap-4">
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
        <div className="flex items-center gap-2 flex-wrap">
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
          {selectedLines.size > 0 && (
            <Button
              variant="ghost"
              onClick={() => void handleBatchPrintOts()}
              disabled={batchPrinting}
              className="flex items-center gap-2 px-4 py-2 border-2 border-ok bg-ok text-bg hover:bg-ok/80 transition-colors disabled:opacity-50 text-[11px] font-black uppercase tracking-widest shadow-hard hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 h-auto rounded-none"
              title="Combinar y abrir en un solo PDF todas las OTs seleccionadas"
            >
              {batchPrinting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Printer size={14} />
              )}
              {batchPrinting ? 'Imprimiendo…' : `Imprimir Lote (${selectedLines.size} OTs)`}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setInvoicePanelOpen(true)}
            disabled={loading || orders.length === 0}
            className="flex items-center gap-2 px-4 py-2 border-2 border-accent bg-accent text-bg hover:bg-accent/80 transition-colors disabled:opacity-30 text-[11px] font-black uppercase tracking-widest shadow-hard hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 h-auto rounded-none"
          >
            <Mail size={14} />
            Factura / Remisión
          </Button>
          <Button
            variant="ghost"
            onClick={() => { exportPdf(filteredOrders, productionMap).catch((e) => log.error('[smv-vision] exportPdf falló', e)); }}
            disabled={loading || filteredOrders.length === 0}
            className="flex items-center gap-2 px-4 py-2 border-2 border-line bg-surface-2 hover:border-ok hover:text-ok transition-colors disabled:opacity-30 text-[11px] font-black uppercase tracking-widest h-auto rounded-none text-ink hover:bg-surface-2"
          >
            <FileDown size={14} />
            PDF
          </Button>
          <Button
            variant="ghost"
            onClick={() => void handleRefresh()}
            disabled={loading || syncingOdoo}
            className="flex items-center gap-2 px-4 py-2 border-2 border-line bg-surface-2 hover:border-accent hover:text-accent transition-colors disabled:opacity-50 text-[11px] font-black uppercase tracking-widest h-auto rounded-none text-ink hover:bg-surface-2"
          >
            <RefreshCw size={14} className={(loading || syncingOdoo) ? 'animate-spin' : ''} />
            {syncingOdoo ? `Sincronizando… ${syncElapsedSeconds}s` : loading ? 'Cargando…' : 'Refrescar'}
          </Button>
        </div>
      </header>

      {/* ── Banner de Progreso Batch Print ── */}
      {batchPrintStatus && (
        <div className="bg-accent/15 border-b-2 border-accent px-6 py-2 flex items-center justify-between text-ink font-mono text-xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-accent" />
            <span className="font-bold">{batchPrintStatus}</span>
          </div>
        </div>
      )}

      {/* ── Compañías (partners) — carga perezosa ── */}
      <section className="shrink-0 border-b-2 border-line bg-surface px-6 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Building2 size={14} className="text-accent" />
          <span className="font-mono text-[10px] uppercase font-bold tracking-widest text-ink-dim">
            Compañía
          </span>
        </div>
        {partners.length === 0 ? (
          <p className="font-mono text-[11px] text-ink-dim uppercase tracking-wider">
            Sin compañías en el último sync. Pulsa Refrescar para sincronizar Odoo.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {partners.map((partner) => {
              const selected = selectedPartnerKey === partner.key;
              return (
                <button
                  key={partner.key}
                  type="button"
                  onClick={() => selectPartner(partner.key)}
                  className={`flex items-center gap-2 px-3 py-1.5 border-2 text-[11px] font-black uppercase tracking-wider transition-colors ${
                    selected
                      ? 'border-accent bg-accent text-bg'
                      : 'border-line bg-surface-2 text-ink hover:border-accent hover:text-accent'
                  }`}
                >
                  <span className="max-w-[220px] truncate">{partner.name}</span>
                  <span
                    className={`px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                      selected ? 'bg-bg text-accent' : 'bg-accent text-bg'
                    }`}
                  >
                    {partner.toInvoiceCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Subheader / Barra de Navegación y Filtros por Requisitor ── */}
      {selectedPartnerKey && (
        <section className="shrink-0 border-b-2 border-line bg-surface-2 px-6 py-3 flex items-center justify-between flex-wrap gap-4">
          {/* Selector de Modo de Vista */}
          <div className="flex items-center border-2 border-line bg-surface p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode('all')}
              className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors ${
                viewMode === 'all'
                  ? 'bg-[#0D2B4D] text-white shadow-sm'
                  : 'text-ink-dim hover:text-ink hover:bg-surface-2'
              }`}
            >
              <List size={14} />
              <span>Todas las Órdenes</span>
              <span className="ml-1 px-1.5 py-0.2 font-mono text-[9px] bg-accent text-bg font-bold">
                {orders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('by_requisitor')}
              className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors ${
                viewMode === 'by_requisitor'
                  ? 'bg-[#0D2B4D] text-white shadow-sm'
                  : 'text-ink-dim hover:text-ink hover:bg-surface-2'
              }`}
            >
              <Users size={14} />
              <span>Por Requisitor</span>
              <span className="ml-1 px-1.5 py-0.2 font-mono text-[9px] bg-accent text-bg font-bold">
                {uniqueRequisitores.length}
              </span>
            </button>
          </div>

          {/* Barra de Filtros y Búsqueda */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Selector Filtro de Requisitor */}
            <div className="flex items-center gap-2 bg-surface border-2 border-line px-3 py-1 text-xs">
              <User size={14} className="text-accent" />
              <span className="font-mono text-[10px] uppercase font-bold text-ink-dim">Ingeniero:</span>
              <select
                value={selectedRequisitor}
                onChange={(e) => setSelectedRequisitor(e.target.value)}
                className="bg-transparent font-mono text-xs text-ink font-bold focus:outline-none uppercase cursor-pointer"
              >
                <option value="ALL">TODOS ({orders.length})</option>
                {uniqueRequisitores.map((req) => {
                  const count = orders.filter((o) => (o.requisitor || 'Sin Requisitor') === req).length;
                  return (
                    <option key={req} value={req}>
                      {req} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Caja de Búsqueda Rápida */}
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-ink-dim" />
              <input
                type="text"
                placeholder="Buscar SO, PO, requisitor, pieza…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-surface border-2 border-line pl-8 pr-8 py-1 font-mono text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent w-64 uppercase"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 text-ink-dim hover:text-ink"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Contenido Principal ── */}
      <main className="flex-1 overflow-y-auto p-6">
        {lineActionError && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{lineActionError}</span>
            <button
              type="button"
              className="ml-auto text-ink-dim hover:text-ink"
              onClick={() => setLineActionError(null)}
              aria-label="Cerrar"
            >
              <X size={14} />
            </button>
          </div>
        )}
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
        ) : !selectedPartnerKey ? (
          <div className="h-full flex flex-col items-center justify-center text-ink-dim space-y-4 border-2 border-dashed border-line bg-surface-2/30 p-12 text-center max-w-2xl mx-auto">
            <Building2 size={48} className="text-line" />
            <p className="font-display font-black text-2xl uppercase italic">
              Elige una compañía para ver sus órdenes
            </p>
            <p className="font-mono text-xs uppercase tracking-widest">
              Los botones de arriba cargan solo las órdenes de esa compañía.
            </p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-ink-dim space-y-4 border-2 border-dashed border-line bg-surface-2/30 p-12 text-center max-w-2xl mx-auto">
            <CloudDownload size={48} className="text-line" />
            <p className="font-display font-black text-2xl uppercase italic">No se encontraron órdenes</p>
            <p className="font-mono text-xs uppercase tracking-widest">
              {searchTerm || selectedRequisitor !== 'ALL'
                ? 'Ninguna orden coincide con los filtros de búsqueda aplicados.'
                : 'Todas las órdenes de esta compañía están facturadas o no hay datos sincronizados.'}
            </p>
            {(searchTerm || selectedRequisitor !== 'ALL') && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearchTerm('');
                  setSelectedRequisitor('ALL');
                }}
                className="font-mono text-xs underline text-accent uppercase"
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        ) : viewMode === 'all' ? (
          /* ── MODO 1: Vista de Lista Plana (Todas las órdenes) ── */
          <div className="space-y-6 max-w-6xl mx-auto">
            {filteredOrders.map((order) => renderOrderCard(order))}
          </div>
        ) : (
          /* ── MODO 2: Vista Agrupada por Requisitor / Ingeniero ── */
          <div className="space-y-8 max-w-6xl mx-auto">
            {groupedByRequisitor.map(([requisitorName, groupOrders]) => {
              const isCollapsed = collapsedRequisitores[requisitorName] ?? false;

              // Métricas del grupo de este Requisitor
              const totalLines = groupOrders.reduce((sum, o) => sum + o.order_lines.length, 0);
              const totalPendingPieces = groupOrders.reduce(
                (sum, o) => sum + o.order_lines.reduce((lSum, line) => lSum + line.qty_pending, 0),
                0,
              );

              return (
                <div
                  key={requisitorName}
                  className="border-2 border-line bg-surface shadow-hard overflow-hidden"
                >
                  {/* Encabezado del Grupo / Requisitor */}
                  <div
                    onClick={() => toggleGroupCollapse(requisitorName)}
                    className="bg-[#0D2B4D] text-white px-5 py-3.5 flex items-center justify-between cursor-pointer select-none border-b-2 border-line hover:bg-[#12365e] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-none bg-accent text-bg font-black flex items-center justify-center border border-accent">
                        <User size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="font-display font-black text-xl tracking-tight uppercase">
                            {requisitorName}
                          </h2>
                          <span className="bg-accent text-bg px-2 py-0.5 text-[10px] font-black uppercase tracking-widest font-mono">
                            {groupOrders.length} {groupOrders.length === 1 ? 'ORDEN' : 'ÓRDENES'}
                          </span>
                        </div>
                        <p className="font-mono text-[10px] opacity-70 uppercase tracking-widest mt-0.5">
                          {totalLines} LÍNEAS TOTALES · {totalPendingPieces} PIEZAS PENDIENTES
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-bold uppercase tracking-wider opacity-80">
                        {isCollapsed ? 'Mostrar órdenes' : 'Ocultar'}
                      </span>
                      {isCollapsed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>

                  {/* Lista de Órdenes del Requisitor */}
                  {!isCollapsed && (
                    <div className="p-5 space-y-6 bg-surface-2/20">
                      {groupOrders.map((order) => renderOrderCard(order))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Modal de Factura / Remisión ── */}
      <InvoiceRequestPanel
        open={invoicePanelOpen}
        onClose={() => setInvoicePanelOpen(false)}
        orders={orders}
        productionMap={productionMap}
      />

      <ToolcribPrintModal
        drawing={printDrawing}
        initialSoNumber={printSoNumber}
        initialCantidad={printCantidad}
        onClose={() => {
          setPrintDrawing(null);
          setPrintSoNumber('');
          setPrintCantidad('');
        }}
        onSuccess={() => {
          if (printDrawing) {
            recordToolcribPrintLogFireAndForget({
              drawingId: printDrawing.drawingId,
              partId: printDrawing.partId,
              copies: 1,
              orderRef: printSoNumber || null,
            });
          }
        }}
      />

      {/* ── Modal de Requisición Rápida de Compras ── */}
      <QuickPurchaseModal
        open={quickPurchaseData !== null}
        defaultData={quickPurchaseData}
        onClose={() => setQuickPurchaseData(null)}
        onSuccess={() => {
          setPurchaseToast('✓ Requisición guardada con éxito en Compras.');
          setTimeout(() => setPurchaseToast(null), 4000);
        }}
      />

      {/* ── Toast de confirmación de compra ── */}
      {purchaseToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0D2B4D] text-white border-2 border-accent shadow-hard px-4 py-2.5 font-mono text-xs flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <span className="text-accent font-bold">✓</span>
          <span>{purchaseToast}</span>
        </div>
      )}
    </div>
  );
}
