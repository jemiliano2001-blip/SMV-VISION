import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Printer, Loader2, AlertCircle, Sparkles, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { openStampedPlanoOt, type PlanoOtMask, type PlanoOtStamp } from '../lib/planoOt';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { listOrdersToInvoice, REPORT_PARTNER_KEY_PREFIX, type OdooOrderView } from '../lib/firebase/odooOrders';
import {
  extractLibrarySignals,
  extractOrderSignals,
  MIN_BLUEPRINT_MATCH_SCORE,
  scorePieceMatch,
} from '../lib/matching';
import type { ToolcribActiveDrawingView } from '../types';

const PlanoOtPreview = lazy(() => import('./PlanoOtPreview').then(module => ({ default: module.PlanoOtPreview })));

export interface ToolcribPrintModalProps {
  drawing: ToolcribActiveDrawingView | null;
  onClose: () => void;
  onSuccess: (info: { soNumber: string | null }) => void;
  /** Prefill desde Órdenes Odoo (número SO). */
  initialSoNumber?: string;
  /** Prefill desde Órdenes Odoo (cantidad pendiente). */
  initialCantidad?: string;
}

export function ToolcribPrintModal({
  drawing,
  onClose,
  onSuccess,
  initialSoNumber,
  initialCantidad,
}: ToolcribPrintModalProps) {
  const [soNumber, setSoNumber] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [notas, setNotas] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ dataUrl: string; stamp: PlanoOtStamp } | null>(null);
  const [mask, setMask] = useState<PlanoOtMask | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [skipMask, setSkipMask] = useState(false);
  const generation = useRef(0);

  const [odooOrders, setOdooOrders] = useState<OdooOrderView[]>([]);
  const [matchingOrders, setMatchingOrders] = useState<{ order: OdooOrderView; qty: number }[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);

  const isOpen = drawing !== null;

  useEffect(() => {
    generation.current += 1;
    let cancelled = false;
    setIsProcessing(false);
    setPreview(null);
    setMask(null);
    setSkipMask(false);
    setPreviewReady(false);
    if (drawing) {
      setSoNumber(initialSoNumber?.trim() ?? '');
      setCantidad(initialCantidad?.trim() ?? '');
      setNotas('');
      setError(null);
      setIsLoadingOrders(true);
      listOrdersToInvoice({ partnerKeyPrefix: REPORT_PARTNER_KEY_PREFIX })
        .then((res) => {
          if (!cancelled && res.ok) {
            setOdooOrders(res.value);
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoadingOrders(false);
        });
    } else {
      setSoNumber('');
      setCantidad('');
      setNotas('');
      setOdooOrders([]);
      setMatchingOrders([]);
      setError(null);
    }
    return () => { cancelled = true; generation.current += 1; };
  }, [drawing, initialSoNumber, initialCantidad]);

  useEffect(() => {
    if (drawing && odooOrders.length > 0) {
      const drawingSignals = extractLibrarySignals(drawing);
      const matches: { order: OdooOrderView; qty: number; score: number }[] = [];

      for (const order of odooOrders) {
        let bestQty = 0;
        let bestScore = 0;
        for (const line of order.order_lines) {
          if (line.qty_pending <= 0) continue;
          const productLabel = line.product.includes('] ')
            ? line.product.split('] ').slice(1).join('] ')
            : line.product;
          const orderSignals = extractOrderSignals(
            line.description || productLabel,
            productLabel,
          );
          const score = scorePieceMatch(orderSignals, drawingSignals);
          if (score > bestScore) {
            bestScore = score;
            bestQty = line.qty_pending;
          }
        }
        if (bestScore >= MIN_BLUEPRINT_MATCH_SCORE) {
          matches.push({ order, qty: bestQty, score: bestScore });
        }
      }

      matches.sort((a, b) => b.score - a.score);
      setMatchingOrders(matches.map(({ order, qty }) => ({ order, qty })));
    } else {
      setMatchingOrders([]);
    }
  }, [drawing, odooOrders]);

  const handleOpenChange = (open: boolean) => {
    if (!open && !isProcessing) {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawing) return;

    if (!drawing.pdfUrl) {
      setError('Este plano no tiene un PDF accesible.');
      return;
    }
    if (preview && (!previewReady || (!mask && !skipMask))) return;
    if (!Number.isFinite(Number(cantidad)) || Number(cantidad) <= 0) {
      setError('Escribe una cantidad de piezas mayor que cero.');
      return;
    }

    const currentGeneration = generation.current;
    setIsProcessing(true);
    setError(null);

    try {
      if (!preview) {
        const dataUrl = await fetchPdfAsDataUrl(drawing.pdfUrl);
        if (generation.current !== currentGeneration) return;
        const now = new Date();
        const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        setPreview({ dataUrl, stamp: {
          soNumber: soNumber.trim() || 'N/A',
          cantidad: cantidad.trim(),
          fecha,
          notas: notas.trim(),
        } });
        setPreviewReady(false);
        return;
      }

      await openStampedPlanoOt(preview.dataUrl, { ...preview.stamp, quantityMask: mask });
      if (generation.current !== currentGeneration) return;

      const submittedSoNumber = soNumber.trim() || null;
      setSoNumber('');
      setCantidad('');
      setNotas('');
      onSuccess({ soNumber: submittedSoNumber });
      onClose();
    } catch (err) {
      if (generation.current === currentGeneration) setError(err instanceof Error ? err.message : 'Error al procesar el PDF para impresión.');
    } finally {
      if (generation.current === currentGeneration) setIsProcessing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className={`${preview ? 'sm:max-w-5xl' : 'sm:max-w-lg'} max-h-[94dvh] bg-surface border-2 border-line p-0 overflow-hidden shadow-hard-accent text-ink rounded-none flex flex-col`}>
        <DialogHeader className="flex flex-row items-center justify-between px-5 py-3 border-b-2 border-line bg-[#0D2B4D] text-white shrink-0 space-y-0">
          <div className="flex items-center gap-3">
            <div className="size-8 bg-accent text-bg flex items-center justify-center font-bold">
              <Printer size={16} />
            </div>
            <div>
              <DialogTitle className="font-display text-lg font-black uppercase tracking-tight m-0 text-white">
                Imprimir Plano (OT)
              </DialogTitle>
              <DialogDescription className="font-mono text-[10px] text-white/70 uppercase tracking-widest m-0">
                {drawing?.partNumber} · Rev {drawing?.revision}
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={onClose}
            disabled={isProcessing}
            aria-label="Cerrar impresión de OT"
            className="min-h-11 min-w-11 rounded-lg border border-white/40 bg-transparent text-white hover:bg-accent hover:border-accent transition-colors"
            title="Cerrar (ESC)"
          >
            <X size={14} />
          </Button>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto min-h-0">
          {error && (
            <div className="flex items-start gap-2 border-2 border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {preview ? <>
            <Suspense fallback={<p role="status">Cargando vista previa…</p>}>
              <PlanoOtPreview dataUrl={preview.dataUrl} stamp={preview.stamp} mask={mask}
                onMaskChange={next => { setMask(next); setSkipMask(false); }} onReady={setPreviewReady} />
            </Suspense>
            {!mask && <label className="flex gap-2 items-center text-sm">
              <input type="checkbox" checked={skipMask} onChange={event => setSkipMask(event.target.checked)} />
              Este plano no necesita ocultar una cantidad original.
            </label>}
          </> : <>
          {matchingOrders.length > 0 && (
            <div className="space-y-2 bg-surface-2 p-3 border-2 border-line">
              <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-ink-dim flex items-center gap-1.5">
                <Sparkles size={12} className="text-accent" /> Sugerencias de Órdenes Odoo
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {matchingOrders.map((match) => (
                  <button
                    key={match.order.id}
                    type="button"
                    onClick={() => {
                      setSoNumber(match.order.name);
                      setCantidad(match.qty.toString());
                    }}
                    disabled={isProcessing}
                    className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider border-2 border-line bg-surface text-ink hover:border-accent hover:text-accent transition-colors"
                  >
                    {match.order.name} ({match.qty} pzs)
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLoadingOrders && matchingOrders.length === 0 && (
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-dim flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin text-accent" /> Buscando órdenes en Odoo…
            </p>
          )}

          <div>
            <label htmlFor="print-so-number" className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
              Número de Orden (SO)
            </label>
            <Input
              id="print-so-number"
              aria-label="Número de Orden (SO)"
              value={soNumber}
              onChange={(e) => setSoNumber(e.target.value)}
              placeholder="Ej. 2026/S00781"
              disabled={isProcessing}
              className="w-full border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none"
            />
          </div>

          <div>
            <label htmlFor="print-quantity" className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
              Cantidad de Piezas
            </label>
            <Input
              id="print-quantity"
              aria-label="Cantidad de Piezas"
              type="number"
              required
              min="1"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              placeholder="Ej. 50"
              disabled={isProcessing}
              className="w-full border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none"
            />
          </div>

          <div>
            <label htmlFor="print-notes" className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
              Notas Adicionales (Aparecerán en el PDF)
            </label>
            <Input
              id="print-notes"
              aria-label="Notas Adicionales"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder='Ej. "Cuidado con el acabado aquí"'
              disabled={isProcessing}
              className="w-full border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none"
            />
          </div>
          </>}

          <DialogFooter className="pt-2 flex justify-end gap-2 border-t-2 border-line mt-4">
            {preview && <Button type="button" variant="outline" disabled={isProcessing} onClick={() => { setPreview(null); setPreviewReady(false); }}>Volver a datos</Button>}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isProcessing}
              className="border-2 border-line text-ink font-black uppercase text-[10px] tracking-widest hover:bg-surface-2 hover:text-ink transition-colors rounded-none h-9 px-4"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isProcessing || (!!preview && (!previewReady || (!mask && !skipMask)))}
              className="bg-accent text-bg px-6 h-9 text-[10px] font-black uppercase tracking-widest hover:bg-accent/80 transition-colors shadow-hard active:translate-x-0.5 active:translate-y-0.5 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 rounded-none flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Preparando PDF…
                </>
              ) : (
                <>
                  <Printer size={13} />
                  {preview ? 'Imprimir OT' : 'Vista previa'}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
