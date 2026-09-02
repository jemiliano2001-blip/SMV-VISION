/**
 * src/components/ReporteView.tsx
 *
 * Vista principal de "Generar Reporte" y Dashboard de Auditoría de Planos.
 * Permite orquestar la extracción de órdenes de Odoo, adjuntar planos del Toolcrib,
 * cargar archivos al workspace, ejecutar la auditoría de visión con Gemini,
 * ajustar encuadres/cantidades en vivo y exportar el reporte final (PDF/CSV/JSON).
 */

import { useCallback, useEffect, useState, useMemo, memo, type ReactElement } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
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
  Eye,
  Box,
  LayoutGrid,
  FileQuestion,
} from 'lucide-react';
import type { Order, ToolcribActiveDrawingView } from '../types';
import type { VisionAnalysisHook } from '../hooks/useVisionAnalysis';
import type { UseToolcribCatalogResult } from '../hooks/useToolcribCatalog';
import { ToolcribLibraryPanel } from './ToolcribLibraryPanel';
import { ReportRowActions } from './ReportRowActions';
import { describeIsometricView, purchaseRowKey } from '../lib/reportViewMeta';
import { checkRevisionDiscrepancy } from '../lib/matching';
import { getReportDrawingSnapshot } from '../lib/orderDrawingBridge';
import { formatAgeDays, getOrderAgeDays } from '../lib/age';

/**
 * Celda de cantidad editable (modo edición del reporte). Mantiene un borrador
 * local y confirma en blur/Enter; Esc cancela. Se re-sincroniza si la orden
 * cambia desde fuera (p. ej. "Restaurar todo").
 */
export function EditableCantidad({
  order,
  onCommit,
  variant = 'dashboard',
}: {
  order: Order;
  onCommit: (order: Order, value: string) => void;
  variant?: 'dashboard' | 'print';
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
      className={
        variant === 'dashboard'
          ? 'w-20 text-center font-mono font-black text-lg text-ink bg-surface-2 border-2 border-line px-1 py-1 outline-none focus:border-accent'
          : 'w-20 text-center font-mono font-black text-lg text-black bg-white border-2 border-black px-1 py-1.5 outline-none focus:border-[#FF4E00]'
      }
    />
  );
}

interface ReportTableRowProps {
  order: Order;
  isPurchased: boolean;
  editMode: boolean;
  isExtracting: boolean;
  isAiGenerating: boolean;
  variant?: 'dashboard' | 'print';
  isSelected?: boolean;
  onToggleSelect?: (order: Order) => void;
  onDownloadTraveler?: (order: Order) => void;
  onEditCantidad: (order: Order, newValue: string) => void;
  onExcludeOrder: (order: Order) => void;
  onDownloadSinglePdf: (order: Order) => void;
  onPreviewOrder: (order: Order) => void;
  onEncuadre: (order: Order) => void;
  onQuickPurchase: (data: {
    soNumber?: string;
    poNumber?: string;
    pieza?: string;
    numeroParte?: string;
    cantidad?: number | string;
    material?: string | null;
    rowKey?: string;
  }) => void;
  onAiIso: (order: Order) => void;
  onViewStl: (view: ToolcribActiveDrawingView) => void;
  onViewHistory: (view: ToolcribActiveDrawingView) => void;
  onVincular: (order: Order) => void;
  resolveDrawingView: (order: Order) => ToolcribActiveDrawingView | null;
}

