/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from "motion/react";
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
  RotateCcw,
  Check,
} from 'lucide-react';
import {
  Order,
  WorkOrder,
} from './types';
import { ToolcribLibraryPanel } from './components/ToolcribLibraryPanel';
import { WorkOrdersPanel } from './components/WorkOrdersPanel';
import { OdooOrdersPanel } from './components/OdooOrdersPanel';
import { AppShell, type AppView } from './components/shell/AppShell';
import { InicioView, type AlertSeverity } from './components/InicioView';
import { BibliotecaView } from './components/BibliotecaView';
import { useDashboardSummary } from './lib/useDashboardSummary';
import { buildDedupeKey } from './lib/workOrders/dedupe';
import { formatAgeDays, getOrderAgeDays } from './lib/age';
import { useVisionAnalysis } from './hooks/useVisionAnalysis';

/**
 * Llave de dedup de una orden del REPORTE (mismo formato que el upsert de
 * Control). Permite mapear una fila del reporte a su `WorkOrder` en Firestore.
 */
function dedupeKeyOfReportOrder(order: Order): string {
  return buildDedupeKey({
    soNumber: order.orden,
    poNumber: order.poNumber ?? '',
    numeroParte: order.numero_parte ?? '',
    pieza: order.pieza,
  });
}

/**
 * Asigna una key de React estable y ÚNICA a cada elemento de una lista usando
 * la llave de dedup como base. Si una misma SO trae la misma parte en varias
 * líneas, las llaves de dedup colisionan; el sufijo de ocurrencia (`::2`, …)
 * desambigua sin depender de un id de línea de Odoo (que el sync no persiste).
 */
