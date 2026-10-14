/**
 * InvoiceRequestPanel — Modal para generar solicitudes de Factura / Remisión.
 *
 * Flujo:
 *  1. El usuario selecciona órdenes de la lista (solo las que tienen producción LISTO o parcial)
 *  2. Para cada orden, elige Factura (entrega completa) o Remisión (entrega parcial)
 *  3. Si es Remisión, escribe el detalle de lo que se entrega
 *  4. Ve el preview del correo y puede:
 *     - Enviar por correo (mailto: → abre Outlook)
 *     - Copiar al portapapeles
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Mail, Copy, Check, FileText, ChevronRight,
  ClipboardCheck, Box, Download, Loader2, Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

import type { OdooOrderView, ProductionStatus } from '../lib/firebase/odooOrders';
import type { OrderDrawingLink } from '../types';
import { renderStlToDataUrl, copyImageBlobToClipboard } from '../lib/stlImageRenderer';
import { makeOrderDrawingLinkKey } from '../lib/orderDrawingBridge';
import {
  type InvoiceType,
  type InvoiceOrderEntry,
  buildEmailContent,
  buildMailtoUri,
  copyToClipboard,
  INVOICE_RECIPIENT,
} from '../lib/invoiceEmail';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

interface OrderSelection {
  /** Checked in the selection list. */
  selected: boolean;
  /** Factura or Remisión. */
  type: InvoiceType;
  /** Remisión detail (e.g. "4 sets de 4150-06"). Only relevant when type === 'remision'. */
  remisionDetail: string;
}

export interface InvoiceRequestPanelProps {
  open: boolean;
  onClose: () => void;
  orders: OdooOrderView[];
  productionMap: Map<string, ProductionStatus>;
  resolvedLinksMap?: Map<string, OrderDrawingLink>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Summarizes the pending lines of an order for UI display. */
function summarizePending(order: OdooOrderView): string {
  const pending = order.order_lines.filter((l) => l.qty_pending > 0);
  if (pending.length === 0) return 'Todo entregado';
  return pending
    .map((l) => {
      const name = l.product.split('] ')[1] || l.product;
      return `${l.qty_pending} × ${name}`;
    })
    .join(', ');
}

/** Pre-fills a remisión detail suggestion from order lines with pending qty. */
function suggestRemisionDetail(order: OdooOrderView): string {
  const pending = order.order_lines.filter((l) => l.qty_pending > 0);
  if (pending.length === 0) return '';
  if (pending.length === 1) {
    const line = pending[0];
    const name = line.product.split('] ')[1] || line.product;
    return `${line.qty_pending} ${name}`;
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────────────────────

export function InvoiceRequestPanel({
  open,
  onClose,
  orders,
  productionMap,
  resolvedLinksMap,
}: InvoiceRequestPanelProps) {
  // Map: orderId → selection state
  const [selections, setSelections] = useState<Map<string, OrderSelection>>(new Map());
  const [copiedField, setCopiedField] = useState<'body' | 'subject' | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [step, setStep] = useState<'select' | 'preview'>('select');

  // Estado para imágenes 3D renderizadas: drawingId -> { dataUrl, blob }
  const [rendered3D, setRendered3D] = useState<Map<string, { dataUrl: string; blob: Blob }>>(new Map());
  const [loading3D, setLoading3D] = useState<Set<string>>(new Set());
  const [copied3DKey, setCopied3DKey] = useState<string | null>(null);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setSelections(new Map());
      setCopiedField(null);
      setStep('select');
      setRendered3D(new Map());
      setLoading3D(new Set());
      setCopied3DKey(null);
    }
  }, [open]);

  // Build the list of eligible orders (those with at least some production)
  const eligibleOrders = useMemo(
    () =>
      orders.filter((o) => {
        const prod = productionMap.get(o.name);
        // Show orders that have at least one OT (they're in production or done)
        return prod && prod.total > 0;
      }),
    [orders, productionMap],
  );

  const getSelection = (orderId: string): OrderSelection =>
    selections.get(orderId) ?? { selected: false, type: 'factura', remisionDetail: '' };