export const ReportTableRow = memo(function ReportTableRow({
  order,
  isPurchased,
  editMode,
  isExtracting,
  isAiGenerating,
  variant = 'dashboard',
  isSelected = false,
  onToggleSelect,
  onDownloadTraveler,
  onEditCantidad,
  onExcludeOrder,
  onDownloadSinglePdf,
  onPreviewOrder,
  onEncuadre,
  onQuickPurchase,
  onAiIso,
  onViewStl,
  onViewHistory,
  onVincular,
  resolveDrawingView,
}: ReportTableRowProps) {
  const rowKey = purchaseRowKey(order);
  const viewKind = describeIsometricView(order);
  const revCheck = order.matchedDrawingRevision
    ? checkRevisionDiscrepancy(
        `${order.pieza} ${order.numero_parte ?? ''}`,
        order.matchedDrawingRevision,
      )
    : null;
  const drawingView = resolveDrawingView(order);
  const cleanFileName = order.sourcePdfName
    ? order.sourcePdfName.split(/[\\/]/).pop()
    : null;

  if (variant === 'print') {
    return (
      <tr className="border-b-2 border-gray-200 hover:bg-gray-50 transition-colors group">
        {/* Col 0: Checkbox de Selección (Modo Imprimir) */}
        <td className="px-2 py-4 border-r-2 border-gray-100 text-center align-middle w-8 print:hidden">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect?.(order)}
            className="w-3.5 h-3.5 cursor-pointer accent-black"
            aria-label={`Seleccionar ${order.pieza}`}
          />
        </td>
        {/* Col 1: Pieza y especificaciones (Modo Imprimir) */}
        <td className="px-5 py-4 border-r-2 border-gray-100 text-left align-middle">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-display font-black text-lg uppercase tracking-tight text-black">
                {order.pieza}
              </h4>
              {order.numero_parte && (
                <span className="font-mono text-[10px] font-bold text-black bg-zinc-100 border border-zinc-300 px-1.5 py-0.5">
                  {order.numero_parte}
                </span>
              )}
              {typeof order.matchScore === 'number' && order.matchScore < 90 && (
                <span
                  className="bg-yellow-400 text-black px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-black"
                  title={`Match con score ${order.matchScore}/100 — revisar a mano.`}
                >
                  {order.matchScore}% • REVISAR
                </span>
              )}
              {isPurchased && (
                <span className="bg-accent/15 text-accent px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-accent">
                  En Compras
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {cleanFileName ? (
                <span
                  className="text-[10px] text-gray-600 font-mono inline-flex items-center gap-1 cursor-help"
                  title={order.sourcePdfName || order.sourcePdfPath || ''}
                >
                  <FileText size={10} className="text-gray-400 shrink-0" />
                  <span className="truncate max-w-[280px]">{cleanFileName}</span>
                </span>
              ) : (
                <span className="text-[10px] text-gray-400 font-mono italic">
                  Sin plano asociado
                </span>
              )}

              {revCheck?.hasMismatch && (
                <div
                  className="inline-flex items-center gap-1 bg-amber-50 border border-amber-500 text-amber-900 font-mono text-[9px] font-bold px-1.5 py-0.5"
                  title={`Odoo pide Rev "${revCheck.orderRev}" pero el plano es Rev "${revCheck.drawingRev}".`}
                >
                  <AlertTriangle size={11} className="shrink-0" />
                  <span>
                    Rev {revCheck.orderRev} (plano {revCheck.drawingRev})
                  </span>
                </div>
              )}
            </div>

            {/* Metadatos técnicos extraídos del cajetín */}
            {(order.material || order.dureza || order.acabado) && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap font-mono text-[9px]">
                {order.material && (
                  <span
                    className="bg-zinc-100 text-zinc-800 border border-zinc-300 px-1.5 py-0.5 font-bold"
                    title="Material especificado"
                  >
                    MAT: {order.material}
                  </span>
                )}
                {order.dureza && (
                  <span
                    className="bg-amber-50 text-amber-900 border border-amber-300 px-1.5 py-0.5 font-bold"
                    title="Dureza especificada"
                  >
                    DUR: {order.dureza}
                  </span>
                )}
                {order.acabado && (
                  <span
                    className="bg-blue-50 text-blue-900 border border-blue-300 px-1.5 py-0.5 font-bold"
                    title="Acabado superficial"
                  >
                    ACAB: {order.acabado}
                  </span>
                )}
              </div>
            )}
          </div>
        </td>

        {/* Col 2: Vista 3D / Isométrica (Modo Imprimir) */}
        <td className="px-4 py-4 border-r-2 border-gray-100 text-center align-middle w-40">
          {order.isometricView ? (
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => onPreviewOrder(order)}
                disabled={!order.sourceImageDataUrl}
                title="Ver plano completo"
                className="w-20 h-20 border-2 border-black bg-white shadow-[2px_2px_0px_rgba(0,0,0,1)] relative overflow-hidden flex items-center justify-center p-1 cursor-zoom-in"
              >
                <img
                  src={order.isometricView}
                  alt="Vista"
                  className="max-w-full max-h-full object-contain mix-blend-multiply pointer-events-none"
                />
              </button>
              <div className="flex items-center gap-1">
                {viewKind === 'ISO eDrawings' && (
                  <span className="bg-black text-white px-1.5 py-0.2 text-[8px] font-black uppercase font-mono">
                    ISO
                  </span>
                )}
                {viewKind === 'Recorte CAD' && (
                  <span className="bg-zinc-200 text-black px-1.5 py-0.2 text-[8px] font-black uppercase font-mono">
                    CAD
                  </span>
                )}
                {order.isometricSource === 'ai-generated' && (
                  <span className="bg-white text-black px-1.5 py-0.2 text-[8px] font-black uppercase border border-black font-mono">
                    IA
                  </span>
                )}
              </div>
            </div>
          ) : (
            <span className="text-[10px] text-gray-400 font-mono italic">Sin plano</span>
          )}
        </td>

        {/* Col 3: Cantidad */}
        <td className="px-5 py-4 border-r-2 border-gray-100 text-center align-middle w-24">
          {editMode ? (
            <EditableCantidad order={order} onCommit={onEditCantidad} variant="print" />
          ) : (
            <span className="font-black text-2xl text-black italic font-display">
              {order.cantidad}
            </span>
          )}
        </td>

        {/* Col 4: SO */}
        <td className="px-5 py-4 border-r-2 border-gray-100 text-center align-middle w-32">
          <div className="flex flex-col gap-1 items-center">
            {order.orden.split('\n').map((o, i) => (
              <span
                key={i}
                className="font-mono text-sm font-black bg-black text-white px-2 py-1 block"
              >
                {o}
              </span>
            ))}
            {order.poNumber && (
              <span className="text-[10px] font-mono text-gray-600">
                {order.poNumber}
              </span>
            )}
          </div>
        </td>

        {/* Col 5: Fecha */}
        <td className="px-5 py-4 border-r-2 border-gray-100 text-center align-middle w-28">
          {order.fecha.split('\n').map((f, i) => {
            const days = getOrderAgeDays(f);
            return (
              <div key={i}>
                <span className="font-black text-xs uppercase text-black font-mono">
                  {f}
                </span>
                {days !== null && (
                  <span className="block text-[10px] text-gray-400 font-normal font-mono normal-case">
                    {formatAgeDays(days)}
                  </span>
                )}
              </div>
            );
          })}
        </td>

        {/* Col 6: Acciones */}
        <td className="px-3 py-4 text-center align-middle w-24">
          <div className="flex items-center justify-center gap-1">
            {editMode ? (
              <button
                onClick={() => onExcludeOrder(order)}
                title="Excluir esta orden del reporte"
                aria-label="Excluir orden del reporte"
                className="p-2 border-2 border-black bg-white text-black hover:bg-danger hover:text-white hover:border-danger transition-colors"
              >
                <Trash2 size={14} />
              </button>
            ) : (
              <>
                <button
                  onClick={() => onDownloadSinglePdf(order)}
                  title="Imprimir esta orden"
                  className="p-2 border border-black/20 bg-white hover:bg-black hover:text-white hover:border-black transition-colors"
                >
                  <Printer size={14} />
                </button>
                <ReportRowActions
                  order={order}
                  isExtracting={isExtracting}
                  isAiGenerating={isAiGenerating}
                  onEncuadre={() => onEncuadre(order)}
                  onComprar={() => {
                    onQuickPurchase({
                      soNumber: order.orden.split('\n')[0],
                      poNumber: order.poNumber,
                      pieza: order.pieza,
                      numeroParte: order.numero_parte,
                      cantidad: order.cantidad.split('\n')[0],
                      material: order.material,
                      rowKey,
                    });
                  }}
                  onAiIso={() => onAiIso(order)}
                  onStl={() => {
                    if (drawingView?.stlUrl) onViewStl(drawingView);
                  }}
                  onHistorial={() => {
                    if (drawingView) onViewHistory(drawingView);
                  }}
                  onVincular={() => onVincular(order)}
                  onTraveler={() => onDownloadTraveler?.(order)}
                />
              </>
            )}
          </div>
        </td>
      </tr>
    );
  }

  // Dashboard Dark Pro Variant (Default)
  return (
    <tr className={`border-b border-line hover:bg-surface-2/70 transition-colors group ${isSelected ? 'bg-accent/10' : ''}`}>
      {/* Col 0: Checkbox de Selección */}
      <td className="px-3 py-4 border-r border-line text-center align-middle w-10">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect?.(order)}
          className="w-4 h-4 cursor-pointer accent-accent"
          aria-label={`Seleccionar ${order.pieza}`}
        />
      </td>
      {/* Col 1: Pieza & Especificaciones */}
      <td className="px-5 py-4 border-r border-line text-left align-middle">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-display font-black text-base uppercase tracking-tight text-ink leading-tight">
              {order.pieza}
            </h4>
            {order.numero_parte && (
              <span className="font-mono text-[10px] font-bold text-accent bg-accent/10 border border-accent/30 px-1.5 py-0.5">
                {order.numero_parte}
              </span>
            )}
            {typeof order.matchScore === 'number' && order.matchScore < 90 && (
              <span
                className="bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider font-mono"
                title={`Match con score ${order.matchScore}/100 — confirmar visualmente.`}
              >
                {order.matchScore}% • REVISAR
              </span>
            )}
            {isPurchased && (
              <span
                className="bg-accent/15 text-accent px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border border-accent font-mono"
                title="Requisición creada en esta sesión"
              >
                En Compras
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {cleanFileName ? (
              <span
                className="text-[10px] text-ink-dim font-mono inline-flex items-center gap-1 hover:text-ink cursor-help bg-surface-2 px-1.5 py-0.5 border border-line"
                title={order.sourcePdfName || order.sourcePdfPath || ''}
              >
                <FileText size={10} className="shrink-0 text-accent" />
                <span className="truncate max-w-[280px]">{cleanFileName}</span>
              </span>
            ) : (
              <span className="text-[10px] text-ink-dim/50 font-mono italic">
                Sin plano asociado
              </span>
            )}

            {revCheck?.hasMismatch && (
              <div
                className="inline-flex items-center gap-1 bg-warn/15 border border-warn text-warn font-mono text-[9px] font-bold px-1.5 py-0.5"
                title={`Odoo pide Rev "${revCheck.orderRev}" pero el plano es Rev "${revCheck.drawingRev}".`}
              >
                <AlertTriangle size={11} className="shrink-0" />
                <span>
                  Rev {revCheck.orderRev} (plano {revCheck.drawingRev})
                </span>
              </div>
            )}
          </div>

          {/* Metadatos técnicos del cajetín */}
          {(order.material || order.dureza || order.acabado) && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap font-mono text-[9px]">
              {order.material && (
                <span
                  className="bg-surface-2 text-ink border border-line px-1.5 py-0.5 font-bold"
                  title="Material especificado"
                >
                  MAT: {order.material}
                </span>
              )}
              {order.dureza && (
                <span
                  className="bg-warn/10 text-warn border border-warn/30 px-1.5 py-0.5 font-bold"
                  title="Dureza especificada"
                >
                  DUR: {order.dureza}
                </span>
              )}
              {order.acabado && (
                <span
                  className="bg-blue-500/10 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 font-bold"
                  title="Acabado superficial"
                >
                  ACAB: {order.acabado}
                </span>
              )}
            </div>
          )}
        </div>
      </td>

      {/* Col 2: Vista 3D / Isométrica dedicada */}
      <td className="px-4 py-4 border-r border-line text-center align-middle w-44">
        <div className="flex flex-col items-center justify-center gap-1.5">
          {order.isometricView ? (
            <>
              <button
                type="button"
                onClick={() => onPreviewOrder(order)}
                disabled={!order.sourceImageDataUrl}
                title={
                  order.sourceImageDataUrl
                    ? 'Clic para ver plano completo ampliado'
                    : 'Plano completo no disponible'
                }
                className="w-20 h-20 border-2 border-line bg-surface-2 relative overflow-hidden flex items-center justify-center p-1 hover:border-accent hover:shadow-hard-accent transition-all cursor-zoom-in group/img"
              >
                <img
                  src={order.isometricView}
                  alt="Vista"
                  className="max-w-full max-h-full object-contain pointer-events-none group-hover/img:scale-105 transition-transform"
                />
                <div className="absolute inset-0 bg-accent/0 group-hover/img:bg-accent/10 transition-colors flex items-center justify-center opacity-0 group-hover/img:opacity-100">
                  <Eye size={16} className="text-accent" />
                </div>
              </button>
              <div className="flex items-center gap-1 flex-wrap justify-center">
                {viewKind === 'ISO eDrawings' && (
                  <span className="bg-ok/20 text-ok border border-ok/40 px-1.5 py-0.2 text-[8px] font-black uppercase tracking-wider font-mono">
                    ISO 3D
                  </span>
                )}
                {viewKind === 'Recorte CAD' && (
                  <span className="bg-surface-2 text-ink-dim border border-line px-1.5 py-0.2 text-[8px] font-black uppercase tracking-wider font-mono">
                    CAD 2D
                  </span>
                )}
                {order.isometricSource === 'ai-generated' && (
                  <span className="bg-accent/20 text-accent border border-accent/40 px-1.5 py-0.2 text-[8px] font-black uppercase tracking-wider font-mono">
                    IA 3D
                  </span>
                )}
                {drawingView?.stlUrl && (
                  <button
                    type="button"
                    onClick={() => onViewStl(drawingView)}
                    className="inline-flex items-center gap-0.5 bg-accent/15 text-accent border border-accent px-1.5 py-0.2 text-[8px] font-black uppercase tracking-wider font-mono hover:bg-accent hover:text-bg transition-colors"
                    title="Abrir visor 3D interactivo (STL)"
                  >
                    <Box size={9} /> STL
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-2">
              <div className="w-16 h-16 border-2 border-dashed border-line bg-surface flex items-center justify-center text-ink-dim/40">
                <FileQuestion size={20} />
              </div>
              <button
                type="button"
                onClick={() => onVincular(order)}
                className="text-[9px] font-mono font-bold uppercase text-accent hover:underline inline-flex items-center gap-0.5"
              >
                + Vincular
              </button>
            </div>
          )}
        </div>
      </td>

      {/* Col 3: Cantidad */}
      <td className="px-4 py-4 border-r border-line text-center align-middle w-24">
        {editMode ? (
          <EditableCantidad order={order} onCommit={onEditCantidad} variant="dashboard" />
        ) : (
          <span className="font-display font-black text-2xl text-ink italic">
            {order.cantidad}
          </span>
        )}
      </td>

      {/* Col 4: SO (Orden) */}
      <td className="px-4 py-4 border-r border-line text-center align-middle w-32">
        <div className="flex flex-col gap-1 items-center">
          {order.orden.split('\n').map((o, i) => (
            <span
              key={i}
              className="font-mono text-xs font-black bg-surface-2 text-ink border border-line px-2 py-0.5 block"
            >
              {o}
            </span>
          ))}
          {order.poNumber && (
            <span className="text-[9px] font-mono text-ink-dim tracking-tight">
              {order.poNumber}
            </span>
          )}
        </div>
      </td>

      {/* Col 5: Fecha */}
      <td className="px-4 py-4 border-r border-line text-center align-middle w-28">
        {order.fecha.split('\n').map((f, i) => {
          const days = getOrderAgeDays(f);
          return (
            <div key={i}>
              <span className="font-mono font-bold text-xs uppercase text-ink">
                {f}
              </span>
              {days !== null && (
                <span className="block text-[10px] text-ink-dim font-mono normal-case">
                  {formatAgeDays(days)}
                </span>
              )}
            </div>
          );
        })}
      </td>

      {/* Col 6: Acciones */}
      <td className="px-3 py-4 text-center align-middle w-24">
        <div className="flex items-center justify-center gap-1.5">
          {editMode ? (
            <button
              onClick={() => onExcludeOrder(order)}
              title="Excluir esta orden del reporte"
              aria-label="Excluir orden del reporte"
              className="p-2 border border-danger bg-danger/10 text-danger hover:bg-danger hover:text-white transition-colors"
            >
              <Trash2 size={14} />
            </button>
          ) : (
            <>
              <button
                onClick={() => onDownloadSinglePdf(order)}
                title="Imprimir esta orden"
                className="p-1.5 border border-line bg-surface text-ink-dim hover:text-ink hover:border-accent transition-colors"
              >
                <Printer size={13} />
              </button>
              <ReportRowActions
                order={order}
                isExtracting={isExtracting}
                isAiGenerating={isAiGenerating}
                onEncuadre={() => onEncuadre(order)}
                onComprar={() => {
                  onQuickPurchase({
                    soNumber: order.orden.split('\n')[0],
                    poNumber: order.poNumber,
                    pieza: order.pieza,
                    numeroParte: order.numero_parte,
                    cantidad: order.cantidad.split('\n')[0],
                    material: order.material,
                    rowKey,
                  });
                }}
                onAiIso={() => onAiIso(order)}
                onStl={() => {
                  if (drawingView?.stlUrl) onViewStl(drawingView);
                }}
                onHistorial={() => {
                  if (drawingView) onViewHistory(drawingView);
                }}
                onVincular={() => onVincular(order)}
                onTraveler={() => onDownloadTraveler?.(order)}
              />
            </>
          )}
        </div>
      </td>
    </tr>
  );
});

/** Etiqueta de paso del flujo de Reporte (01/02/03), con check cuando está cumplido. */
export function StepLabel({ n, label, done = false }: { n: string; label: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`font-mono text-[11px] font-bold w-7 h-7 grid place-items-center border-2 ${
          done ? 'border-ok text-ok' : 'border-line text-ink-dim'
        }`}
      >
        {done ? '✓' : n}
      </span>
      <span className="font-display font-black text-[13px] uppercase tracking-wider text-ink">
        {label}
      </span>
    </div>
  );
}

