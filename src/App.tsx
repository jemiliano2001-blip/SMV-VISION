/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from "motion/react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import {
  Database,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Maximize2,
  Printer,
  Pencil,
  Trash2,
  Check,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize,
  AlertTriangle,
} from 'lucide-react';
import { Order, type OrderDrawingLink } from './types';
import { describeIsometricView, purchaseRowKey } from './lib/reportViewMeta';
import { checkRevisionDiscrepancy } from './lib/matching';
import { makeOrderDrawingLinkKey, getReportDrawingSnapshot } from './lib/orderDrawingBridge';
import { ToolcribLibraryPanel } from './components/ToolcribLibraryPanel';
import { OdooOrdersPanel } from './components/OdooOrdersPanel';
import { AppShell, type AppView } from './components/shell/AppShell';
import { InicioView } from './components/InicioView';
import { BibliotecaView } from './components/BibliotecaView';
import { ComprasPanel } from './components/ComprasPanel';
import { EntregasSinOCPanel } from './components/EntregasSinOCPanel';
import { CropAdjustModal } from './components/CropAdjustModal';
import { QuickPurchaseModal } from './components/QuickPurchaseModal';
import { ReportRowActions } from './components/ReportRowActions';
import { ToolcribHistoryModal } from './components/ToolcribHistoryModal';
// three.js (~600 KB) solo se necesita cuando el operador abre el visor 3D —
// se carga bajo demanda en lugar de en el bundle inicial (three-vendor chunk).
const StlViewerModal = lazy(() =>
  import('./components/StlViewerModal').then((m) => ({ default: m.StlViewerModal })),
);
import { formatAgeDays, getOrderAgeDays } from './lib/age';
import { useVisionAnalysis } from './hooks/useVisionAnalysis';
import { useToolcribCatalog } from './hooks/useToolcribCatalog';
import { useOrderDrawingBridge } from './hooks/useOrderDrawingBridge';
import type { ToolcribActiveDrawingView } from './types';

/**
 * Celda de cantidad editable (modo edición del reporte). Mantiene un borrador
 * local y confirma en blur/Enter; Esc cancela. Se re-sincroniza si la orden
 * cambia desde fuera (p. ej. "Restaurar todo").
 */
function EditableCantidad({
  order,
  onCommit,
}: {
  order: Order;
  onCommit: (order: Order, value: string) => void;
}) {
  const [draft, setDraft] = useState(order.cantidad);
  useEffect(() => {
    setDraft(order.cantidad);
  }, [order.cantidad]);
  const commit = () => {
    const value = draft.trim();
    if (value && value !== order.cantidad) onCommit(order, value);
    else setDraft(order.cantidad);
  };
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(order.cantidad);
          e.currentTarget.blur();
        }
      }}
      aria-label="Editar cantidad"
      className="w-20 text-center font-mono font-black text-lg text-black bg-white border-2 border-black px-1 py-1.5 outline-none focus:border-[#FF4E00]"
    />
  );
}