  const updateSelection = useCallback(
    (orderId: string, patch: Partial<OrderSelection>) => {
      setSelections((prev) => {
        const next = new Map(prev);
        const current = next.get(orderId) ?? { selected: false, type: 'factura' as InvoiceType, remisionDetail: '' };
        next.set(orderId, { ...current, ...patch });
        return next;
      });
    },
    [],
  );

  const selectedEntries: InvoiceOrderEntry[] = useMemo(() => {
    const entries: InvoiceOrderEntry[] = [];
    for (const order of eligibleOrders) {
      const sel = getSelection(order.id);
      if (!sel.selected) continue;
      entries.push({
        orderName: order.name,
        type: sel.type,
        partner: order.partner,
        client_order_ref: order.client_order_ref || undefined,
        remisionDetail: sel.type === 'remision' ? sel.remisionDetail || undefined : undefined,
      });
    }
    return entries;
  }, [eligibleOrders, selections]);

  // Lista de piezas asociadas a las órdenes seleccionadas que cuentan con modelo 3D (STL)
  const available3DItems = useMemo(() => {
    if (!resolvedLinksMap) return [];
    const items: Array<{
      key: string;
      orderName: string;
      productName: string;
      stlUrl: string;
      drawingId: string;
      partNumber: string;
    }> = [];
    const seenStl = new Set<string>();

    for (const order of eligibleOrders) {
      const sel = getSelection(order.id);
      if (!sel.selected) continue;

      order.order_lines.forEach((line, idx) => {
        const linkKey = makeOrderDrawingLinkKey(order.id, idx);
        const link = resolvedLinksMap.get(linkKey);
        const drawing = link?.reportDrawing ?? link?.cadDrawing;
        const stlUrl = drawing?.stlUrl;

        if (stlUrl && !seenStl.has(stlUrl)) {
          seenStl.add(stlUrl);
          items.push({
            key: `${order.name}-${idx}-${drawing.drawingId}`,
            orderName: order.name,
            productName: line.product.split('] ')[1] || line.product,
            stlUrl,
            drawingId: drawing.drawingId,
            partNumber: drawing.partNumber,
          });
        }
      });
    }
    return items;
  }, [eligibleOrders, selections, resolvedLinksMap]);

  // Renderizar una pieza 3D a imagen PNG limpia
  const handleRender3D = useCallback(async (item: { stlUrl: string; drawingId: string }) => {
    if (rendered3D.has(item.drawingId)) return;
    setLoading3D((prev) => new Set(prev).add(item.drawingId));
    try {
      const res = await renderStlToDataUrl(item.stlUrl, {
        width: 800,
        height: 600,
        backgroundColor: 0xffffff,
      });
      if (res.ok === false) {
        toast.error(`Error al generar 3D: ${res.reason}`);
      } else {
        setRendered3D((prev) => new Map(prev).set(item.drawingId, { dataUrl: res.dataUrl, blob: res.blob }));
      }
    } finally {
      setLoading3D((prev) => {
        const next = new Set(prev);
        next.delete(item.drawingId);
        return next;
      });
    }
  }, [rendered3D]);

  // Copiar imagen 3D al portapapeles
  const handleCopy3DImage = useCallback(async (item: { stlUrl: string; drawingId: string; partNumber: string }) => {
    let rendered = rendered3D.get(item.drawingId);
    if (!rendered) {
      setLoading3D((prev) => new Set(prev).add(item.drawingId));
      try {
        const res = await renderStlToDataUrl(item.stlUrl, {
          width: 800,
          height: 600,
          backgroundColor: 0xffffff,
        });
        if (res.ok === false) {
          toast.error(`Error al generar 3D: ${res.reason}`);
          return;
        } else {
          rendered = { dataUrl: res.dataUrl, blob: res.blob };
          setRendered3D((prev) => new Map(prev).set(item.drawingId, rendered!));
        }
      } finally {
        setLoading3D((prev) => {
          const next = new Set(prev);
          next.delete(item.drawingId);
          return next;
        });
      }
    }

    if (rendered?.blob) {
      const ok = await copyImageBlobToClipboard(rendered.blob);
      if (ok) {
        setCopied3DKey(item.drawingId);
        toast.success(`Imagen 3D de ${item.partNumber} copiada al portapapeles. Pégala con Ctrl+V en Outlook.`);
        setTimeout(() => setCopied3DKey(null), 3000);
      } else {
        toast.error('No se pudo copiar la imagen al portapapeles. Intenta con "Descargar PNG".');
      }
    }
  }, [rendered3D]);

