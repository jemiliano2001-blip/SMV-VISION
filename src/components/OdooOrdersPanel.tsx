import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  CloudDownload,
  RefreshCw,
  AlertCircle,
  FileDown,
  Mail,
  Users,
  Search,
  ChevronDown,
  ChevronRight,
  List,
  X,
  Printer,
  AlertTriangle,
  MousePointerClick,
} from 'lucide-react';
import { triggerOdooSync } from '../lib/firebase/syncOdoo';
import { InvoiceRequestPanel } from './InvoiceRequestPanel';
import { ToolcribPrintModal } from './ToolcribPrintModal';
import { Button } from './ui/button';
import {
  listOrdersToInvoice,
  listWorkOrderStatusBySoNumbers,
  type OdooOrderView,
  type ProductionStatus,
} from '../lib/firebase/odooOrders';
import { recordToolcribPrintLogFireAndForget } from '../lib/firebase/toolcrib';
import type { OrderDrawingLink } from '../types';
import { useSyncMeta } from '../hooks/useSyncMeta';
import type { UseToolcribCatalogResult } from '../hooks/useToolcribCatalog';
import type { UseOrderDrawingBridgeResult } from '../hooks/useOrderDrawingBridge';
import { makeOrderDrawingLinkKey, parseOdooLineLabels } from '../lib/orderDrawingBridge';
import { useOdooLineActions } from '../hooks/useOdooLineActions';
import { useBatchPrintOts } from '../hooks/useBatchPrintOts';
import { requesterKey, useOdooOrdersFilters } from '../hooks/useOdooOrdersFilters';
import { OrderDetail } from './odoo-orders/OrderDetail';
import { OrderListRow } from './odoo-orders/OrderListRow';
import { PageFrame } from './shell/PageFrame';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './ui/sheet';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { formatRelativeTime } from '../lib/age';
import { log } from '../lib/log';
import { exportDeliverySlip, exportOdooOrdersReportPdf as exportPdf } from '../lib/deliverySlipGenerator';

/** Valor del selector de compañía que carga las órdenes de todas. */
export const ALL_PARTNERS = 'ALL';

export interface OdooOrdersPanelProps {
  /** Viven en App para sobrevivir el viaje a Biblioteca y de regreso. */
  partnerKey: string;
  onPartnerKeyChange: (partnerKey: string) => void;
  selectedOrderId: string | null;
  onSelectedOrderIdChange: (orderId: string | null) => void;
  catalog: UseToolcribCatalogResult;
  bridge: UseOrderDrawingBridgeResult;
  onSendToReport: (link: OrderDrawingLink) => Promise<void>;
  onOpenBiblioteca: (query: string, linkKey: string) => void;
  /**
   * Requisición rápida — delega al modal único de App para que
   * `purchasedKeys` y el toast de confirmación sean consistentes sin
   * importar desde qué vista se disparó.
   */
  onQuickPurchase: (data: {
    soNumber?: string;
    poNumber?: string;
    pieza?: string;
    numeroParte?: string;
    cantidad?: number | string;
    material?: string | null;
    rowKey?: string;
  }) => void;
}