export default function App() {
  const [activeView, setActiveView] = useState<AppView>('inicio');
  const [biblioSearchPrefill, setBiblioSearchPrefill] = useState('');
  const [cropAdjustTarget, setCropAdjustTarget] = useState<{
    order: Order;
    resultIndex: number;
  } | null>(null);
  const [quickPurchaseData, setQuickPurchaseData] = useState<{
    soNumber?: string;
    poNumber?: string;
    pieza?: string;
    numeroParte?: string;
    cantidad?: number | string;
    material?: string | null;
    rowKey?: string;
  } | null>(null);
  const [purchaseToast, setPurchaseToast] = useState<string | null>(null);
  const [purchasedKeys, setPurchasedKeys] = useState<Set<string>>(() => new Set());
  const [historyDrawing, setHistoryDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const [stlDrawing, setStlDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const biblioReturnViewRef = useRef<'odoo' | 'reporte'>('odoo');

  const vision = useVisionAnalysis();
  const catalog = useToolcribCatalog();
  const bridge = useOrderDrawingBridge();

  // Navegación
  const navigate = useCallback((view: AppView) => {
    setActiveView(view);
  }, []);

  const handleSendToReport = useCallback(async (link: OrderDrawingLink) => {
    const { errors } = await vision.seedFromBridgeLinks([link]);
    setActiveView('reporte');
    // Auto-auditoría: el operador ya eligió "Reporte" en Órdenes.
    if (errors.length === 0 || getReportDrawingSnapshot(link)) {
      void vision.extractInfo();
    }
  }, [vision]);

  const handleOpenBiblioteca = useCallback((query: string, linkKey: string) => {
    biblioReturnViewRef.current = 'odoo';
    bridge.setPendingKey(linkKey);
    setBiblioSearchPrefill(query);
    setActiveView('biblioteca');
  }, [bridge]);

  const handleVincularFromReport = useCallback((order: Order) => {
    const so = order.orden.split('\n')[0] || 'report';
    const key = makeOrderDrawingLinkKey(`report:${so}`, 0);
    // Asegura un link de sesión para que upsertManual / alias funcionen.
    bridge.resolveAndStore(
      {
        orderId: `report:${so}`,
        lineIndex: 0,
        soNumber: so,
        poNumber: order.poNumber ?? '',
        pieza: order.pieza,
        numeroParte: order.numero_parte ?? '',
        qtyPending: Number.parseFloat(order.cantidad.split('\n')[0]) || 0,
      },
      catalog.views,
      catalog.signalsByDrawingId,
    );
    biblioReturnViewRef.current = 'reporte';
    bridge.setPendingKey(key);
    setBiblioSearchPrefill(order.numero_parte || order.pieza);
    setActiveView('biblioteca');
  }, [bridge, catalog.views, catalog.signalsByDrawingId]);

  const handleUseDrawingForPending = useCallback((view: ToolcribActiveDrawingView) => {
    const key = bridge.pendingKey;
    if (!key) return;
    const updated = bridge.upsertManual(key, view);
    bridge.setPendingKey(null);
    setBiblioSearchPrefill('');
    const returnTo = biblioReturnViewRef.current;
    biblioReturnViewRef.current = 'odoo';
    if (updated && returnTo === 'reporte') {
      void vision.seedFromBridgeLinks([updated]).then(() => {
        setActiveView('reporte');
        void vision.extractInfo();
      });
      return;
    }
    if (updated) {
      setActiveView('odoo');
    }
  }, [bridge, vision]);

  const resolveDrawingView = useCallback((order: Order): ToolcribActiveDrawingView | null => {
    if (!order.matchedDrawingId) return null;
    const fromCatalog = catalog.views.find((v) => v.drawingId === order.matchedDrawingId);
    if (fromCatalog) return fromCatalog;
    return {
      drawingId: order.matchedDrawingId,
      partId: order.matchedPartId ?? '',
      partNumber: order.numero_parte || order.sourcePdfName || order.pieza,
      revision: order.matchedDrawingRevision ?? '',
      pdfUrl: null,
      stlUrl: order.matchedStlUrl ?? null,
      sourcePath: order.sourcePdfPath ?? order.sourcePdfName ?? '',
      customer: 'SUPRAJIT',
      description: order.pieza,
      sourceType: 'storage',
      effectiveFromUTC: null,
    };
  }, [catalog.views]);

  const pendingBibliotecaLink = bridge.pendingKey
    ? bridge.links[bridge.pendingKey] ?? null
    : null;

  useEffect(() => {
    if (!vision.previewOrder) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') vision.setPreviewOrder(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [vision.previewOrder, vision.setPreviewOrder]);

  return (
    <>
      <AppShell
        activeView={activeView}
        onNavigate={navigate}
        version="v3.1.PRO"
      >
        {/* ── Generar Reporte — montado siempre, oculto para preservar PDFs/resultados ── */}
        <div className="h-full" style={{ display: activeView === 'reporte' ? 'block' : 'none' }}>
          <div className="h-full flex flex-col xl:flex-row">

            {/* ── Columna de entrada (CTA siempre visible al pie) ── */}
            <section className="xl:w-[400px] xl:shrink-0 xl:h-full border-b-2 xl:border-b-0 xl:border-r-2 border-line bg-surface flex flex-col">
              <div className="flex-1 overflow-y-auto p-5 space-y-7">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-1">Auditoría de planos</p>
                  <h1 className="font-display font-black text-3xl uppercase italic tracking-[-1px] leading-none">Generar Reporte</h1>
                </div>

                {/* 01 Pedidos */}
                <div className="space-y-3">
                  <StepLabel
                    n="01"
                    label="Órdenes Odoo"
                    done={vision.seededBridgeLinks.length > 0 || Boolean(vision.results)}
                  />
                  <div className="min-h-[150px] border-2 border-line bg-surface-2 flex flex-col items-center justify-center p-6 relative">
                    <div className="text-center space-y-2">
                      <Database className="mx-auto w-10 h-10 text-accent" />
                      <p className="font-display font-black uppercase text-xs tracking-tight text-ink">Conexión a Odoo Activa</p>
                      {vision.seededBridgeLinks.length > 0 ? (
                        <p className="text-[9px] text-accent font-mono uppercase font-black">
                          {vision.seededBridgeLinks.length} línea{vision.seededBridgeLinks.length === 1 ? '' : 's'} desde Órdenes
                          {vision.seededBridgeLinks.some((l) => {
                            const snap = getReportDrawingSnapshot(l);
                            return snap && (
                              snap.partNumber.toLowerCase().includes('.iso') ||
                              snap.sourcePath.toLowerCase().includes('.iso')
                            );
                          })
                            ? ' · cara ISO eDrawings lista'
                            : ''}
                        </p>
                      ) : (
                        <p className="text-[9px] text-ink-dim font-mono uppercase">Las órdenes pendientes se obtendrán automáticamente al ejecutar la auditoría.</p>
                      )}
                    </div>
                  </div>
                  {vision.seedWarning && (
                    <div className="border-2 border-warn bg-warn/10 p-3 flex items-start gap-2">
                      <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
                      <div className="grow min-w-0">
                        <p className="font-mono text-[9px] uppercase tracking-widest text-warn font-black mb-1">Aviso al adjuntar</p>
                        <p className="font-mono text-[10px] text-ink break-words">{vision.seedWarning}</p>
                      </div>
                      <button type="button" onClick={vision.clearSeedWarning} className="text-ink-dim hover:text-ink" title="Cerrar">
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  {vision.seededBridgeLinks.length > 0 && (
                    <div className="border-2 border-accent/40 bg-accent/5 p-3 space-y-2">
                      <p className="font-mono text-[9px] uppercase tracking-widest text-accent font-black">
                        {vision.seededBridgeLinks.length} enviada{vision.seededBridgeLinks.length === 1 ? '' : 's'} desde Órdenes
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {vision.seededBridgeLinks.map((link) => (
                          <button
                            key={link.key}
                            type="button"
                            onClick={() => vision.removeSeededBridgeLink(link.key)}
                            className="inline-flex items-center gap-1 border border-line bg-surface px-2 py-1 font-mono text-[9px] uppercase hover:border-danger hover:text-danger"
                            title="Quitar de la semilla del reporte"
                          >
                            {link.soNumber}
                            {link.numeroParte ? ` · ${link.numeroParte}` : ''}
                            <X size={10} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 02 Biblioteca */}
                <div className="space-y-3">
                  <StepLabel n="02" label="Biblioteca de Planos" />
                  <ToolcribLibraryPanel
                    onAttachDrawing={vision.handleAttachToolcribDrawing}
                    attachedDrawingIds={vision.attachedToolcribDrawingIds}
                  />
                </div>

                {/* 03 Workspace */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <StepLabel n="03" label="Workspace" done={vision.workshopPdfs.length > 0} />
                    <span className="bg-ink text-bg px-2 py-0.5 text-[10px] font-black font-mono">{vision.workshopPdfs.length} PLANOS</span>
                  </div>
                  <div
                    className={`border-2 border-dashed p-2 transition-all ${
                      vision.draggingZone === 'workshop' ? 'border-accent bg-accent/10' : 'border-line bg-surface-2/40'
                    }`}
                    {...vision.buildDropHandlers('workshop', vision.ingestWorkshopFiles)}
                  >
                    {vision.workshopPdfs.length > 0 ? (
                      <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                        {vision.workshopPdfs.map((pdf) => (
                          <div key={pdf.id} className="relative group border border-line bg-surface-2 p-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 overflow-hidden">
                              {vision.workshopLoadingStates[pdf.id] === 'loading' ? (
                                <Loader2 size={12} className="text-accent animate-spin shrink-0" />
                              ) : (
                                <CheckCircle2 size={12} className="text-ok shrink-0" />
                              )}
                              <span className="text-[9px] font-mono truncate uppercase font-bold text-ink">
                                {pdf.relativePath.split('/').pop()}
                              </span>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); vision.removeFile('workshop', pdf.id); }}
                              className="text-ink-dim hover:text-accent transition-colors"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] font-mono text-ink-dim text-center py-3 uppercase tracking-wider">
                        Arrastra planos PDF aquí o úsalos desde la biblioteca
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* CTA fija */}
              <div className="border-t-2 border-line p-4 bg-surface-2">
                <button
                  onClick={vision.extractInfo}
                  disabled={vision.isExtracting}
                  className="w-full bg-accent text-bg font-display font-black py-4 text-lg uppercase tracking-[3px] transition-all shadow-hard hover:shadow-none hover:translate-x-1 hover:translate-y-1 active:scale-[0.98] disabled:bg-surface disabled:text-ink-dim disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  {vision.isExtracting ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Analizando…</>
                  ) : vision.seededBridgeLinks.length > 0 ? (
                    `Auditar ${vision.seededBridgeLinks.length} enviada${vision.seededBridgeLinks.length === 1 ? '' : 's'}`
                  ) : (
                    'Ejecutar Auditoría'
                  )}
                </button>
              </div>
            </section>

            {/* ── Columna de resultados ── */}
            <section className="flex-1 min-w-0 h-full overflow-y-auto bp-grid">
              <div className="p-6 lg:p-8 flex flex-col min-h-full">
                <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 bg-accent" />
                    <h2 className="font-display font-black text-2xl uppercase italic tracking-tight">Audit Dashboard</h2>
                  </div>

                  {vision.results && (
                    <div className="flex gap-2 flex-wrap">
                      {!vision.isExtracting && (
                        <button
                          onClick={() => vision.setEditMode(!vision.editMode)}
                          aria-pressed={vision.editMode}
                          title={vision.editMode ? 'Salir del modo edición (conserva los cambios)' : 'Editar el reporte antes de imprimir: ajustar cantidades y excluir órdenes'}
                          className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest border-2 transition-colors inline-flex items-center gap-1.5 ${
                            vision.editMode
                              ? 'bg-accent text-bg border-accent'
                              : 'bg-surface border-line text-ink hover:border-accent hover:text-accent'
                          }`}
                        >
                          {vision.editMode ? <><Check size={12} /> Listo</> : <><Pencil size={12} /> Editar reporte</>}
                        </button>
                      )}
                      <button
                        onClick={vision.copyResults}
                        className="bg-surface border-2 border-line text-ink px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:border-accent hover:text-accent transition-colors"
                      >
                        {vision.copying ? 'Copiado' : 'Copiar JSON'}
                      </button>
                      <button
                        onClick={vision.downloadCsv}
                        className="bg-surface border-2 border-line text-ink px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:border-accent hover:text-accent transition-colors"
                        title="Descargar dataset completo como CSV (ignora filtros de vista)"
                      >
                        CSV
                      </button>
                      <button
                        onClick={vision.downloadPdf}
                        className="bg-accent text-bg px-6 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-accent/80 transition-colors shadow-hard active:translate-x-0.5 active:translate-y-0.5"
                        title="Exportar PDF del dataset completo (ignora filtros de vista)"
                      >
                        Exportar Reporte (PDF)
                      </button>
                    </div>
                  )}
                </div>

                <AnimatePresence mode="wait">
                  {!vision.results && !vision.isExtracting && !vision.error && (
                    <motion.div
                      key="waiting"
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="grow border-2 border-line border-dashed flex flex-col items-center justify-center text-center p-12 bg-surface/40 corner-ticks"
                    >
                      <div className="relative mb-8">
                        <Maximize2 className="text-line w-28 h-28" />
                        <FileText className="absolute inset-0 m-auto text-ink-dim w-10 h-10" />
                      </div>
                      {vision.seededBridgeLinks.length > 0 ? (
                        <>
                          <h3 className="font-display font-black text-4xl uppercase tracking-tighter text-ink-dim italic mb-3">
                            {vision.seededBridgeLinks.length} lista{vision.seededBridgeLinks.length === 1 ? '' : 's'} desde Órdenes
                          </h3>
                          <p className="text-[11px] font-mono text-ink-dim uppercase tracking-[4px] max-w-lg">
                            Planos adjuntos — pulsa &quot;Auditar {vision.seededBridgeLinks.length} enviada{vision.seededBridgeLinks.length === 1 ? '' : 's'}&quot; o espera si la auditoría ya arrancó sola.
                          </p>
                        </>
                      ) : (
                        <>
                          <h3 className="font-display font-black text-4xl uppercase tracking-tighter text-ink-dim italic mb-3">Esperando Instrucciones</h3>
                          <p className="text-[11px] font-mono text-ink-dim uppercase tracking-[4px]">Presiona &quot;Ejecutar Auditoría&quot; — las órdenes se leen de Odoo automáticamente</p>
                          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full">
                            {[
                              ['01', 'Las órdenes pendientes se leen de Odoo automáticamente.'],
                              ['02', 'Usa el Auto-Matching o la Biblioteca para buscar planos.'],
                              ['03', 'Presiona "Ejecutar" para que Vision AI audite las piezas.'],
                            ].map(([n, text]) => (
                              <div key={n} className="p-4 border-2 border-line bg-surface text-left">
                                <p className="font-display font-black text-[11px] uppercase mb-1 text-accent">Paso {n}</p>
                                <p className="text-[9px] font-mono text-ink-dim leading-tight">{text}</p>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </motion.div>
                  )}

                  {vision.isExtracting && !vision.error && (
                    <motion.div
                      key="extracting"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="grow border-2 border-line bg-surface-2 flex flex-col items-center justify-center text-center p-12 relative overflow-hidden"
                    >
                      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#FF4E00 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>

                      <div className="relative z-10 space-y-8">
                        <div className="relative">
                          <div className="w-36 h-36 border-8 border-line border-t-accent rounded-full animate-spin"></div>
                          <Database className="absolute inset-0 m-auto text-accent w-10 h-10 animate-pulse" />
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-ink font-display font-black text-5xl uppercase tracking-tighter italic">Procesando…</h3>
                          <p className="text-accent font-mono text-sm uppercase tracking-[8px] animate-pulse">{vision.extractingStep}</p>
                        </div>
                        <div className="flex justify-center gap-1 max-w-xs mx-auto flex-wrap">
                          {vision.workshopPdfs.map((pdf) => (
                            <div
                              key={pdf.id}
                              className={`h-2 transition-all duration-500 ${
                                vision.workshopLoadingStates[pdf.id] === 'done' ? 'bg-ok w-8' :
                                vision.workshopLoadingStates[pdf.id] === 'loading' ? 'bg-accent w-4 animate-pulse' : 'bg-line w-2'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {vision.error && (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="grow border-2 border-danger bg-danger/5 p-12 flex flex-col items-center justify-center text-center"
                    >
                      <AlertCircle className="text-danger w-20 h-20 mb-6" />
                      <h3 className="text-ink font-display font-black text-2xl uppercase italic mb-4">Error Crítico Visión AI</h3>
                      <p className="text-ink-dim font-mono text-sm max-w-md mx-auto bg-surface p-4 border-2 border-line">{vision.error}</p>
                    </motion.div>
                  )}

                  {vision.results && !vision.isExtracting && !vision.error && (
                    <motion.div
                      key="results"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="grow flex flex-col"
                    >
                      {/* Barra de filtros (dark). Los filtros NO se aplican a las
                          exportaciones (PDF/CSV) — el reporte final usa siempre el
                          dataset completo. */}
                      <div className="border-2 border-line bg-surface px-4 py-3 flex items-center gap-3 flex-wrap">
                        <div className="grow flex items-center gap-2 border border-line px-2 py-1.5 bg-surface-2 min-w-[180px]">
                          <input
                            type="text"
                            value={vision.resultsFilter}
                            onChange={(e) => vision.setResultsFilter(e.target.value)}
                            placeholder="Filtrar por pieza, parte o SO…"
                            className="grow bg-transparent outline-none text-[11px] font-mono text-ink placeholder:text-ink-dim/70"
                          />
                          {vision.resultsFilter && (
                            <button onClick={() => vision.setResultsFilter('')} className="text-ink-dim hover:text-accent" title="Limpiar filtro">
                              <X size={12} />
                            </button>
                          )}
                        </div>
                        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest cursor-pointer select-none text-ink-dim hover:text-ink">
                          <input type="checkbox" checked={vision.filterUrgentOnly} onChange={(e) => vision.setFilterUrgentOnly(e.target.checked)} className="accent-accent" />
                          Solo URGENTE
                        </label>
                        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest cursor-pointer select-none text-ink-dim hover:text-ink">
                          <input type="checkbox" checked={vision.filterMissingOnly} onChange={(e) => vision.setFilterMissingOnly(e.target.checked)} className="accent-accent" />
                          Sin plano
                        </label>
                        <span className="text-[10px] font-mono text-ink-dim ml-auto">
                          {vision.filteredResults?.length ?? 0} / {vision.results.length}
                          <span className="text-ink-dim/70"> · Vista · PDF/CSV exportan todo</span>
                        </span>
                      </div>

                      {/* Banda de modo edición: ajustar cantidades / excluir órdenes antes de imprimir */}
                      {vision.editMode && (
                        <div className="border-x-2 border-b-2 border-accent bg-accent/10 px-4 py-2.5 flex items-center gap-3 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-black uppercase tracking-widest text-accent">
                            <Pencil size={12} /> Modo edición
                          </span>
                          <span className="font-mono text-[10px] text-ink-dim hidden sm:inline">
                            Ajusta cantidades y excluye órdenes antes de imprimir.
                          </span>
                          {vision.error && (
                            <span className="font-mono text-[9px] uppercase tracking-wider text-warn border border-warn/60 px-1.5 py-0.5">
                              edición local
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-ink-dim ml-auto">
                            {vision.results.length} en reporte{vision.excludedOrders.length > 0 ? ` · ${vision.excludedOrders.length} excluidas` : ''}
                          </span>
                          {(vision.originalResults || vision.excludedOrders.length > 0) && (
                            <button
                              onClick={vision.handleRestoreAll}
                              className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-ink hover:text-accent border-2 border-line hover:border-accent px-2 py-1 transition-colors"
                              title="Revertir cantidades y exclusiones de esta corrida"
                            >
                              <RotateCcw size={11} /> Restaurar todo
                            </button>
                          )}
                        </div>
                      )}

                      {/* Hoja de papel: reporte sobre la mesa oscura */}
                      <div className="overflow-auto border-2 border-line border-t-0 paper shadow-hard">
                        <div className="bg-[#0D2B4D] text-white p-6 border-b-2 border-black/20 flex items-center justify-between">
                          <div>
                            <h2 className="font-display text-3xl font-black uppercase tracking-tighter">REPORTE DE TRABAJO: SUPRAJIT</h2>
                            <p className="text-xs font-mono opacity-60">AUDITORÍA AUTOMATIZADA // SMV VISION</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-black uppercase tracking-widest bg-accent text-bg px-2 inline-block mb-1">PRODUCCIÓN ACTIVA</p>
                            <p className="text-xs font-mono">{new Date().toLocaleDateString()}</p>
                          </div>
                        </div>

                        <table className="w-full text-left border-collapse">
                          <thead className="sticky top-0 z-20">
                            <tr className="bg-[#11161C] text-white">
                              <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest border-r border-white/10 w-[50%]">PIEZA Y VISTA DE PLANO</th>
                              <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest border-r border-white/10 text-center">CANT.</th>
                              <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest border-r border-white/10 text-center">SO (ORDEN)</th>
                              <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest border-r border-white/10 text-center">FECHA</th>
                              <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest text-center w-12"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {(vision.filteredResults ?? vision.results).map((order, idx) => {
                              const rowKey = purchaseRowKey(order);
                              const isPurchased = purchasedKeys.has(rowKey);
                              const viewKind = describeIsometricView(order);
                              const revCheck = order.matchedDrawingRevision
                                ? checkRevisionDiscrepancy(
                                    `${order.pieza} ${order.numero_parte ?? ''}`,
                                    order.matchedDrawingRevision,
                                  )
                                : null;

                              return (
                              <tr key={idx} className="border-b-2 border-gray-200 hover:bg-gray-50 transition-colors group">
                                <td className="px-5 py-4 border-r-2 border-gray-100 flex items-center justify-between gap-4">
                                  <div className="grow">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                      <h4 className="font-display font-black text-xl uppercase tracking-tight text-black">
                                        {order.pieza}
                                      </h4>
                                      {typeof order.matchScore === 'number' && order.matchScore < 90 && (
                                        <span
                                          className="bg-yellow-400 text-black px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-black"
                                          title={`Match con score ${order.matchScore}/100 — revisar a mano para confirmar.`}
                                        >
                                          {order.matchScore}% • REVISAR
                                        </span>
                                      )}
                                      {viewKind === 'ISO eDrawings' && (
                                        <span
                                          className="bg-black text-white px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-black"
                                          title="Cara isométrica desde plano ISO (eDrawings / Tool Crib)"
                                        >
                                          ISO
                                        </span>
                                      )}
                                      {viewKind === 'Recorte CAD' && (
                                        <span
                                          className="bg-zinc-200 text-black px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-black"
                                          title="Recorte del plano CAD 2D"
                                        >
                                          CAD
                                        </span>
                                      )}
                                      {order.isometricSource === 'ai-generated' && (
                                        <span
                                          className="bg-white text-black px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-black"
                                          title="Vista 3D generada por IA a partir del plano 2D. No usar para cotizar dimensiones ni maquinado."
                                        >
                                          IA · NO ACOTAR
                                        </span>
                                      )}
                                      {order.matchSource === 'alias' && (
                                        <span
                                          className="bg-emerald-100 text-emerald-900 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-emerald-700"
                                          title="Plano resuelto por alias aprendido"
                                        >
                                          Alias
                                        </span>
                                      )}
                                      {isPurchased && (
                                        <span
                                          className="bg-accent/15 text-accent px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-accent"
                                          title="Requisición creada en esta sesión"
                                        >
                                          En Compras
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[10px] text-gray-500 font-mono italic">
                                      {order.sourcePdfName || "Sin plano asociado"}
                                    </p>
                                    {revCheck?.hasMismatch && (
                                      <div
                                        className="mt-1.5 inline-flex items-center gap-1.5 bg-amber-50 border border-amber-500 text-amber-900 font-mono text-[9px] font-bold px-2 py-0.5"
                                        title={`Odoo pide Rev "${revCheck.orderRev}" pero el plano es Rev "${revCheck.drawingRev}".`}
                                      >
                                        <AlertTriangle size={11} className="shrink-0" />
                                        <span>Rev {revCheck.orderRev} (plano {revCheck.drawingRev})</span>
                                      </div>
                                    )}

                                    {/* Metadatos técnicos extraídos del cajetín */}
                                    {(order.material || order.dureza || order.tratamiento || order.acabado) && (
                                      <div className="flex items-center gap-1.5 mt-2 flex-wrap font-mono text-[9px]">
                                        {order.material && (
                                          <span className="bg-zinc-100 text-zinc-800 border border-zinc-300 px-1.5 py-0.5 font-bold" title="Material especificado">
                                            {order.material}
                                          </span>
                                        )}
                                        {order.dureza && (
                                          <span className="bg-amber-50 text-amber-900 border border-amber-300 px-1.5 py-0.5 font-bold" title="Dureza especificada">
                                            {order.dureza}
                                          </span>
                                        )}
                                        {order.tratamiento && (
                                          <span className="bg-orange-50 text-orange-900 border border-orange-300 px-1.5 py-0.5 font-bold" title="Tratamiento térmico">
                                            {order.tratamiento}
                                          </span>
                                        )}
                                        {order.acabado && (
                                          <span className="bg-blue-50 text-blue-900 border border-blue-300 px-1.5 py-0.5 font-bold" title="Acabado superficial">
                                            {order.acabado}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex flex-col items-end gap-2 shrink-0">
                                  {order.isometricView && (
                                    <button
                                      type="button"
                                      onClick={() => vision.setPreviewOrder(order)}
                                      disabled={!order.sourceImageDataUrl}
                                      title={order.sourceImageDataUrl ? 'Ver plano completo' : 'Plano completo no disponible'}
                                      className="w-28 h-28 border-2 border-black bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)] relative overflow-hidden flex items-center justify-center p-1 hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] disabled:hover:translate-x-0 disabled:hover:translate-y-0 cursor-zoom-in"
                                    >
                                      <img
                                        src={order.isometricView}
                                        alt="Vista"
                                        className="max-w-full max-h-full object-contain mix-blend-multiply pointer-events-none"
                                      />
                                    </button>
                                  )}
                                    <ReportRowActions
                                      order={order}
                                      isExtracting={vision.isExtracting}
                                      isAiGenerating={vision.isAiIsoGenerating(order)}
                                      onEncuadre={() => {
                                        const resultIndex = vision.results?.indexOf(order) ?? -1;
                                        if (resultIndex >= 0) {
                                          setCropAdjustTarget({ order, resultIndex });
                                        }
                                      }}
                                      onComprar={() => {
                                        setQuickPurchaseData({
                                          soNumber: order.orden.split('\n')[0],
                                          poNumber: order.poNumber,
                                          pieza: order.pieza,
                                          numeroParte: order.numero_parte,
                                          cantidad: order.cantidad.split('\n')[0],
                                          material: order.material,
                                          rowKey,
                                        });
                                      }}
                                      onAiIso={() => void vision.generateAiIsometricForOrder(order)}
                                      onStl={() => {
                                        const view = resolveDrawingView(order);
                                        if (view?.stlUrl) setStlDrawing(view);
                                      }}
                                      onHistorial={() => {
                                        const view = resolveDrawingView(order);
                                        if (view) setHistoryDrawing(view);
                                      }}
                                      onVincular={() => handleVincularFromReport(order)}
                                    />
                                  </div>
                                </td>

                                <td className="px-5 py-4 border-r-2 border-gray-100 text-center align-middle">
                                  {vision.editMode ? (
                                    <EditableCantidad order={order} onCommit={vision.handleEditCantidad} />
                                  ) : (
                                    <span className="font-black text-2xl text-black italic">
                                      {order.cantidad}
                                    </span>
                                  )}
                                </td>

                                <td className="px-5 py-4 border-r-2 border-gray-100 text-center align-middle">
                                  <div className="flex flex-col gap-1 items-center">
                                    {order.orden.split('\n').map((o, i) => (
                                      <span key={i} className="font-mono text-sm font-black bg-black text-white px-2 py-1 block">
                                        {o}
                                      </span>
                                    ))}
                                  </div>
                                </td>

                                <td className="px-5 py-4 border-r-2 border-gray-100 text-center align-middle">
                                  {order.fecha.split('\n').map((f, i) => {
                                    const days = getOrderAgeDays(f);
                                    return (
                                      <div key={i}>
                                        <span className="font-black text-xs uppercase text-black">{f}</span>
                                        {days !== null && (
                                          <span className="block text-[10px] text-gray-400 font-normal normal-case">
                                            {formatAgeDays(days)}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </td>
                                <td className="px-3 py-4 text-center align-middle">
                                  {vision.editMode ? (
                                    <button
                                      onClick={() => vision.handleExcludeOrder(order)}
                                      title="Excluir esta orden del reporte"
                                      aria-label="Excluir orden del reporte"
                                      className="p-2 border-2 border-black bg-white text-black hover:bg-danger hover:text-white hover:border-danger transition-colors"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => vision.downloadSingleOrderPdf(order)}
                                      title="Imprimir esta orden"
                                      className="p-2 border border-black/20 bg-white hover:bg-black hover:text-white hover:border-black transition-colors opacity-40 group-hover:opacity-100"
                                    >
                                      <Printer size={14} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Órdenes excluidas del reporte (soft-delete reversible) */}
                      {vision.excludedOrders.length > 0 && (
                        <div className="mt-4 border-2 border-line bg-surface p-4">
                          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                            <p className="font-mono text-[10px] font-black uppercase tracking-widest text-ink-dim inline-flex items-center gap-1.5">
                              <Trash2 size={12} className="text-danger" /> Excluidas del reporte ({vision.excludedOrders.length})
                            </p>
                            <button
                              onClick={vision.handleRestoreAll}
                              className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-ink hover:text-accent border-2 border-line hover:border-accent px-2 py-1 transition-colors"
                            >
                              <RotateCcw size={11} /> Restaurar todo
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {vision.excludedOrders.map((entry, i) => (
                              <div key={i} className="inline-flex items-center gap-2 bg-surface-2 border-2 border-line px-2 py-1.5">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-bold text-ink truncate max-w-[200px]" title={entry.order.pieza}>
                                    {entry.order.pieza}
                                  </p>
                                  <p className="font-mono text-[9px] text-ink-dim">
                                    SO {entry.order.orden.split('\n')[0] || '—'} · cant. {entry.order.cantidad.split('\n')[0]}
                                  </p>
                                </div>
                                <button
                                  onClick={() => vision.handleRestoreOrder(entry)}
                                  title="Restaurar esta orden al reporte"
                                  aria-label="Restaurar orden"
                                  className="shrink-0 p-1.5 border-2 border-line text-ink-dim hover:text-accent hover:border-accent transition-colors"
                                >
                                  <RotateCcw size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tarjetas de resumen */}
                      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-surface border-2 border-line border-t-4 border-t-accent p-5">
                          <p className="text-[10px] text-ink-dim uppercase font-black tracking-widest">Total Auditado</p>
                          <p className="font-display text-4xl font-black text-ink italic">{vision.analysisSummary?.totalAudited ?? vision.results.length}</p>
                        </div>
                        <div className="bg-surface border-2 border-line border-t-4 border-t-accent p-5">
                          <p className="text-[10px] text-ink-dim uppercase font-black tracking-widest">Match Visual</p>
                          <p className="font-display text-4xl font-black text-accent italic">{vision.auditedCount}</p>
                        </div>
                        <div className="bg-surface border-2 border-line border-t-4 border-t-accent p-5">
                          <p className="text-[10px] text-ink-dim uppercase font-black tracking-widest">Planos Analizados</p>
                          <p className="font-display text-4xl font-black text-ink italic">{vision.analysisSummary?.totalAnalyzed ?? vision.workshopPdfs.length}</p>
                        </div>
                        <div className="bg-surface border-2 border-line p-5 flex items-center justify-center">
                          <div className="text-center">
                            <p className="text-[10px] text-ink-dim uppercase font-black tracking-widest" title="Planos que se analizaron pero no casaron con ninguna orden">Planos sin orden</p>
                            <p className="font-display text-2xl font-black text-accent italic">{vision.analysisSummary?.totalNonMatching ?? 0}</p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] font-mono text-ink-dim">
                        Cargados: {vision.analysisSummary?.totalLoaded ?? vision.workshopPdfs.length} PDFs de taller. Ordenes en reporte: {vision.analysisSummary?.totalOrders ?? vision.results.length}.
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>
          </div>
        </div>

        {/* ── Otras vistas (con transición) ── */}
        <AnimatePresence mode="wait">
          {activeView !== 'reporte' && (
            <motion.div
              key={activeView}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className={
                activeView === 'biblioteca' ? 'h-full overflow-hidden' : 'h-full overflow-y-auto'
              }
            >
              {activeView === 'inicio' && (
                <InicioView
                  onNavigate={navigate}
                  analysisSummary={vision.analysisSummary}
                />
              )}
              {activeView === 'odoo' && (
                <OdooOrdersPanel
                  catalog={catalog}
                  bridge={bridge}
                  onSendToReport={handleSendToReport}
                  onOpenBiblioteca={handleOpenBiblioteca}
                />
              )}
              {activeView === 'biblioteca' && (
                <BibliotecaView
                  searchPrefill={biblioSearchPrefill}
                  pendingLink={pendingBibliotecaLink}
                  onUseDrawingForPending={handleUseDrawingForPending}
                />
              )}
              {activeView === 'compras' && <ComprasPanel />}
              {activeView === 'entregas-sin-oc' && <EntregasSinOCPanel />}
            </motion.div>
          )}
        </AnimatePresence>
      </AppShell>

      {/* Modal de plano completo. Click en backdrop o ESC cierra. */}
      {vision.previewOrder?.sourceImageDataUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 sm:p-8"
          onClick={() => vision.setPreviewOrder(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-surface border-2 border-line shadow-hard-accent max-w-6xl w-full max-h-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-b-2 border-line bg-[#0D2B4D] text-white">
              <div className="min-w-0">
                <p className="text-[10px] font-mono opacity-60 uppercase tracking-widest truncate">
                  {vision.previewOrder.sourcePdfName ?? 'Plano'}
                </p>
                <h3 className="font-display text-lg font-black uppercase tracking-tight truncate">
                  {vision.previewOrder.pieza}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => vision.setPreviewOrder(null)}
                className="shrink-0 p-1.5 border-2 border-white/40 hover:bg-accent hover:border-accent transition-colors"
                title="Cerrar (ESC)"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grow overflow-hidden bg-surface-2 relative flex items-center justify-center">
              <TransformWrapper initialScale={1} minScale={0.5} maxScale={10} centerOnInit>
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <>
                    <div className="absolute bottom-6 right-6 z-10 flex gap-2 bg-surface border-2 border-line p-1 shadow-hard-accent">
                      <button onClick={() => zoomIn()} className="p-2 hover:bg-surface-2 text-ink transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent" title="Acercar">
                        <ZoomIn size={20} />
                      </button>
                      <button onClick={() => zoomOut()} className="p-2 hover:bg-surface-2 text-ink transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent" title="Alejar">
                        <ZoomOut size={20} />
                      </button>
                      <button onClick={() => resetTransform()} className="p-2 hover:bg-surface-2 text-ink transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent" title="Restaurar vista">
                        <Maximize size={20} />
                      </button>
                    </div>
                    <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
                      <img
                        src={vision.previewOrder?.sourceImageDataUrl ?? ''}
                        alt={`Plano ${vision.previewOrder?.pieza ?? ''}`}
                        className="max-w-full max-h-full object-contain cursor-grab active:cursor-grabbing"
                      />
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
            </div>
          </div>
        </div>
      )}

      {/* Modal de edición y ajuste interactivo de encuadre / recorte */}
      <CropAdjustModal
        order={cropAdjustTarget?.order ?? null}
        open={cropAdjustTarget !== null}
        onClose={() => setCropAdjustTarget(null)}
        onSaveCrop={(_order, newBox, newCroppedUrl) => {
          if (!cropAdjustTarget) return;
          vision.handleUpdateOrderCrop(cropAdjustTarget.resultIndex, newBox, newCroppedUrl);
        }}
      />

      {/* Modal de Requisición Rápida de Compras */}
      <QuickPurchaseModal
        open={quickPurchaseData !== null}
        defaultData={quickPurchaseData}
        onClose={() => setQuickPurchaseData(null)}
        onSuccess={() => {
          const key = quickPurchaseData?.rowKey;
          if (key) {
            setPurchasedKeys((prev) => new Set(prev).add(key));
          }
          setPurchaseToast('✓ Requisición guardada con éxito en Compras.');
          setTimeout(() => setPurchaseToast(null), 4000);
        }}
      />

      <ToolcribHistoryModal
        drawing={historyDrawing}
        onClose={() => setHistoryDrawing(null)}
      />

      {stlDrawing !== null && (
        <Suspense fallback={null}>
          <StlViewerModal
            open={Boolean(stlDrawing.stlUrl)}
            stlUrl={stlDrawing.stlUrl ?? null}
            title={`${stlDrawing.partNumber} · Rev ${stlDrawing.revision}`}
            onClose={() => setStlDrawing(null)}
          />
        </Suspense>
      )}

      {/* Toast de confirmación de compra */}
      {purchaseToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0D2B4D] text-white border-2 border-accent shadow-hard px-4 py-2.5 font-mono text-xs flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <span className="text-accent font-bold">✓</span>
          <span>{purchaseToast}</span>
          <button
            type="button"
            className="ml-2 underline text-accent hover:text-white"
            onClick={() => {
              setPurchaseToast(null);
              setActiveView('compras');
            }}
          >
            Ir a Compras
          </button>
        </div>
      )}
    </>
  );
}

/** Etiqueta de paso del flujo de Reporte (01/02/03), con check cuando está cumplido. */
function StepLabel({ n, label, done = false }: { n: string; label: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`font-mono text-[11px] font-bold w-7 h-7 grid place-items-center border-2 ${done ? 'border-ok text-ok' : 'border-line text-ink-dim'}`}>
        {done ? '✓' : n}
      </span>
      <span className="font-display font-black text-[13px] uppercase tracking-wider text-ink">{label}</span>
    </div>
  );
}
