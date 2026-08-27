import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2,
  CloudDownload,
  RefreshCw,
  AlertCircle,
  FileDown,
  Mail,
  User,
  Users,
  Search,
  ChevronDown,
  ChevronRight,
  List,
  X,
  Printer,
  Building2,
  AlertTriangle,
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
import { useOdooLineActions } from '../hooks/useOdooLineActions';
import { useBatchPrintOts } from '../hooks/useBatchPrintOts';
import { useOdooOrdersFilters } from '../hooks/useOdooOrdersFilters';
import { OrderCard } from './odoo-orders/OrderCard';
import { formatRelativeTime } from '../lib/age';
import { log } from '../lib/log';
import { exportDeliverySlip, exportOdooOrdersReportPdf as exportPdf } from '../lib/deliverySlipGenerator';

export interface OdooOrdersPanelProps {
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

  // Compañía (partner) — vacío hasta elegir; no carga todas las órdenes de golpe.
  const [selectedPartnerKey, setSelectedPartnerKey] = useState<string | null>(null);

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

  const filters = useOdooOrdersFilters({ orders });

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
      filters.setSearchTerm('');
      filters.setSelectedRequisitor('ALL');
      batchPrint.clearSelection();
      void fetchOrders(partnerKey);
    },
    [fetchOrders, filters, batchPrint],
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

  const renderOrderCard = (order: OdooOrderView) => (
    <OrderCard
      key={order.id}
      order={order}
      productionMap={productionMap}
      bridge={bridge}
      selectedLines={batchPrint.selectedLines}
      lineBusyKey={lineActions.lineBusyKey}
      sendingKey={lineActions.sendingKey}
      onToggleSelectLine={batchPrint.toggleSelectLine}
      onToggleSelectAllInOrder={batchPrint.toggleSelectAllInOrder}
      onPrintLine={lineActions.handlePrintLinePlano}
      onSendLineToReport={lineActions.handleSendLineToReport}
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
                  ? 'border-danger/50 bg-danger/10 text-danger'
                  : 'border-line text-ink-dim'
              }`}
              title={meta.status === 'error' ? meta.errorMessage : undefined}
            >
              {meta.status === 'error'
                ? `FALLO SYNC · ${meta.lastSuccessfulSyncAt ? `ÚLTIMO OK ${formatRelativeTime(meta.lastSuccessfulSyncAt)}` : formatRelativeTime(meta.lastSyncAt)}`
                : `SYNC · ${formatRelativeTime(meta.lastSyncAt)} · ${meta.ordersProcessed} ÓRDENES`}
            </div>
          )}
          {batchPrint.selectedLines.size > 0 && (
            <Button
              variant="ghost"
              onClick={() => void batchPrint.handleBatchPrintOts()}
              disabled={batchPrint.batchPrinting}
              className="flex items-center gap-2 px-4 py-2 border-2 border-ok bg-ok text-bg hover:bg-ok/80 transition-colors disabled:opacity-50 text-[11px] font-black uppercase tracking-widest shadow-hard hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 h-auto rounded-none"
              title="Combinar y abrir en un solo PDF todas las OTs seleccionadas"
            >
              {batchPrint.batchPrinting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Printer size={14} />
              )}
              {batchPrint.batchPrinting ? 'Imprimiendo…' : `Imprimir Lote (${batchPrint.selectedLines.size} OTs)`}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setInvoicePanelOpen(true)}
            disabled={loading || filters.filteredOrders.length === 0}
            className="flex items-center gap-2 px-4 py-2 border-2 border-accent bg-accent text-bg hover:bg-accent/80 transition-colors disabled:opacity-30 text-[11px] font-black uppercase tracking-widest shadow-hard hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 h-auto rounded-none"
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

      {/* ── Banner de Error en Sincronización (No Destructivo) ── */}
      {meta?.status === 'error' && (
        <div className="bg-danger/10 border-b-2 border-danger px-6 py-3 flex items-center justify-between text-danger font-mono text-xs flex-wrap gap-2 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0 text-danger" />
            <span>
              <strong>Aviso de Sincronización:</strong> {meta.errorMessage || 'Error de conexión con Odoo.'}
              {meta.lastSuccessfulSyncAt && (
                <span className="opacity-80 ml-1">
                  (Mostrando catálogo del último sync exitoso {formatRelativeTime(meta.lastSuccessfulSyncAt)})
                </span>
              )}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRefresh()}
            disabled={syncingOdoo}
            className="border-danger text-danger hover:bg-danger hover:text-bg h-7 text-[10px] font-mono font-bold uppercase tracking-wider"
          >
            Reintentar Sync
          </Button>
        </div>
      )}

      {/* ── Banner de Progreso Batch Print ── */}
      {batchPrint.batchPrintStatus && (
        <div className="bg-accent/15 border-b-2 border-accent px-6 py-2 flex items-center justify-between text-ink font-mono text-xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-accent" />
            <span className="font-bold">{batchPrint.batchPrintStatus}</span>
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
              onClick={() => filters.setViewMode('all')}
              className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors ${
                filters.viewMode === 'all'
                  ? 'bg-[#0D2B4D] text-white shadow-sm'
                  : 'text-ink-dim hover:text-ink hover:bg-surface-2'
              }`}
            >
              <List size={14} />
              <span>Todas las Órdenes</span>
              <span className="ml-1 px-1.5 py-0.2 font-mono text-[9px] bg-accent text-bg font-bold">
                {filters.filteredOrders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => filters.setViewMode('by_requisitor')}
              className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors ${
                filters.viewMode === 'by_requisitor'
                  ? 'bg-[#0D2B4D] text-white shadow-sm'
                  : 'text-ink-dim hover:text-ink hover:bg-surface-2'
              }`}
            >
              <Users size={14} />
              <span>Por Requisitor</span>
              <span className="ml-1 px-1.5 py-0.2 font-mono text-[9px] bg-accent text-bg font-bold">
                {filters.uniqueRequisitores.length}
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
                value={filters.selectedRequisitor}
                onChange={(e) => filters.setSelectedRequisitor(e.target.value)}
                className="bg-transparent font-mono text-xs text-ink font-bold focus:outline-none uppercase cursor-pointer"
              >
                <option value="ALL">TODOS ({filters.searchMatchedOrders.length})</option>
                {filters.uniqueRequisitores.map((req) => {
                  const count = filters.searchMatchedOrders.filter(
                    (o) => (o.requisitor || 'Sin Requisitor') === req,
                  ).length;
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
                value={filters.searchTerm}
                onChange={(e) => filters.setSearchTerm(e.target.value)}
                className="bg-surface border-2 border-line pl-8 pr-8 py-1 font-mono text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent w-64 uppercase"
              />
              {filters.searchTerm && (
                <button
                  type="button"
                  onClick={() => filters.setSearchTerm('')}
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
        {lineActions.lineActionError && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
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
        ) : filters.filteredOrders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-ink-dim space-y-4 border-2 border-dashed border-line bg-surface-2/30 p-12 text-center max-w-2xl mx-auto">
            <CloudDownload size={48} className="text-line" />
            <p className="font-display font-black text-2xl uppercase italic">No se encontraron órdenes</p>
            <p className="font-mono text-xs uppercase tracking-widest">
              {filters.searchTerm || filters.selectedRequisitor !== 'ALL'
                ? 'Ninguna orden coincide con los filtros de búsqueda aplicados.'
                : 'Todas las órdenes de esta compañía están facturadas o no hay datos sincronizados.'}
            </p>
            {(filters.searchTerm || filters.selectedRequisitor !== 'ALL') && (
              <Button
                variant="ghost"
                onClick={() => {
                  filters.setSearchTerm('');
                  filters.setSelectedRequisitor('ALL');
                }}
                className="font-mono text-xs underline text-accent uppercase"
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        ) : filters.viewMode === 'all' ? (
          /* ── MODO 1: Vista de Lista Plana (Todas las órdenes) ── */
          <div className="space-y-6 max-w-6xl mx-auto">
            {filters.filteredOrders.map((order) => renderOrderCard(order))}
          </div>
        ) : (
          /* ── MODO 2: Vista Agrupada por Requisitor / Ingeniero ── */
          <div className="space-y-8 max-w-6xl mx-auto">
            {filters.groupedByRequisitor.map(([requisitorName, groupOrders]) => {
              const isCollapsed = filters.collapsedRequisitores[requisitorName] ?? false;

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
                    onClick={() => filters.toggleGroupCollapse(requisitorName)}
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
        orders={filters.filteredOrders}
        productionMap={productionMap}
      />

      <ToolcribPrintModal
        drawing={lineActions.printDrawing}
        initialSoNumber={lineActions.printSoNumber}
        initialCantidad={lineActions.printCantidad}
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
    </div>
  );
}