function withRowKeys<T>(items: T[], keyOf: (item: T) => string): Array<{ item: T; rowKey: string }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { item, rowKey: n === 1 ? base : `${base}::${n}` };
  });
}

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
  const [controlAlert, setControlAlert] = useState<AlertSeverity | null>(null);
  const { summary, refresh } = useDashboardSummary();

  // Mapa dedupeKey -> WorkOrder (de Control) para enlazar cada fila del reporte
  // con su documento en Firestore y poder sincronizar ediciones/exclusiones.
  const workOrderByKey = useMemo(() => {
    const map = new Map<string, WorkOrder>();
    for (const wo of summary.orders) {
      const key = buildDedupeKey({
        soNumber: wo.soNumber,
        poNumber: wo.poNumber,
        numeroParte: wo.numeroParte,
        pieza: wo.pieza,
      });
      if (!map.has(key)) map.set(key, wo);
    }
    return map;
  }, [summary.orders]);

  const findWorkOrderId = useCallback(
    (order: Order): string | null => workOrderByKey.get(dedupeKeyOfReportOrder(order))?.id ?? null,
    [workOrderByKey],
  );

  const vision = useVisionAnalysis({ findWorkOrderId, onDataChanged: refresh });

  // Navegación: al ir a Control sin una alerta específica, limpia el filtro.
  const navigate = useCallback((view: AppView) => {
    if (view !== 'control') setControlAlert(null);
    setActiveView(view);
  }, []);

  // Desde "atención inmediata" de Inicio: salta a Control con el filtro puesto.
  const handleFocusAlert = useCallback((sev: AlertSeverity) => {
    setControlAlert(sev);
    setActiveView('control');
  }, []);

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
        counts={summary.counts}
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
                  <StepLabel n="01" label="Órdenes Odoo" done={true} />
                  <div className="min-h-[150px] border-2 border-line bg-surface-2 flex flex-col items-center justify-center p-6 relative">
                    <div className="text-center space-y-2">
                      <Database className="mx-auto w-10 h-10 text-accent" />
                      <p className="font-display font-black uppercase text-xs tracking-tight text-ink">Conexión a Odoo Activa</p>
                      <p className="text-[9px] text-ink-dim font-mono uppercase">Las órdenes pendientes se obtendrán automáticamente al ejecutar la auditoría.</p>
                    </div>
                  </div>
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
                        title="Descargar resultados como CSV (Excel)"
                      >
                        CSV
                      </button>
                      <button
                        onClick={vision.downloadPdf}
                        className="bg-accent text-bg px-6 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-accent/80 transition-colors shadow-hard active:translate-x-0.5 active:translate-y-0.5"
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
                      <h3 className="font-display font-black text-4xl uppercase tracking-tighter text-ink-dim italic mb-3">Esperando Instrucciones</h3>
                      <p className="text-[11px] font-mono text-ink-dim uppercase tracking-[4px]">Carga el reporte de pedidos y selecciona planos para iniciar</p>
                      <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full">
                        {[
                          ['01', 'Carga el PDF de órdenes generado por Google Sheets.'],
                          ['02', 'Usa el Auto-Matching o la Biblioteca para buscar planos.'],
                          ['03', 'Presiona "Ejecutar" para que Vision AI audite las piezas.'],
                        ].map(([n, text]) => (
                          <div key={n} className="p-4 border-2 border-line bg-surface text-left">
                            <p className="font-display font-black text-[11px] uppercase mb-1 text-accent">Paso {n}</p>
                            <p className="text-[9px] font-mono text-ink-dim leading-tight">{text}</p>
                          </div>
                        ))}
                      </div>
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
                          {summary.status === 'error' && (
                            <span className="font-mono text-[9px] uppercase tracking-wider text-warn border border-warn/60 px-1.5 py-0.5">
                              edición local · sin sincronizar
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
                            {withRowKeys(vision.filteredResults ?? vision.results, dedupeKeyOfReportOrder).map(({ item: order, rowKey }) => (
                              <tr key={rowKey} className="border-b-2 border-gray-200 hover:bg-gray-50 transition-colors group">
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
                                    </div>
                                    <p className="text-[10px] text-gray-500 font-mono italic">
                                      {order.sourcePdfName || "Sin plano asociado"}
                                    </p>
                                  </div>

                                  {order.isometricView && (
                                    <button
                                      type="button"
                                      onClick={() => vision.setPreviewOrder(order)}
                                      disabled={!order.sourceImageDataUrl}
                                      title={order.sourceImageDataUrl ? 'Ver plano completo' : 'Plano completo no disponible'}
                                      className="w-28 h-28 border-2 border-black bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)] shrink-0 relative overflow-hidden flex items-center justify-center p-1 hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] disabled:hover:translate-x-0 disabled:hover:translate-y-0 cursor-zoom-in"
                                    >
                                      <img
                                        src={order.isometricView}
                                        alt="Vista"
                                        className="max-w-full max-h-full object-contain mix-blend-multiply pointer-events-none"
                                      />
                                    </button>
                                  )}
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
                            ))}
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
                            {withRowKeys(vision.excludedOrders, (e) => dedupeKeyOfReportOrder(e.order)).map(({ item: entry, rowKey }) => (
                              <div key={rowKey} className="inline-flex items-center gap-2 bg-surface-2 border-2 border-line px-2 py-1.5">
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
                            <p className="text-[10px] text-ink-dim uppercase font-black tracking-widest">No Coincidentes</p>
                            <p className="font-display text-2xl font-black text-accent italic">{vision.analysisSummary?.totalNonMatching ?? 0}</p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] font-mono text-ink-dim">
                        Cargados: {vision.analysisSummary?.totalLoaded ?? vision.workshopPdfs.length} PDFs de taller. Ordenes en reporte: {vision.analysisSummary?.totalOrders ?? vision.results.length}.
                      </div>
                      {vision.metricsComparison && (
                        <div className="mt-4 bg-surface-2 text-ink border-2 border-line p-4">
                          <div className="flex items-center justify-between gap-4 flex-wrap">
                            <p className="text-[10px] font-black uppercase tracking-widest">Métricas de rendimiento</p>
                            <p className="text-xs font-mono text-ink-dim">
                              Total actual: {vision.metricsComparison.latest.totalMs.toFixed(0)}ms
                            </p>
                          </div>
                          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-[10px] font-mono text-ink-dim">
                            <p>Raster: {vision.metricsComparison.latest.pdfRasterMs.toFixed(0)}ms</p>
                            <p>AI órdenes: {vision.metricsComparison.latest.aiOrderMs.toFixed(0)}ms</p>
                            <p>AI planos: {vision.metricsComparison.latest.aiBlueprintMs.toFixed(0)}ms</p>
                            <p>Merge: {vision.metricsComparison.latest.mergeMs.toFixed(0)}ms</p>
                            <p className={vision.metricsComparison.totalImprovementPct >= 0 ? 'text-ok' : 'text-danger'}>
                              Delta baseline: {vision.metricsComparison.totalImprovementPct.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      )}
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
              className="h-full overflow-y-auto"
            >
              {activeView === 'inicio' && (
                <InicioView
                  summary={summary}
                  onNavigate={navigate}
                  onFocusAlert={handleFocusAlert}
                  analysisSummary={vision.analysisSummary}
                />
              )}
              {activeView === 'control' && (
                <WorkOrdersPanel initialAlertFilter={controlAlert} onDataChanged={refresh} />
              )}
              {activeView === 'odoo' && <OdooOrdersPanel />}
              {activeView === 'biblioteca' && <BibliotecaView />}
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
            <div className="grow overflow-auto bg-[#F4F4F4] p-4 flex items-center justify-center">
              <img
                src={vision.previewOrder.sourceImageDataUrl}
                alt={`Plano ${vision.previewOrder.pieza}`}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          </div>
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
