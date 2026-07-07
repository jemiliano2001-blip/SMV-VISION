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
  ClipboardCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import type { OdooOrderView, ProductionStatus } from '../lib/firebase/odooOrders';
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
}: InvoiceRequestPanelProps) {
  // Map: orderId → selection state
  const [selections, setSelections] = useState<Map<string, OrderSelection>>(new Map());
  const [copiedField, setCopiedField] = useState<'body' | 'subject' | null>(null);
  const [step, setStep] = useState<'select' | 'preview'>('select');

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setSelections(new Map());
      setCopiedField(null);
      setStep('select');
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

  const emailContent = useMemo(
    () => (selectedEntries.length > 0 ? buildEmailContent(selectedEntries) : null),
    [selectedEntries],
  );

  const handleSendEmail = useCallback(() => {
    if (!emailContent) return;
    const uri = buildMailtoUri(emailContent);
    window.open(uri, '_blank');
  }, [emailContent]);

  const handleCopy = useCallback(
    async (field: 'body' | 'subject') => {
      if (!emailContent) return;
      const text = field === 'body' ? emailContent.body : emailContent.subject;
      const ok = await copyToClipboard(text);
      if (ok) {
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
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
              className="h-8 w-8 rounded-none border-2 border-white/40 bg-transparent text-white hover:bg-accent hover:border-accent hover:text-bg transition-colors"
              title="Cerrar (ESC)"
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
                            <label className="block text-[9px] font-black uppercase tracking-widest text-ink-dim mb-1">
                              Detalle de la remisión (piezas a entregar)
                            </label>
                            <Input
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
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Footer ── */}
        <DialogFooter className="border-t-2 border-line px-5 py-3 bg-surface-2 flex items-center justify-between gap-3 sm:flex-row flex-wrap m-0 rounded-none">
          <p className="font-mono text-[10px] text-ink-dim m-0 text-left w-full sm:w-auto flex-1">
            {selectedEntries.length === 0
              ? 'Selecciona al menos una orden'
              : `${selectedEntries.length} orden(es) · ${selectedEntries.filter((e) => e.type === 'factura').length} factura(s) · ${selectedEntries.filter((e) => e.type === 'remision').length} remisión(es)`}
          </p>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {step === 'select' ? (
              <Button
                onClick={() => setStep('preview')}
                disabled={selectedEntries.length === 0}
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