  // Descargar imagen 3D como archivo PNG
  const handleDownload3DImage = useCallback(async (item: { stlUrl: string; drawingId: string; partNumber: string }) => {
    let rendered = rendered3D.get(item.drawingId);
    if (!rendered) {
      setLoading3D((prev) => new Set(prev).add(item.drawingId));
      try {
        const res = await renderStlToDataUrl(item.stlUrl, {
          width: 800,
          height: 600,
          backgroundColor: 0xffffff,
        });
        if (res.ok === false) {
          toast.error(`Error al generar 3D: ${res.reason}`);
          return;
        } else {
          rendered = { dataUrl: res.dataUrl, blob: res.blob };
          setRendered3D((prev) => new Map(prev).set(item.drawingId, rendered!));
        }
      } finally {
        setLoading3D((prev) => {
          const next = new Set(prev);
          next.delete(item.drawingId);
          return next;
        });
      }
    }

    if (rendered?.blob) {
      const url = URL.createObjectURL(rendered.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `3D_${item.partNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`Imagen 3D descargada.`);
    }
  }, [rendered3D]);

  const hasIncompleteRemision = useMemo(
    () => selectedEntries.some((e) => e.type === 'remision' && !e.remisionDetail?.trim()),
    [selectedEntries],
  );

  const emailContent = useMemo(
    () => (selectedEntries.length > 0 ? buildEmailContent(selectedEntries) : null),
    [selectedEntries],
  );

  const handleSendEmail = useCallback(() => {
    if (!emailContent) return;
    const uri = buildMailtoUri(emailContent);
    const win = window.open(uri, '_blank');
    if (!win) {
      setCopyError(
        'El navegador bloqueó la ventana del correo. Usa "Copiar Todo" y pégalo en tu cliente de correo.',
      );
    }
  }, [emailContent]);

  const handleCopy = useCallback(
    async (field: 'body' | 'subject') => {
      if (!emailContent) return;
      const text = field === 'body' ? emailContent.body : emailContent.subject;
      const ok = await copyToClipboard(text);
      if (ok) {
        setCopyError(null);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
      } else {
        setCopyError(
          'No se pudo copiar al portapapeles (requiere HTTPS o localhost). Selecciona el texto manualmente.',
        );
      }
    },
    [emailContent],
  );

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-3xl w-full max-h-[85vh] p-0 gap-0 overflow-hidden bg-surface border-2 border-line shadow-hard-accent flex flex-col">
        <DialogTitle className="sr-only">Solicitud de Facturación</DialogTitle>
        <DialogDescription className="sr-only">Selecciona las órdenes para generar la factura o remisión.</DialogDescription>
        
        {/* ── Header ── */}
        <DialogHeader className="flex flex-row items-center justify-between gap-4 px-5 py-3 border-b-2 border-line bg-[#0D2B4D] text-white shrink-0 space-y-0">
          <div className="min-w-0 text-left">
            <p className="text-[10px] font-mono opacity-60 uppercase tracking-widest m-0">
              Solicitud de facturación
            </p>
            <h3 className="font-display text-lg font-black uppercase tracking-tight flex items-center gap-2 m-0">
              <FileText size={18} />
              {step === 'select' ? 'Seleccionar Órdenes' : 'Preview del Correo'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {step === 'preview' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep('select')}
                className="bg-transparent text-white border-white/40 hover:bg-white/10 hover:text-white h-8 text-[10px] font-black uppercase tracking-widest rounded-none"
              >
                ← Volver
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={onClose}
              className="min-h-11 min-w-11 rounded-lg border border-white/40 bg-transparent text-white hover:bg-accent hover:border-accent transition-colors"
              title="Cerrar (ESC)"
              aria-label="Cerrar solicitud de factura"
            >
              <X size={16} />
            </Button>
          </div>
        </DialogHeader>

        {/* ── Content ── */}
        <AnimatePresence mode="wait">
          {step === 'select' ? (
            <motion.div
              key="select"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 overflow-y-auto"
            >
              {/* Instructions */}
              <div className="px-5 py-3 border-b border-line bg-surface-2">
                <p className="text-[11px] font-mono text-ink-dim">
                  Selecciona las órdenes a facturar o hacer remisión. Para remisión, especifica las piezas que se entregan.
                </p>
              </div>

              {eligibleOrders.length === 0 ? (
                <div className="p-12 text-center text-ink-dim space-y-3">
                  <FileText size={48} className="mx-auto text-line" />
                  <p className="font-display font-black text-xl uppercase italic">
                    Sin órdenes elegibles
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest">
                    No hay órdenes con producción activa para facturar
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {eligibleOrders.map((order) => {
                    const sel = getSelection(order.id);
                    const prod = productionMap.get(order.name);
                    const isReady = prod && prod.entregadas >= prod.total;
                    const pending = summarizePending(order);

                    return (
                      <div
                        key={order.id}
                        className={`px-5 py-3 transition-colors ${
                          sel.selected ? 'bg-accent/5' : 'hover:bg-surface-2/40'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Checkbox */}
                          <div className="pt-0.5">
                            <input
                              id={`inv-sel-${order.id}`}
                              type="checkbox"
                              checked={sel.selected}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                updateSelection(order.id, {
                                  selected: checked,
                                  // Pre-fill remisión detail when switching to remision
                                  remisionDetail: sel.remisionDetail || suggestRemisionDetail(order),
                                });
                              }}
                              className="w-4 h-4 accent-accent cursor-pointer"
                            />
                          </div>

                          {/* Order info */}
                          <label htmlFor={`inv-sel-${order.id}`} className="grow min-w-0 cursor-pointer">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-display font-black text-[15px] uppercase tracking-tight text-ink">
                                {order.name}
                              </span>
                              <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase ${
                                isReady ? 'bg-ok text-bg' : 'bg-warn text-bg'
                              }`}>
                                {isReady ? '✓ LISTO' : `◐ ${prod?.entregadas ?? 0}/${prod?.total ?? 0}`}
                              </span>
                              {order.client_order_ref && (
                                <span className="font-mono text-[9px] text-ink-dim">
                                  PO: {order.client_order_ref}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] font-mono text-ink-dim mt-0.5 truncate" title={pending}>
                              {pending}
                            </p>
                          </label>

                          {/* Type toggle (only when selected) */}
                          {sel.selected && (
                            <div className="flex shrink-0">
                              <Button
                                variant="outline"
                                onClick={() => updateSelection(order.id, { type: 'factura' })}
                                className={`rounded-none rounded-l-md border-2 border-line h-8 px-3 text-[10px] font-black uppercase tracking-wider transition-colors ${
                                  sel.type === 'factura'
                                    ? 'bg-ok text-bg hover:bg-ok/90 hover:text-bg'
                                    : 'bg-surface text-ink-dim hover:bg-surface-2 hover:text-ink'
                                }`}
                              >
                                Factura
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() =>
                                  updateSelection(order.id, {
                                    type: 'remision',
                                    remisionDetail: sel.remisionDetail || suggestRemisionDetail(order),
                                  })
                                }
                                className={`rounded-none rounded-r-md border-2 border-l-0 border-line h-8 px-3 text-[10px] font-black uppercase tracking-wider transition-colors ${
                                  sel.type === 'remision'
                                    ? 'bg-warn text-bg hover:bg-warn/90 hover:text-bg'
                                    : 'bg-surface text-ink-dim hover:bg-surface-2 hover:text-ink'
                                }`}
                              >
                                Remisión
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Remisión detail input */}
                        {sel.selected && sel.type === 'remision' && (
                          <div className="ml-7 mt-2">
                            <label htmlFor={`remision-detail-${order.id}`} className="block text-[9px] font-black uppercase tracking-widest text-ink-dim mb-1">
                              Detalle de la remisión (piezas a entregar)
                            </label>
                            <Input
                              id={`remision-detail-${order.id}`}
                              value={sel.remisionDetail}
                              onChange={(e) => updateSelection(order.id, { remisionDetail: e.target.value })}
                              placeholder="Ej: 4 sets de 4150-06"
                              className="border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent placeholder:text-ink-dim/50 rounded-none shadow-none"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 overflow-y-auto p-5 space-y-4"
            >
              {emailContent && (
                <>
                  {/* To */}
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-ink-dim mb-1">Para</p>
                    <p className="font-mono text-[12px] text-ink bg-surface-2 border border-line px-3 py-2">
                      {INVOICE_RECIPIENT}
                    </p>
                  </div>

                  {/* Subject */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-ink-dim">Asunto</p>
                      <button
                        type="button"
                        onClick={() => void handleCopy('subject')}
                        className="text-[9px] font-black uppercase tracking-widest text-ink-dim hover:text-accent flex items-center gap-1 transition-colors"
                      >
                        {copiedField === 'subject' ? <><Check size={10} /> Copiado</> : <><Copy size={10} /> Copiar</>}
                      </button>
                    </div>
                    <p className="font-display font-black text-lg text-ink bg-surface-2 border border-line px-3 py-2">
                      {emailContent.subject}
                    </p>
                  </div>

                  {/* Body */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-ink-dim">Cuerpo del correo</p>
                      <button
                        type="button"
                        onClick={() => void handleCopy('body')}
                        className="text-[9px] font-black uppercase tracking-widest text-ink-dim hover:text-accent flex items-center gap-1 transition-colors"
                      >
                        {copiedField === 'body' ? <><ClipboardCheck size={10} /> Copiado</> : <><Copy size={10} /> Copiar</>}
                      </button>
                    </div>
                    <div className="bg-white text-black border-2 border-line p-5 font-sans text-sm leading-relaxed whitespace-pre-wrap shadow-hard">
                      {emailContent.body}
                    </div>
                  </div>

                  {/* ── Imágenes de Apoyo 3D (para Mary / Evidencia sin medidas) ── */}
                  {available3DItems.length > 0 && (
                    <div className="border-t-2 border-dashed border-line pt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-display font-black text-sm uppercase tracking-tight flex items-center gap-2 text-ink">
                            <Box size={16} className="text-accent" />
                            Imágenes 3D de las piezas (sin medidas)
                          </p>
                          <p className="text-[11px] font-mono text-ink-dim">
                            Copia la imagen limpia con 1 clic para pegarla con Ctrl+V directamente en Outlook o descárgala.
                          </p>
                        </div>
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest bg-accent/10 text-accent px-2 py-0.5 border border-accent/20">
                          {available3DItems.length} disponible{available3DItems.length > 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {available3DItems.map((item) => {
                          const isRendering = loading3D.has(item.drawingId);
                          const rendered = rendered3D.get(item.drawingId);
                          const isCopied = copied3DKey === item.drawingId;

                          return (
                            <div
                              key={item.key}
                              className="border-2 border-line bg-surface p-3 space-y-2 flex flex-col justify-between shadow-sm"
                            >
                              <div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-display font-bold text-xs uppercase text-ink truncate" title={item.partNumber}>
                                    {item.partNumber}
                                  </span>
                                  <span className="font-mono text-[9px] text-ink-dim uppercase bg-surface-2 px-1.5 py-0.5 border border-line">
                                    {item.orderName}
                                  </span>
                                </div>
                                <p className="text-[10px] text-ink-dim font-mono truncate" title={item.productName}>
                                  {item.productName}
                                </p>
                              </div>

                              {/* Preview visual o placeholder */}
                              <div className="w-full h-36 bg-white border border-line flex items-center justify-center overflow-hidden relative group">
                                {rendered ? (
                                  <img
                                    src={rendered.dataUrl}
                                    alt={`Modelo 3D de ${item.partNumber}`}
                                    className="w-full h-full object-contain p-2"
                                  />
                                ) : (
                                  <div className="text-center p-3 space-y-1.5">
                                    <Box size={28} className="mx-auto text-ink-dim/40" />
                                    <p className="font-mono text-[9px] uppercase tracking-wider text-ink-dim">
                                      {isRendering ? 'Renderizando vista 3D…' : 'Vista 3D disponible'}
                                    </p>
                                    {!isRendering && (
                                      <button
                                        type="button"
                                        onClick={() => void handleRender3D(item)}
                                        className="text-[10px] font-bold text-accent hover:underline flex items-center gap-1 mx-auto"
                                      >
                                        <Sparkles size={11} /> Generar vista previa
                                      </button>
                                    )}
                                  </div>
                                )}

                                {isRendering && (
                                  <div className="absolute inset-0 bg-surface/80 backdrop-blur-xs flex items-center justify-center gap-2">
                                    <Loader2 size={16} className="animate-spin text-accent" />
                                    <span className="font-mono text-[10px] uppercase font-bold text-ink">Generando 3D…</span>
                                  </div>
                                )}
                              </div>

                              {/* Acciones */}
                              <div className="flex items-center gap-2 pt-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isRendering}
                                  onClick={() => void handleCopy3DImage(item)}
                                  className={`flex-1 h-8 text-[10px] font-black uppercase tracking-wider border-line transition-all ${
                                    isCopied
                                      ? 'bg-ok text-bg border-ok hover:bg-ok/90'
                                      : 'bg-surface hover:bg-surface-2 text-ink'
                                  }`}
                                  title="Copiar imagen al portapapeles para pegar en Outlook"
                                >
                                  {isCopied ? (
                                    <>
                                      <Check size={12} className="mr-1 text-bg" />
                                      ¡Copiado!
                                    </>
                                  ) : (
                                    <>
                                      <Copy size={12} className="mr-1" />
                                      Copiar Imagen
                                    </>
                                  )}
                                </Button>

                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isRendering}
                                  onClick={() => void handleDownload3DImage(item)}
                                  className="h-8 px-2.5 border-line bg-surface hover:bg-surface-2 text-ink-dim hover:text-ink text-[10px]"
                                  title="Descargar imagen PNG"
                                  aria-label="Descargar imagen PNG"
                                >
                                  <Download size={13} />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {copyError && (
          <div className="mx-5 mb-3 flex items-start gap-2 border border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger">
            <span className="grow">{copyError}</span>
            <button
              type="button"
              onClick={() => setCopyError(null)}
              className="shrink-0 text-danger/70 hover:text-danger"
              aria-label="Cerrar"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter className="border-t-2 border-line px-5 py-3 bg-surface-2 flex items-center justify-between gap-3 sm:flex-row flex-wrap m-0 rounded-none">
          <p className="font-mono text-[10px] text-ink-dim m-0 text-left w-full sm:w-auto flex-1">
            {selectedEntries.length === 0
              ? 'Selecciona al menos una orden'
              : hasIncompleteRemision
                ? 'Escribe el detalle de entrega en cada remisión seleccionada'
                : `${selectedEntries.length} orden(es) · ${selectedEntries.filter((e) => e.type === 'factura').length} factura(s) · ${selectedEntries.filter((e) => e.type === 'remision').length} remisión(es)`}
          </p>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {step === 'select' ? (
              <Button
                onClick={() => setStep('preview')}
                disabled={selectedEntries.length === 0 || hasIncompleteRemision}
                title={hasIncompleteRemision ? 'Completa el detalle de entrega de cada remisión' : undefined}
                className="bg-accent text-bg text-[11px] font-black uppercase tracking-widest shadow-hard hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 rounded-none disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 h-10 px-6"
              >
                Ver Preview <ChevronRight size={14} className="ml-2" />
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => void handleCopy('body')}
                  className="border-2 border-line bg-surface text-ink text-[11px] font-black uppercase tracking-widest hover:border-accent hover:text-accent hover:bg-surface-2 transition-colors rounded-none h-10 px-6"
                >
                  {copiedField === 'body' ? <><ClipboardCheck size={14} className="mr-2" /> Copiado</> : <><Copy size={14} className="mr-2" /> Copiar Todo</>}
                </Button>
                <Button
                  onClick={handleSendEmail}
                  className="bg-accent text-bg text-[11px] font-black uppercase tracking-widest shadow-hard hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 rounded-none h-10 px-6"
                >
                  <Mail size={14} className="mr-2" /> Enviar Correo
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