export function OdooOrdersPanel({
  partnerKey,
  onPartnerKeyChange,
  selectedOrderId,
  onSelectedOrderIdChange,
  catalog,
  bridge,
  onSendToReport,
  onOpenBiblioteca,
  onQuickPurchase,
}: OdooOrdersPanelProps) {
  const [orders, setOrders] = useState<OdooOrderView[]>([]);
  const [productionMap, setProductionMap] = useState<Map<string, ProductionStatus>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingOdoo, setSyncingOdoo] = useState(false);
  const [syncElapsedSeconds, setSyncElapsedSeconds] = useState(0);
  const [invoicePanelOpen, setInvoicePanelOpen] = useState(false);

  const isDesktop = useMediaQuery('(min-width: 1280px)');
  const syncTriggeredAt = useRef<Date | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { meta } = useSyncMeta();
  const partners = meta?.partners ?? [];

  const lineActions = useOdooLineActions({
    catalog,
    bridge,
    onSendToReport,
    onOpenBiblioteca,
  });

  const batchPrint = useBatchPrintOts({
    orders,
    bridge,
    ensureCatalogViews: lineActions.ensureCatalogViews,
    resolveLineLink: lineActions.resolveLineLink,
    onError: lineActions.setLineActionError,
  });

  // Precomputar mapa puro de links para evitar re-renders y evaluar en O(1)
  const resolvedLinksMap = useMemo(() => {
    const map = new Map<string, OrderDrawingLink>();
    if (orders.length === 0 || catalog.views.length === 0) {
      return map;
    }
    for (const order of orders) {
      const lines = order.order_lines ?? [];
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const pending = line.qty_pending_from_pickings ?? line.qty_pending;
        if (pending <= 0) continue;

        const key = makeOrderDrawingLinkKey(order.id, idx);
        const existing = bridge.links[key];
        if (existing) {
          map.set(key, existing);
          continue;
        }

        const { pieza, numeroParte } = parseOdooLineLabels(line.product, line.description || '');
        const link = bridge.resolveLink(
          {
            orderId: order.id,
            lineIndex: idx,
            soNumber: order.name,
            poNumber: order.client_order_ref ?? '',
            pieza,
            numeroParte,
            qtyPending: line.qty_pending,
          },
          catalog.views,
          catalog.signalsByDrawingId,
        );
        map.set(key, link);
      }
    }
    return map;
  }, [orders, catalog.views, catalog.signalsByDrawingId, bridge.links, bridge.resolveLink]);

  const isOrderMissingDrawing = useCallback(
    (order: OdooOrderView) => {
      const lines = order.order_lines ?? [];
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const pending = line.qty_pending_from_pickings ?? line.qty_pending;
        if (pending > 0) {
          const key = makeOrderDrawingLinkKey(order.id, idx);
          const link = resolvedLinksMap.get(key);
          if (!link || (!link.cadDrawing && !link.reportDrawing)) {
            return true;
          }
        }
      }
      return false;
    },
    [resolvedLinksMap],
  );

  const filters = useOdooOrdersFilters({ orders, isOrderMissingDrawing });

  const fetchOrders = useCallback(async (key: string) => {
    setLoading(true);
    setError(null);
    const result = await listOrdersToInvoice(
      key === ALL_PARTNERS ? { partnerKeyPrefix: '' } : { partnerKey: key },
    );
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
    (key: string) => {
      onPartnerKeyChange(key);
      onSelectedOrderIdChange(null);
      filters.setSearchTerm('');
      filters.setSelectedRequisitor('ALL');
      batchPrint.clearSelection();
    },
    [onPartnerKeyChange, onSelectedOrderIdChange, filters, batchPrint],
  );

  useEffect(() => {
    void fetchOrders(partnerKey);
  }, [partnerKey, fetchOrders]);

  // En escritorio siempre hay una orden abierta: la más urgente de lo filtrado.
  const selectedOrder = filters.filteredOrders.find((o) => o.id === selectedOrderId) ?? null;
  const firstOrderId = filters.filteredOrders[0]?.id ?? null;
  useEffect(() => {
    if (isDesktop && !loading && !selectedOrder && firstOrderId) {
      onSelectedOrderIdChange(firstOrderId);
    }
  }, [isDesktop, loading, selectedOrder, firstOrderId, onSelectedOrderIdChange]);

  useEffect(() => {
    if (!syncingOdoo || !meta || !syncTriggeredAt.current) return;
    if (meta.lastSyncAt > syncTriggeredAt.current) {
      setSyncingOdoo(false);
      setSyncElapsedSeconds(0);
      syncTriggeredAt.current = null;
      if (syncTimeoutRef.current) clearInterval(syncTimeoutRef.current);
      const stillThere =
        partnerKey === ALL_PARTNERS || meta.partners.some((p) => p.key === partnerKey);
      if (stillThere) {
        void fetchOrders(partnerKey);
      } else {
        onPartnerKeyChange(ALL_PARTNERS);
      }
    }
  }, [meta, syncingOdoo, fetchOrders, partnerKey, onPartnerKeyChange]);

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

  // Si la compañía seleccionada ya no aparece en el catálogo del sync, volver a todas.
  useEffect(() => {
    if (partnerKey === ALL_PARTNERS || !meta || meta.partners.length === 0) return;
    if (!meta.partners.some((p) => p.key === partnerKey)) {
      onPartnerKeyChange(ALL_PARTNERS);
    }
  }, [meta, partnerKey, onPartnerKeyChange]);

  const renderOrderDetail = (order: OdooOrderView) => (
    <OrderDetail
      key={order.id}
      order={order}
      productionMap={productionMap}
      bridge={bridge}
      resolvedLinksMap={resolvedLinksMap}
      selectedLines={batchPrint.selectedLines}
      lineBusyKey={lineActions.lineBusyKey}
      sendingKey={lineActions.sendingKey}
      onToggleSelectLine={batchPrint.toggleSelectLine}
      onToggleSelectAllInOrder={batchPrint.toggleSelectAllInOrder}
      onPrintLine={lineActions.handlePrintLinePlano}
      onSendLineToReport={lineActions.handleSendLineToReport}
      onSendOrderToReport={lineActions.handleSendOrderToReport}
      onQuickPurchase={onQuickPurchase}
      onOpenBiblioteca={(ord, line, idx) => lineActions.handleOpenBibliotecaForLine(ord, line, idx)}
      onExportDeliverySlip={(ord) => {
        exportDeliverySlip(ord).catch((e) => {
          log.error('[smv-vision] exportDeliverySlip falló', e);
          lineActions.setLineActionError('No se pudo generar el PDF de remisión.');
        });
      }}
    />
  );

  const renderOrderRow = (order: OdooOrderView) => (
    <OrderListRow
      key={order.id}
      order={order}
      selected={order.id === selectedOrderId}
      missingDrawing={isOrderMissingDrawing(order)}
      onSelect={onSelectedOrderIdChange}
    />
  );

  const urgencyOptions = [
    { key: 'ALL', label: 'Todas', count: filters.urgencyCounts.all, tone: 'text-ink' },
    { key: 'OVERDUE', label: 'Vencidas', count: filters.urgencyCounts.overdue, tone: 'text-danger', title: 'Más de 14 días desde su emisión' },
    { key: 'CRITICAL', label: 'Críticas', count: filters.urgencyCounts.critical, tone: 'text-warn', title: 'Entre 8 y 14 días desde su emisión' },
    { key: 'NORMAL', label: 'Recientes', count: filters.urgencyCounts.normal, tone: 'text-ok', title: 'Menos de 8 días desde su emisión' },
    { key: 'MISSING_DRAWING', label: 'Sin plano', count: filters.urgencyCounts.missingDrawing, tone: 'text-accent', title: 'Con líneas activas sin plano vinculado' },
  ] as const;

  const hasActiveFilters = Boolean(filters.searchTerm) || filters.selectedRequisitor !== 'ALL' || filters.urgencyFilter !== 'ALL';
  const fieldClass = 'h-10 rounded-lg border border-line bg-surface-2 px-3 text-xs text-ink focus:outline-none focus:border-accent';

  return (
    <>
      <PageFrame
        scrollBody={false}
        title="Órdenes de producción"
        subtitle={
          meta?.status === 'error' ? (
            <span className="text-danger" title={meta.errorMessage}>
              Falló el último sync
              {meta.lastSuccessfulSyncAt ? ` · último correcto ${formatRelativeTime(meta.lastSuccessfulSyncAt)}` : ''}
            </span>
          ) : meta ? (
            `Pendientes de facturar · sync ${formatRelativeTime(meta.lastSyncAt)} · ${meta.ordersProcessed} órdenes`
          ) : (
            'Pendientes de facturar'
          )
        }
        actions={
          <>
            {batchPrint.selectedLines.size > 0 && (
              <Button
                variant="ghost"
                onClick={() => void batchPrint.handleBatchPrintOts()}
                disabled={batchPrint.batchPrinting}
                className="flex items-center gap-2 px-4 rounded-lg border border-ok bg-ok text-bg hover:bg-ok/80 transition-colors disabled:opacity-50 text-[11px] font-semibold h-10"
                title="Combinar y abrir en un solo PDF todas las OTs seleccionadas"
              >
                {batchPrint.batchPrinting ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                {batchPrint.batchPrinting ? 'Imprimiendo…' : `Imprimir lote (${batchPrint.selectedLines.size})`}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => setInvoicePanelOpen(true)}
              disabled={loading || filters.filteredOrders.length === 0}
              className="flex items-center gap-2 px-4 rounded-lg border border-accent bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-30 text-[11px] font-semibold shadow-hard-accent h-10"
            >
              <Mail size={14} />
              Factura / Remisión
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                exportPdf(filters.filteredOrders, productionMap).catch((e) => {
                  log.error('[smv-vision] exportPdf falló', e);
                  lineActions.setLineActionError('No se pudo generar el PDF del reporte de órdenes.');
                });
              }}
              disabled={loading || filters.filteredOrders.length === 0}
              className="flex items-center gap-2 px-4 rounded-lg border border-line bg-surface-2 hover:border-ok hover:text-ok transition-colors disabled:opacity-30 text-[11px] font-semibold h-10 text-ink"
            >
              <FileDown size={14} />
              PDF
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleRefresh()}
              disabled={loading || syncingOdoo}
              className="flex items-center gap-2 px-4 rounded-lg border border-line bg-surface-2 hover:border-accent hover:text-accent transition-colors disabled:opacity-50 text-[11px] font-semibold h-10 text-ink"
            >
              <RefreshCw size={14} className={loading || syncingOdoo ? 'animate-spin' : ''} />
              {syncingOdoo ? `Sincronizando… ${syncElapsedSeconds}s` : loading ? 'Cargando…' : 'Refrescar'}
            </Button>
          </>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <select
              aria-label="Compañía"
              value={partnerKey}
              onChange={(e) => selectPartner(e.target.value)}
              className={`${fieldClass} font-semibold w-full sm:w-56`}
            >
              <option value={ALL_PARTNERS}>Todas las compañías</option>
              {partners.map((partner) => (
                <option key={partner.key} value={partner.key}>
                  {partner.name} ({partner.toInvoiceCount})
                </option>
              ))}
            </select>

            <div className="relative w-full sm:w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
              <input
                type="text"
                aria-label="Buscar órdenes"
                placeholder="Buscar SO, PO, pieza…"
                value={filters.searchTerm}
                onChange={(e) => filters.setSearchTerm(e.target.value)}
                className={`${fieldClass} w-full pl-8 pr-9 placeholder:text-ink-dim`}
              />
              {filters.searchTerm && (
                <button
                  type="button"
                  onClick={() => filters.setSearchTerm('')}
                  className="absolute right-0 top-0 grid size-10 place-items-center text-ink-dim hover:text-ink"
                  aria-label="Limpiar búsqueda"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <select
              aria-label="Ingeniero"
              value={filters.selectedRequisitor}
              onChange={(e) => filters.setSelectedRequisitor(e.target.value)}
              className={`${fieldClass} w-full sm:w-48`}
            >
              <option value="ALL">Todos los ingenieros ({filters.searchMatchedOrders.length})</option>
              {filters.uniqueRequisitores.map((req) => {
                const count = filters.searchMatchedOrders.filter((o) => requesterKey(o) === req).length;
                return (
                  <option key={req} value={req}>
                    {req} ({count})
                  </option>
                );
              })}
            </select>

            <div role="group" aria-label="Urgencia" className="flex items-center gap-1 overflow-x-auto scrollbar-none max-w-full">
              {urgencyOptions.map((option) => {
                if (option.key !== 'ALL' && option.count === 0) return null;
                const active = filters.urgencyFilter === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={active}
                    title={'title' in option ? option.title : undefined}
                    onClick={() => filters.setUrgencyFilter(active ? 'ALL' : option.key)}
                    className={`h-10 shrink-0 rounded-lg px-2.5 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                      active ? 'bg-surface-2 ring-1 ring-line' : 'hover:bg-surface-2'
                    } ${option.tone}`}
                  >
                    {option.label} <span className="font-mono tabular-nums">{option.count}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 sm:ml-auto">
              <button
                type="button"
                aria-pressed={filters.viewMode === 'all'}
                title="Ver lista completa"
                aria-label="Ver lista completa"
                onClick={() => filters.setViewMode('all')}
                className={`grid size-10 place-items-center rounded-lg transition-colors ${
                  filters.viewMode === 'all' ? 'bg-surface-2 text-accent ring-1 ring-line' : 'text-ink-dim hover:text-ink'
                }`}
              >
                <List size={16} />
              </button>
              <button
                type="button"
                aria-pressed={filters.viewMode === 'by_requisitor'}
                title="Agrupar por ingeniero"
                aria-label="Agrupar por ingeniero"
                onClick={() => filters.setViewMode('by_requisitor')}
                className={`grid size-10 place-items-center rounded-lg transition-colors ${
                  filters.viewMode === 'by_requisitor' ? 'bg-surface-2 text-accent ring-1 ring-line' : 'text-ink-dim hover:text-ink'
                }`}
              >
                <Users size={16} />
              </button>
            </div>
          </div>
        }
        notices={
          <>
            {meta?.status === 'error' && (
              <div className="shrink-0 bg-danger/10 border-b border-danger px-4 sm:px-6 py-2 flex items-center justify-between text-danger text-xs flex-wrap gap-2">
                <span className="flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  {meta.errorMessage || 'Error de conexión con Odoo.'}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRefresh()}
                  disabled={syncingOdoo}
                  className="border-danger text-danger hover:bg-danger hover:text-bg"
                >
                  Reintentar sync
                </Button>
              </div>
            )}
            {batchPrint.batchPrintStatus && (
              <div className="shrink-0 bg-accent/15 border-b border-accent px-4 sm:px-6 py-2 flex items-center gap-2 text-ink text-xs font-semibold">
                <Loader2 size={14} className="animate-spin text-accent" />
                {batchPrint.batchPrintStatus}
              </div>
            )}
            {lineActions.lineActionError && (
              <div className="shrink-0 bg-danger/10 border-b border-danger/40 px-4 sm:px-6 py-2 flex items-start gap-2 text-sm text-danger">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{lineActions.lineActionError}</span>
                <button
                  type="button"
                  className="ml-auto text-ink-dim hover:text-ink"
                  onClick={() => lineActions.setLineActionError(null)}
                  aria-label="Cerrar"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </>
        }
      >
        {/* ── Lista ── */}
        <section
          aria-label="Lista de órdenes"
          className="w-full xl:w-[420px] xl:shrink-0 overflow-y-auto border-r border-line bg-surface"
        >
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-ink-dim">
              <Loader2 size={28} className="animate-spin text-accent" />
              <p className="text-xs">Cargando órdenes…</p>
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-danger">
              <AlertCircle size={32} />
              <p className="text-sm text-center">{error}</p>
            </div>
          ) : filters.filteredOrders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center text-ink-dim">
              <CloudDownload size={32} className="text-line" />
              <p className="font-display font-semibold text-lg text-ink">No se encontraron órdenes</p>
              <p className="text-xs leading-relaxed">
                {hasActiveFilters
                  ? 'Ninguna orden coincide con los filtros aplicados.'
                  : 'No hay órdenes pendientes de facturar en esta selección.'}
              </p>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    filters.setSearchTerm('');
                    filters.setSelectedRequisitor('ALL');
                    filters.setUrgencyFilter('ALL');
                  }}
                  className="text-xs underline text-accent"
                >
                  Limpiar filtros
                </Button>
              )}
            </div>
          ) : filters.viewMode === 'all' ? (
            filters.filteredOrders.map(renderOrderRow)
          ) : (
            filters.groupedByRequisitor.map(([requisitorName, groupOrders]) => {
              const isCollapsed = filters.collapsedRequisitores[requisitorName] ?? false;
              const pendingPieces = groupOrders.reduce(
                (sum, o) => sum + o.order_lines.reduce((lineSum, line) => lineSum + line.qty_pending, 0),
                0,
              );
              return (
                <div key={requisitorName}>
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => filters.toggleGroupCollapse(requisitorName)}
                    className="sticky top-0 z-10 w-full min-h-11 flex items-center gap-2 px-4 py-2 text-left bg-surface-2 border-b border-line"
                  >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span className="text-xs font-bold text-ink truncate">{requisitorName}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-dim tabular-nums">
                      {groupOrders.length} órd · {pendingPieces} pzs
                    </span>
                  </button>
                  {!isCollapsed && groupOrders.map(renderOrderRow)}
                </div>
              );
            })
          )}
        </section>

        {/* ── Detalle ── */}
        {isDesktop && (
          <section aria-label="Detalle de la orden" className="flex-1 min-w-0 overflow-y-auto">
            {selectedOrder ? (
              renderOrderDetail(selectedOrder)
            ) : (
              !loading && (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-ink-dim">
                  <MousePointerClick size={28} className="text-line" />
                  <p className="text-sm">Elige una orden de la lista</p>
                </div>
              )
            )}
          </section>
        )}
      </PageFrame>

      {!isDesktop && (
        <Sheet
          open={selectedOrder !== null}
          onOpenChange={(open) => {
            if (!open) onSelectedOrderIdChange(null);
          }}
        >
          <SheetContent side="right" className="p-0 gap-0 w-full data-[side=right]:w-full data-[side=right]:sm:max-w-3xl overflow-y-auto">
            <SheetTitle className="sr-only">Orden {selectedOrder?.name}</SheetTitle>
            <SheetDescription className="sr-only">Líneas y acciones de la orden seleccionada.</SheetDescription>
            {selectedOrder && renderOrderDetail(selectedOrder)}
          </SheetContent>
        </Sheet>
      )}

      {/* ── Modal de Factura / Remisión ── */}
      <InvoiceRequestPanel
        open={invoicePanelOpen}
        onClose={() => setInvoicePanelOpen(false)}
        orders={filters.filteredOrders}
        productionMap={productionMap}
        resolvedLinksMap={resolvedLinksMap}
      />

      <ToolcribPrintModal
        drawing={lineActions.printDrawing}
        catalogViews={catalog.views}
        initialSoNumber={lineActions.printSoNumber}
        initialCantidad={lineActions.printCantidad}
        initialPoNumber={lineActions.printPoNumber}
        onClose={() => {
          lineActions.setPrintDrawing(null);
        }}
        onSuccess={({ soNumber }) => {
          if (lineActions.printDrawing) {
            recordToolcribPrintLogFireAndForget({
              drawingId: lineActions.printDrawing.drawingId,
              partId: lineActions.printDrawing.partId,
              copies: 1,
              orderRef: soNumber,
            });
          }
        }}
      />
    </>
  );
}