export interface ReporteViewProps {
  vision: VisionAnalysisHook;
  catalog: UseToolcribCatalogResult;
  purchasedKeys: Set<string>;
  onEncuadre: (order: Order) => void;
  onQuickPurchase: (data: {
    soNumber?: string;
    poNumber?: string;
    pieza?: string;
    numeroParte?: string;
    cantidad?: number | string;
    material?: string | null;
    rowKey?: string;
  }) => void;
  onViewStl: (view: ToolcribActiveDrawingView) => void;
  onViewHistory: (view: ToolcribActiveDrawingView) => void;
  onVincular: (order: Order) => void;
}

export function ReporteView({
  vision,
  catalog,
  purchasedKeys,
  onEncuadre,
  onQuickPurchase,
  onViewStl,
  onViewHistory,
  onVincular,
}: ReporteViewProps): ReactElement {
  const [tableViewMode, setTableViewMode] = useState<'dashboard' | 'print'>('dashboard');
  const [activeFilterTab, setActiveFilterTab] = useState<'all' | 'ready' | 'missing' | 'mismatch'>('all');
  const [selectedOrderKeys, setSelectedOrderKeys] = useState<Set<string>>(new Set());

  // Base común de KPIs y pestañas: el buscador y el toggle "solo faltantes" ya
  // recortaron `filteredResults`. Contar los KPIs sobre `results` (todo) haría que
  // la tarjeta dijera "8 sin plano" mientras la pestaña muestra 3 — en un tablero
  // de auditoría, números que no cuadran queman la confianza en el reporte entero.
  const auditBase = useMemo(
    () => vision.filteredResults ?? vision.results ?? [],
    [vision.filteredResults, vision.results],
  );

  const hasDrawing = useCallback(
    (o: Order): boolean => Boolean(o.sourcePdfName || o.matchedDrawingId || o.isometricView),
    [],
  );

  const hasRevMismatch = useCallback((o: Order): boolean => {
    if (!o.matchedDrawingRevision) return false;
    return Boolean(
      checkRevisionDiscrepancy(
        `${o.pieza} ${o.numero_parte ?? ''}`,
        o.matchedDrawingRevision,
      )?.hasMismatch,
    );
  }, []);

  const kpis = useMemo(() => {
    const total = auditBase.length;
    const withDrawing = auditBase.filter(hasDrawing).length;
    const missingDrawing = total - withDrawing;
    const coveragePct = total > 0 ? Math.round((withDrawing / total) * 100) : 0;
    const revMismatches = auditBase.filter(hasRevMismatch).length;

    return { total, withDrawing, missingDrawing, coveragePct, revMismatches };
  }, [auditBase, hasDrawing, hasRevMismatch]);

  const displayedOrders = useMemo(() => {
    if (activeFilterTab === 'ready') return auditBase.filter(hasDrawing);
    if (activeFilterTab === 'missing') return auditBase.filter((o) => !hasDrawing(o));
    if (activeFilterTab === 'mismatch') return auditBase.filter(hasRevMismatch);
    return auditBase;
  }, [auditBase, activeFilterTab, hasDrawing, hasRevMismatch]);

  const toggleOrderSelection = useCallback((order: Order) => {
    const key = purchaseRowKey(order);
    setSelectedOrderKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectedOrders = useMemo(() => {
    if (!vision.results) return [];
    return vision.results.filter((o) => selectedOrderKeys.has(purchaseRowKey(o)));
  }, [vision.results, selectedOrderKeys]);

  const allVisibleSelected = useMemo(() => {
    if (displayedOrders.length === 0) return false;
    return displayedOrders.every((o) => selectedOrderKeys.has(purchaseRowKey(o)));
  }, [displayedOrders, selectedOrderKeys]);

  const toggleSelectAllVisible = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedOrderKeys((prev) => {
        const next = new Set(prev);
        displayedOrders.forEach((o) => next.delete(purchaseRowKey(o)));
        return next;
      });
    } else {
      setSelectedOrderKeys((prev) => {
        const next = new Set(prev);
        displayedOrders.forEach((o) => next.add(purchaseRowKey(o)));
        return next;
      });
    }
  }, [allVisibleSelected, displayedOrders]);

  const clearSelection = useCallback(() => {
    setSelectedOrderKeys(new Set());
  }, []);

  useEffect(() => {
    setSelectedOrderKeys(new Set());
  }, [vision.results]);

  const resolveDrawingView = useCallback(
    (order: Order): ToolcribActiveDrawingView | null => {
      if (!order.matchedDrawingId) return null;
      const fromCatalog = catalog.views.find((v) => v.drawingId === order.matchedDrawingId);
      if (fromCatalog) {
        // El catálogo puede no traer stlUrl (p. ej. tras "Restaurar Sesión" sin
        // recargar el catálogo) aunque el snapshot de la orden sí lo tenga —
        // sin este fallback "Ver 3D" se ve habilitado y el clic no hace nada.
        return fromCatalog.stlUrl ? fromCatalog : { ...fromCatalog, stlUrl: order.matchedStlUrl ?? null };
      }
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
    },
    [catalog.views],
  );

  return (
    <div className="h-full flex flex-col xl:flex-row">
      {/* ── Columna de entrada (CTA siempre visible al pie) ── */}
      <section className="xl:w-[400px] xl:shrink-0 xl:h-full border-b-2 xl:border-b-0 xl:border-r-2 border-line bg-surface flex flex-col">
        <div className="flex-1 overflow-y-auto p-5 space-y-7">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-1">
              Auditoría de planos
            </p>
            <h1 className="font-display font-black text-3xl uppercase italic tracking-[-1px] leading-none">
              Generar Reporte
            </h1>
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
                <p className="font-display font-black uppercase text-xs tracking-tight text-ink">
                  Conexión a Odoo Activa
                </p>
                {vision.seededBridgeLinks.length > 0 ? (
                  <p className="text-[9px] text-accent font-mono uppercase font-black">
                    {vision.seededBridgeLinks.length} línea
                    {vision.seededBridgeLinks.length === 1 ? '' : 's'} desde Órdenes
                    {vision.seededBridgeLinks.some((l) => {
                      const snap = getReportDrawingSnapshot(l);
                      return (
                        snap &&
                        (snap.partNumber.toLowerCase().includes('.iso') ||
                          snap.sourcePath.toLowerCase().includes('.iso'))
                      );
                    })
                      ? ' · cara ISO eDrawings lista'
                      : ''}
                  </p>
                ) : (
                  <p className="text-[9px] text-ink-dim font-mono uppercase">
                    Las órdenes pendientes se obtendrán automáticamente al ejecutar la auditoría.
                  </p>
                )}
              </div>
            </div>
            {vision.seedWarning && (
              <div className="border-2 border-warn bg-warn/10 p-3 flex items-start gap-2">
                <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
                <div className="grow min-w-0">
                  <p className="font-mono text-[9px] uppercase tracking-widest text-warn font-black mb-1">
                    Aviso al adjuntar
                  </p>
                  <p className="font-mono text-[10px] text-ink break-words">{vision.seedWarning}</p>
                </div>
                <button
                  type="button"
                  onClick={vision.clearSeedWarning}
                  className="text-ink-dim hover:text-ink"
                  title="Cerrar"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {vision.seededBridgeLinks.length > 0 && (
              <div className="border-2 border-accent/40 bg-accent/5 p-3 space-y-2">
                <p className="font-mono text-[9px] uppercase tracking-widest text-accent font-black">
                  {vision.seededBridgeLinks.length} enviada
                  {vision.seededBridgeLinks.length === 1 ? '' : 's'} desde Órdenes
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
              onCatalogChanged={() => void catalog.reload()}
            />
          </div>

          {/* 03 Workspace */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <StepLabel n="03" label="Workspace" done={vision.workshopPdfs.length > 0} />
              <span className="bg-ink text-bg px-2 py-0.5 text-[10px] font-black font-mono">
                {vision.workshopPdfs.length} PLANOS
              </span>
            </div>
            <div
              className={`border-2 border-dashed p-2 transition-all ${
                vision.draggingZone === 'workshop'
                  ? 'border-accent bg-accent/10'
                  : 'border-line bg-surface-2/40'
              }`}
              {...vision.buildDropHandlers('workshop', vision.ingestWorkshopFiles)}
            >
              {vision.workshopPdfs.length > 0 ? (
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {vision.workshopPdfs.map((pdf) => (
                    <div
                      key={pdf.id}
                      className="relative group border border-line bg-surface-2 p-2 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        {vision.workshopLoadingStates[pdf.id] === 'loading' ? (
                          <Loader2 size={12} className="text-accent animate-spin shrink-0" />
                        ) : vision.workshopLoadingStates[pdf.id] === 'error' ? (
                          <AlertCircle size={12} className="text-danger shrink-0" />
                        ) : (
                          <CheckCircle2 size={12} className="text-ok shrink-0" />
                        )}
                        <span className="text-[9px] font-mono truncate uppercase font-bold text-ink">
                          {pdf.relativePath.split('/').pop()}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          vision.removeFile('workshop', pdf.id);
                        }}
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
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> Analizando…
              </>
            ) : vision.seededBridgeLinks.length > 0 ? (
              `Auditar ${vision.seededBridgeLinks.length} enviada${
                vision.seededBridgeLinks.length === 1 ? '' : 's'
              }`
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
              <h2 className="font-display font-black text-2xl uppercase italic tracking-tight">
                Audit Dashboard
              </h2>
            </div>

            {vision.results && (
              <div className="flex gap-2 flex-wrap">
                {!vision.isExtracting && (
                  <button
                    onClick={() => vision.setEditMode(!vision.editMode)}
                    aria-pressed={vision.editMode}
                    title={
                      vision.editMode
                        ? 'Salir del modo edición (conserva los cambios)'
                        : 'Editar el reporte antes de imprimir: ajustar cantidades y excluir órdenes'
                    }
                    className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest border-2 transition-colors inline-flex items-center gap-1.5 ${
                      vision.editMode
                        ? 'bg-accent text-bg border-accent'
                        : 'bg-surface border-line text-ink hover:border-accent hover:text-accent'
                    }`}
                  >
                    {vision.editMode ? (
                      <>
                        <Check size={12} /> Listo
                      </>
                    ) : (
                      <>
                        <Pencil size={12} /> Editar reporte
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={vision.copyResults}
                  disabled={vision.isExtracting}
                  className="bg-surface border-2 border-line text-ink px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  {vision.copying ? 'Copiado' : 'Copiar JSON'}
                </button>
                <button
                  onClick={() => vision.downloadCsv(selectedOrders.length > 0 ? selectedOrders : (displayedOrders.length < (vision.results?.length ?? 0) ? displayedOrders : undefined))}
                  disabled={vision.isExtracting}
                  className="bg-surface border-2 border-line text-ink px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  title={
                    selectedOrders.length > 0
                      ? `Descargar CSV de las ${selectedOrders.length} órdenes seleccionadas`
                      : displayedOrders.length < (vision.results?.length ?? 0)
                      ? `Descargar CSV de las ${displayedOrders.length} órdenes en vista`
                      : 'Descargar CSV del dataset completo'
                  }
                >
                  CSV {selectedOrders.length > 0 ? `(${selectedOrders.length})` : ''}
                </button>
                <button
                  onClick={() => vision.downloadTravelersPdf(selectedOrders.length > 0 ? selectedOrders : displayedOrders)}
                  disabled={vision.isExtracting}
                  className="bg-surface border-2 border-line text-ink px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5"
                  title="Generar 1 Hoja de Maquinado / Setup Sheet por pieza para taller"
                >
                  <Printer size={13} className="text-accent" />
                  Travelers {selectedOrders.length > 0 ? `(${selectedOrders.length})` : `(${displayedOrders.length})`}
                </button>
                <button
                  onClick={() => vision.downloadPdf(selectedOrders.length > 0 ? selectedOrders : (displayedOrders.length < (vision.results?.length ?? 0) ? displayedOrders : undefined))}
                  disabled={vision.isExtracting}
                  className="bg-accent text-bg px-5 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-accent/80 transition-colors shadow-hard active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none flex items-center gap-1.5"
                  title={
                    selectedOrders.length > 0
                      ? `Exportar PDF con las ${selectedOrders.length} órdenes seleccionadas`
                      : displayedOrders.length < (vision.results?.length ?? 0)
                      ? `Exportar PDF con las ${displayedOrders.length} órdenes en vista`
                      : 'Exportar PDF de todas las órdenes del reporte'
                  }
                >
                  <FileText size={13} />
                  {selectedOrders.length > 0
                    ? `Exportar Selección (${selectedOrders.length} PDF)`
                    : displayedOrders.length < (vision.results?.length ?? 0)
                    ? `Exportar en Vista (${displayedOrders.length} PDF)`
                    : 'Exportar Reporte (PDF)'}
                </button>
              </div>
            )}
          </div>

          {/* Banner de Recuperación de Sesión IndexedDB */}
          {vision.savedSession && !vision.results && !vision.isExtracting && (
            <div className="mb-6 p-4 bg-warn/10 border-2 border-warn shadow-hard-accent flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <RotateCcw className="text-warn shrink-0" size={20} />
                <div>
                  <h4 className="font-display font-black text-sm uppercase tracking-wide text-ink">
                    Sesión de auditoría previa recuperable
                  </h4>
                  <p className="text-xs text-ink-dim font-mono">
                    Hay {vision.savedSession.results.length} órdenes procesadas en caché ({new Date(vision.savedSession.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={vision.restoreSavedSession}
                  className="px-3.5 py-1.5 bg-accent text-bg text-xs font-mono font-bold uppercase tracking-wider border-2 border-accent hover:bg-accent/80 transition-colors shadow-hard active:translate-x-0.5 active:translate-y-0.5"
                >
                  Restaurar Sesión
                </button>
                <button
                  type="button"
                  onClick={vision.dismissSavedSession}
                  className="px-3 py-1.5 bg-surface text-ink text-xs font-mono font-bold uppercase tracking-wider border-2 border-line hover:bg-surface-2 transition-colors"
                >
                  Descartar
                </button>
              </div>
            </div>
          )}

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
                      {vision.seededBridgeLinks.length} lista
                      {vision.seededBridgeLinks.length === 1 ? '' : 's'} desde Órdenes
                    </h3>
                    <p className="text-[11px] font-mono text-ink-dim uppercase tracking-[4px] max-w-lg">
                      Planos adjuntos — pulsa &quot;Auditar {vision.seededBridgeLinks.length} enviada
                      {vision.seededBridgeLinks.length === 1 ? '' : 's'}&quot; o espera si la auditoría ya arrancó sola.
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="font-display font-black text-4xl uppercase tracking-tighter text-ink-dim italic mb-3">
                      Esperando Instrucciones
                    </h3>
                    <p className="text-[11px] font-mono text-ink-dim uppercase tracking-[4px]">
                      Presiona &quot;Ejecutar Auditoría&quot; — las órdenes se leen de Odoo automáticamente
                    </p>
                    <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full">
                      {[
                        ['01', 'Las órdenes pendientes se leen de Odoo automáticamente.'],
                        ['02', 'Usa el Auto-Matching o la Biblioteca para buscar planos.'],
                        ['03', 'Presiona "Ejecutar" para que Vision AI audite las piezas.'],
                      ].map(([n, text]) => (
                        <div key={n} className="p-4 border-2 border-line bg-surface text-left">
                          <p className="font-display font-black text-[11px] uppercase mb-1 text-accent">
                            Paso {n}
                          </p>
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
                <div
                  className="absolute inset-0 opacity-20 pointer-events-none"
                  style={{
                    backgroundImage: 'radial-gradient(#FF4E00 1px, transparent 0)',
                    backgroundSize: '24px 24px',
                  }}
                />

                <div className="relative z-10 space-y-8">
                  <div className="relative">
                    <div className="w-36 h-36 border-8 border-line border-t-accent rounded-full animate-spin" />
                    <Database className="absolute inset-0 m-auto text-accent w-10 h-10 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-ink font-display font-black text-5xl uppercase tracking-tighter italic">
                      Procesando…
                    </h3>
                    <p className="text-accent font-mono text-sm uppercase tracking-[8px] animate-pulse">
                      {vision.extractingStep}
                    </p>
                  </div>
                  <div className="flex justify-center gap-1 max-w-xs mx-auto flex-wrap">
                    {vision.workshopPdfs.map((pdf) => (
                      <div
                        key={pdf.id}
                        className={`h-2 transition-all duration-500 ${
                          vision.workshopLoadingStates[pdf.id] === 'done'
                            ? 'bg-ok w-8'
                            : vision.workshopLoadingStates[pdf.id] === 'error'
                            ? 'bg-danger w-8'
                            : vision.workshopLoadingStates[pdf.id] === 'loading'
                            ? 'bg-accent w-4 animate-pulse'
                            : 'bg-line w-2'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {vision.error && (!vision.results || vision.isExtracting) && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grow border-2 border-danger bg-danger/5 p-12 flex flex-col items-center justify-center text-center relative"
              >
                <button
                  type="button"
                  onClick={() => vision.setError(null)}
                  className="absolute top-4 right-4 text-ink-dim hover:text-ink p-1"
                  title="Cerrar"
                  aria-label="Cerrar error"
                >
                  <X size={18} />
                </button>
                <AlertCircle className="text-danger w-20 h-20 mb-6" />
                <h3 className="text-ink font-display font-black text-2xl uppercase italic mb-4">
                  Error Crítico Visión AI
                </h3>
                <p className="text-ink-dim font-mono text-sm max-w-md mx-auto bg-surface p-4 border-2 border-line">
                  {vision.error}
                </p>
              </motion.div>
            )}

            {vision.results && !vision.isExtracting && (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grow flex flex-col"
              >
                {vision.error && (
                  <div className="mb-3 flex items-start gap-2 border-2 border-danger bg-danger/10 px-3 py-2 text-sm text-danger">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span className="grow font-mono text-xs">{vision.error}</span>
                    <button
                      type="button"
                      onClick={() => vision.setError(null)}
                      className="text-danger/70 hover:text-danger shrink-0"
                      title="Cerrar"
                      aria-label="Cerrar error"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {/* Radar de Auditoría - KPIs superiores */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                  <div className="bg-surface border-2 border-line p-3.5 flex items-center justify-between shadow-hard">
                    <div>
                      <p className="text-[10px] font-mono text-ink-dim uppercase font-bold tracking-wider">
                        Órdenes Totales
                      </p>
                      <p className="font-display text-2xl font-black text-ink italic">
                        {kpis.total}
                      </p>
                    </div>
                    <div className="w-9 h-9 border border-line bg-surface-2 grid place-items-center text-ink-dim">
                      <FileText size={18} />
                    </div>
                  </div>

                  <div className="bg-surface border-2 border-line p-3.5 flex items-center justify-between shadow-hard">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-[10px] font-mono text-ink-dim uppercase font-bold tracking-wider">
                          Planos Vinculados
                        </p>
                        <span className="text-[9px] font-mono font-bold text-ok bg-ok/15 border border-ok/30 px-1 py-0.2">
                          {kpis.coveragePct}%
                        </span>
                      </div>
                      <p className="font-display text-2xl font-black text-ok italic">
                        {kpis.withDrawing}
                      </p>
                    </div>
                    <div className="w-9 h-9 border border-ok/30 bg-ok/10 grid place-items-center text-ok">
                      <CheckCircle2 size={18} />
                    </div>
                  </div>

                  <div
                    onClick={() => setActiveFilterTab(activeFilterTab === 'missing' ? 'all' : 'missing')}
                    className={`bg-surface border-2 p-3.5 flex items-center justify-between cursor-pointer transition-all shadow-hard ${
                      activeFilterTab === 'missing'
                        ? 'border-accent bg-accent/10'
                        : 'border-line hover:border-accent/60'
                    }`}
                    title="Clic para filtrar órdenes sin plano"
                  >
                    <div>
                      <p className="text-[10px] font-mono text-ink-dim uppercase font-bold tracking-wider">
                        Sin Plano
                      </p>
                      <p className={`font-display text-2xl font-black italic ${kpis.missingDrawing > 0 ? 'text-accent' : 'text-ink-dim'}`}>
                        {kpis.missingDrawing}
                      </p>
                    </div>
                    <div className={`w-9 h-9 border grid place-items-center ${
                      kpis.missingDrawing > 0 ? 'border-accent/40 bg-accent/15 text-accent' : 'border-line bg-surface-2 text-ink-dim'
                    }`}>
                      <FileQuestion size={18} />
                    </div>
                  </div>

                  <div
                    onClick={() => setActiveFilterTab(activeFilterTab === 'mismatch' ? 'all' : 'mismatch')}
                    className={`bg-surface border-2 p-3.5 flex items-center justify-between cursor-pointer transition-all shadow-hard ${
                      activeFilterTab === 'mismatch'
                        ? 'border-warn bg-warn/10'
                        : 'border-line hover:border-warn/60'
                    }`}
                    title="Clic para filtrar órdenes con discrepancia de revisión"
                  >
                    <div>
                      <p className="text-[10px] font-mono text-ink-dim uppercase font-bold tracking-wider">
                        Discrepancia Rev
                      </p>
                      <p className={`font-display text-2xl font-black italic ${kpis.revMismatches > 0 ? 'text-warn' : 'text-ink-dim'}`}>
                        {kpis.revMismatches}
                      </p>
                    </div>
                    <div className={`w-9 h-9 border grid place-items-center ${
                      kpis.revMismatches > 0 ? 'border-warn/40 bg-warn/15 text-warn' : 'border-line bg-surface-2 text-ink-dim'
                    }`}>
                      <AlertTriangle size={18} />
                    </div>
                  </div>
                </div>

                {/* Barra de controles: Búsqueda, Filtros Rápidos y Selector de Vista */}
                <div className="border-2 border-line bg-surface px-4 py-3 flex items-center gap-3 flex-wrap">
                  {/* Buscador de texto */}
                  <div className="grow flex items-center gap-2 border border-line px-2.5 py-1.5 bg-surface-2 min-w-[200px]">
                    <input
                      type="text"
                      value={vision.resultsFilter}
                      onChange={(e) => vision.setResultsFilter(e.target.value)}
                      placeholder="Filtrar por pieza, parte o SO…"
                      className="grow bg-transparent outline-none text-[11px] font-mono text-ink placeholder:text-ink-dim/70"
                    />
                    {vision.resultsFilter && (
                      <button
                        onClick={() => vision.setResultsFilter('')}
                        className="text-ink-dim hover:text-accent"
                        title="Limpiar filtro"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* Filtros rápidos por píldora */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setActiveFilterTab('all')}
                      className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase transition-all border ${
                        activeFilterTab === 'all'
                          ? 'bg-ink text-bg border-ink'
                          : 'bg-surface-2 text-ink-dim border-line hover:text-ink hover:border-accent'
                      }`}
                    >
                      Todos ({kpis.total})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilterTab('ready')}
                      className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase transition-all border ${
                        activeFilterTab === 'ready'
                          ? 'bg-ok text-bg border-ok'
                          : 'bg-surface-2 text-ink-dim border-line hover:text-ok hover:border-ok'
                      }`}
                    >
                      Con Plano ({kpis.withDrawing})
                    </button>
                    {kpis.missingDrawing > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveFilterTab('missing')}
                        className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase transition-all border ${
                          activeFilterTab === 'missing'
                            ? 'bg-accent text-bg border-accent'
                            : 'bg-surface-2 text-accent border-accent/40 hover:bg-accent/10'
                        }`}
                      >
                        Sin Plano ({kpis.missingDrawing})
                      </button>
                    )}
                    {kpis.revMismatches > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveFilterTab('mismatch')}
                        className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase transition-all border ${
                          activeFilterTab === 'mismatch'
                            ? 'bg-warn text-bg border-warn'
                            : 'bg-surface-2 text-warn border-warn/40 hover:bg-warn/10'
                        }`}
                      >
                        Rev Alert ({kpis.revMismatches})
                      </button>
                    )}
                  </div>

                  {/* Selector de modo de tabla: Dashboard Dark Pro vs Hoja Impresa */}
                  <div className="inline-flex border border-line bg-surface-2 p-0.5 ml-auto">
                    <button
                      type="button"
                      onClick={() => setTableViewMode('dashboard')}
                      className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase transition-colors inline-flex items-center gap-1.5 ${
                        tableViewMode === 'dashboard'
                          ? 'bg-accent text-bg shadow-sm'
                          : 'text-ink-dim hover:text-ink'
                      }`}
                      title="Vista modo oscuro industrial optimizada para pantalla"
                    >
                      <LayoutGrid size={11} /> Dashboard
                    </button>
                    <button
                      type="button"
                      onClick={() => setTableViewMode('print')}
                      className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase transition-colors inline-flex items-center gap-1.5 ${
                        tableViewMode === 'print'
                          ? 'bg-ink text-bg shadow-sm'
                          : 'text-ink-dim hover:text-ink'
                      }`}
                      title="Vista previa exacta del reporte impreso en papel A4"
                    >
                      <Printer size={11} /> Hoja Impresa
                    </button>
                  </div>

                  <span className="text-[10px] font-mono text-ink-dim shrink-0">
                    {displayedOrders.length} / {vision.results.length}
                    <span className="text-ink-dim/70"> en vista</span>
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
                      {vision.results.length} en reporte
                      {vision.excludedOrders.length > 0
                        ? ` · ${vision.excludedOrders.length} excluidas`
                        : ''}
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

                {/* Contenedor de la Tabla */}
                <div
                  className={`overflow-auto border-2 border-line border-t-0 ${
                    tableViewMode === 'print' ? 'paper shadow-hard' : 'bg-surface shadow-hard'
                  }`}
                >
                  {tableViewMode === 'print' && (
                    <div className="bg-[#0D2B4D] text-white p-6 border-b-2 border-black/20 flex items-center justify-between">
                      <div>
                        <h2 className="font-display text-3xl font-black uppercase tracking-tighter">
                          REPORTE DE TRABAJO: SUPRAJIT
                        </h2>
                        <p className="text-xs font-mono opacity-60">
                          AUDITORÍA AUTOMATIZADA // SMV VISION
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black uppercase tracking-widest bg-accent text-bg px-2 inline-block mb-1">
                          PRODUCCIÓN ACTIVA
                        </p>
                        <p className="text-xs font-mono">{new Date().toLocaleDateString()}</p>
                      </div>
                    </div>
                  )}

                  <table className="w-full text-left border-collapse min-w-[720px] sm:min-w-full">
                    <thead className="sticky top-0 z-20">
                      <tr
                        className={
                          tableViewMode === 'print'
                            ? 'bg-[#11161C] text-white font-mono text-[10px] font-black uppercase tracking-widest'
                            : 'bg-surface-2 border-b-2 border-line text-ink font-mono text-[10px] font-black uppercase tracking-widest'
                        }
                      >
                        <th
                          className={`px-3 py-3 ${
                            tableViewMode === 'print'
                              ? 'border-r border-white/10 print:hidden'
                              : 'border-r border-line'
                          } text-center w-10`}
                        >
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                            className="w-4 h-4 cursor-pointer accent-accent"
                            title={allVisibleSelected ? 'Deseleccionar todas' : 'Seleccionar todas las visibles'}
                            aria-label="Seleccionar todas las órdenes visibles"
                          />
                        </th>
                        <th
                          className={`px-5 py-3 ${
                            tableViewMode === 'print'
                              ? 'border-r border-white/10'
                              : 'border-r border-line'
                          } text-left`}
                        >
                          PIEZA Y ESPECIFICACIÓN
                        </th>
                        <th
                          className={`px-4 py-3 ${
                            tableViewMode === 'print'
                              ? 'border-r border-white/10'
                              : 'border-r border-line'
                          } text-center w-44`}
                        >
                          VISTA 3D / ISO
                        </th>
                        <th
                          className={`px-4 py-3 ${
                            tableViewMode === 'print'
                              ? 'border-r border-white/10'
                              : 'border-r border-line'
                          } text-center w-24`}
                        >
                          CANT.
                        </th>
                        <th
                          className={`px-4 py-3 ${
                            tableViewMode === 'print'
                              ? 'border-r border-white/10'
                              : 'border-r border-line'
                          } text-center w-32`}
                        >
                          SO (ORDEN)
                        </th>
                        <th
                          className={`px-4 py-3 ${
                            tableViewMode === 'print'
                              ? 'border-r border-white/10'
                              : 'border-r border-line'
                          } text-center w-28`}
                        >
                          FECHA
                        </th>
                        <th className="px-3 py-3 text-center w-24">ACCIONES</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedOrders.map((order) => {
                        const rowKey = purchaseRowKey(order);
                        return (
                          <ReportTableRow
                            key={rowKey}
                            order={order}
                            isPurchased={purchasedKeys.has(rowKey)}
                            editMode={vision.editMode}
                            isExtracting={vision.isExtracting}
                            isAiGenerating={vision.isAiIsoGenerating(order)}
                            variant={tableViewMode}
                            isSelected={selectedOrderKeys.has(rowKey)}
                            onToggleSelect={toggleOrderSelection}
                            onDownloadTraveler={(ord) => vision.downloadTravelersPdf([ord])}
                            onEditCantidad={vision.handleEditCantidad}
                            onExcludeOrder={vision.handleExcludeOrder}
                            onDownloadSinglePdf={vision.downloadSingleOrderPdf}
                            onPreviewOrder={vision.setPreviewOrder}
                            onEncuadre={onEncuadre}
                            onQuickPurchase={onQuickPurchase}
                            onAiIso={(ord) => void vision.generateAiIsometricForOrder(ord)}
                            onViewStl={onViewStl}
                            onViewHistory={onViewHistory}
                            onVincular={onVincular}
                            resolveDrawingView={resolveDrawingView}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Barra Flotante de Acciones en Lote (cuando hay órdenes seleccionadas) */}
                {selectedOrderKeys.size > 0 && (
                  <div className="sticky bottom-4 z-30 mt-3 bg-[#0D2B4D] text-white border-2 border-accent p-3 shadow-hard-accent flex items-center justify-between gap-3 flex-wrap animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-center gap-2">
                      <span className="bg-accent text-bg px-2.5 py-1 text-xs font-mono font-black uppercase shadow-hard">
                        {selectedOrders.length} Seleccionada{selectedOrders.length === 1 ? '' : 's'}
                      </span>
                      <span className="text-xs font-mono text-white/80 hidden sm:inline">
                        Acciones en lote para taller y administración:
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => vision.downloadTravelersPdf(selectedOrders)}
                        className="px-3 py-1.5 bg-accent text-bg text-[10px] font-mono font-black uppercase border-2 border-accent hover:bg-accent/80 transition-all shadow-hard flex items-center gap-1.5"
                        title="Generar 1 Hoja de Maquinado por pieza para maquinistas"
                      >
                        <Printer size={13} /> Hojas de Maquinado ({selectedOrders.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => vision.downloadPdf(selectedOrders)}
                        className="px-3 py-1.5 bg-surface text-ink text-[10px] font-mono font-black uppercase border-2 border-line hover:border-accent hover:text-accent transition-all flex items-center gap-1.5"
                        title="Exportar PDF del reporte con estas piezas"
                      >
                        <FileText size={13} /> Reporte PDF ({selectedOrders.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => vision.downloadCsv(selectedOrders)}
                        className="px-2.5 py-1.5 bg-surface text-ink text-[10px] font-mono font-black uppercase border-2 border-line hover:border-accent hover:text-accent transition-all"
                        title="Exportar CSV con estas piezas"
                      >
                        CSV
                      </button>

                      {vision.editMode && (
                        <button
                          type="button"
                          onClick={() => {
                            selectedOrders.forEach((o) => vision.handleExcludeOrder(o));
                            clearSelection();
                          }}
                          className="px-2.5 py-1.5 bg-danger/20 text-white text-[10px] font-mono font-bold uppercase border-2 border-danger/60 hover:bg-danger transition-all flex items-center gap-1"
                          title="Excluir las piezas seleccionadas de este reporte"
                        >
                          <Trash2 size={12} /> Excluir
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={clearSelection}
                        className="px-2.5 py-1.5 text-[10px] font-mono font-bold uppercase text-white/70 hover:text-white transition-colors"
                        title="Deseleccionar todas"
                      >
                        Limpiar selección
                      </button>
                    </div>
                  </div>
                )}

                {/* Órdenes excluidas del reporte (soft-delete reversible) */}
                {vision.excludedOrders.length > 0 && (
                  <div className="mt-4 border-2 border-line bg-surface p-4">
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <p className="font-mono text-[10px] font-black uppercase tracking-widest text-ink-dim inline-flex items-center gap-1.5">
                        <Trash2 size={12} className="text-danger" /> Excluidas del reporte (
                        {vision.excludedOrders.length})
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
                        <div
                          key={i}
                          className="inline-flex items-center gap-2 bg-surface-2 border-2 border-line px-2 py-1.5"
                        >
                          <div className="min-w-0">
                            <p
                              className="text-[11px] font-bold text-ink truncate max-w-[200px]"
                              title={entry.order.pieza}
                            >
                              {entry.order.pieza}
                            </p>
                            <p className="font-mono text-[9px] text-ink-dim">
                              SO {entry.order.orden.split('\n')[0] || '—'} · cant.{' '}
                              {entry.order.cantidad.split('\n')[0]}
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
                    <p className="text-[10px] text-ink-dim uppercase font-black tracking-widest">
                      Total Auditado
                    </p>
                    <p className="font-display text-4xl font-black text-ink italic">
                      {vision.analysisSummary?.totalAudited ?? vision.results.length}
                    </p>
                  </div>
                  <div className="bg-surface border-2 border-line border-t-4 border-t-accent p-5">
                    <p className="text-[10px] text-ink-dim uppercase font-black tracking-widest">
                      Match Visual
                    </p>
                    <p className="font-display text-4xl font-black text-accent italic">
                      {vision.auditedCount}
                    </p>
                  </div>
                  <div className="bg-surface border-2 border-line border-t-4 border-t-accent p-5">
                    <p className="text-[10px] text-ink-dim uppercase font-black tracking-widest">
                      Planos Analizados
                    </p>
                    <p className="font-display text-4xl font-black text-ink italic">
                      {vision.analysisSummary?.totalAnalyzed ?? vision.workshopPdfs.length}
                    </p>
                  </div>
                  <div className="bg-surface border-2 border-line p-5 flex items-center justify-center">
                    <div className="text-center">
                      <p
                        className="text-[10px] text-ink-dim uppercase font-black tracking-widest"
                        title="Planos que se analizaron pero no casaron con ninguna orden"
                      >
                        Planos sin orden
                      </p>
                      <p className="font-display text-2xl font-black text-accent italic">
                        {vision.analysisSummary?.totalNonMatching ?? 0}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] font-mono text-ink-dim">
                  Cargados: {vision.analysisSummary?.totalLoaded ?? vision.workshopPdfs.length} PDFs
                  de taller. Ordenes en reporte:{' '}
                  {vision.analysisSummary?.totalOrders ?? vision.results.length}.
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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
                        <button
                          onClick={() => zoomIn()}
                          className="p-2 hover:bg-surface-2 text-ink transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          title="Acercar"
                        >
                          <ZoomIn size={20} />
                        </button>
                        <button
                          onClick={() => zoomOut()}
                          className="p-2 hover:bg-surface-2 text-ink transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          title="Alejar"
                        >
                          <ZoomOut size={20} />
                        </button>
                        <button
                          onClick={() => resetTransform()}
                          className="p-2 hover:bg-surface-2 text-ink transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          title="Restaurar vista"
                        >
                          <Maximize size={20} />
                        </button>
                      </div>
                      <TransformComponent
                        wrapperClass="!w-full !h-full"
                        contentClass="!w-full !h-full flex items-center justify-center"
                      >
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
      </section>
    </div>
  );
}
