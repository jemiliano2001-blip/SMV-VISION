import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Printer, Loader2, AlertCircle, Sparkles, X, Files } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  openStampedPlanoOt,
  openStampedPlanoOtSet,
  type PlanoOtMask,
  type PlanoOtStamp,
  type PlanoOtPrintMode,
  type PlanoOtHeaderStyle,
  type PlanoOtSetItem,
} from '../lib/planoOt';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { listOrdersToInvoice, REPORT_PARTNER_KEY_PREFIX, type OdooOrderView } from '../lib/firebase/odooOrders';
import { listActiveDrawingViews } from '../lib/firebase/toolcrib';
import { findCompanionDrawings, type CompanionInfo } from '../lib/companionDrawings';
import {
  extractLibrarySignals,
  extractOrderSignals,
  MIN_BLUEPRINT_MATCH_SCORE,
  scorePieceMatch,
} from '../lib/matching';
import { ensureActiveSets } from '../lib/firebase/toolcribSets';
import { baseQuantityFactor, getActiveSets } from '../lib/toolcribSets';
import { buildSeparatePrintJobs, type SetPrintJob, type SetPrintPiece } from '../lib/setPrintJobs';
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
  /** Prefill desde Órdenes Odoo (PO del cliente). Si falta, se busca por SO al cargar Odoo. */
  initialPoNumber?: string;
  /** Catálogo activo opcional para resolución rápida de planos complementarios. */
  catalogViews?: readonly ToolcribActiveDrawingView[];
}

export function ToolcribPrintModal({
  drawing,
  onClose,
  onSuccess,
  initialSoNumber,
  initialCantidad,
  initialPoNumber,
  catalogViews,
}: ToolcribPrintModalProps) {
  const [soNumber, setSoNumber] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [notas, setNotas] = useState('');
  const [printMode, setPrintMode] = useState<PlanoOtPrintMode>('both');
  const [headerStyle, setHeaderStyle] = useState<PlanoOtHeaderStyle>('slim');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ dataUrl: string; stamp: PlanoOtStamp } | null>(null);
  const [mask, setMask] = useState<PlanoOtMask | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [skipMask, setSkipMask] = useState(false);
  const [catalog, setCatalog] = useState<readonly ToolcribActiveDrawingView[]>(catalogViews ?? []);
  const [includeCompanions, setIncludeCompanions] = useState(true);
  const [setItems, setSetItems] = useState<PlanoOtSetItem[] | null>(null);
  const [setsTick, setSetsTick] = useState(0);
  // El setter lo usará el preset de juego (Task 10).
  const [juegoMode] = useState<'separadas' | 'unificado'>('separadas');
  const [pendingJobs, setPendingJobs] = useState<{ job: SetPrintJob; printed: boolean }[] | null>(null);
  const generation = useRef(0);

  const [odooOrders, setOdooOrders] = useState<OdooOrderView[]>([]);
  const [matchingOrders, setMatchingOrders] = useState<{ order: OdooOrderView; qty: number }[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);

  const isOpen = drawing !== null;

  useEffect(() => {
    if (catalogViews && catalogViews.length > 0) {
      setCatalog(catalogViews);
      return;
    }
    if (drawing && catalog.length === 0) {
      let cancelled = false;
      listActiveDrawingViews().then((res) => {
        if (!cancelled && res.ok) setCatalog(res.value);
      });
      return () => { cancelled = true; };
    }
  }, [drawing, catalogViews, catalog.length]);

  useEffect(() => {
    if (!drawing) return;
    let cancelled = false;
    void ensureActiveSets().then(() => {
      if (!cancelled) setSetsTick((tick) => tick + 1);
    });
    return () => { cancelled = true; };
  }, [drawing]);

  const companions: CompanionInfo[] = useMemo(() => {
    if (!drawing || catalog.length === 0) return [];
    return findCompanionDrawings(drawing, catalog, getActiveSets());
    // setsTick fuerza el recálculo cuando terminan de cargar los juegos guardados.
  }, [drawing, catalog, setsTick]);

  useEffect(() => {
    generation.current += 1;
    let cancelled = false;
    setIsProcessing(false);
    setPreview(null);
    setMask(null);
    setSkipMask(false);
    setPreviewReady(false);
    setIncludeCompanions(true);
    setSetItems(null);
    setPendingJobs(null);
    if (drawing) {
      setSoNumber(initialSoNumber?.trim() ?? '');
      setCantidad(initialCantidad?.trim() ?? '');
      setPoNumber(initialPoNumber?.trim() ?? '');
      setNotas('');
      setError(null);
      setIsLoadingOrders(true);
      listOrdersToInvoice({ partnerKeyPrefix: REPORT_PARTNER_KEY_PREFIX })
        .then((res) => {
          if (!cancelled && res.ok) {
            setOdooOrders(res.value);
            // Llegó con SO pero sin PO: la tomamos de la orden de Odoo.
            const so = initialSoNumber?.trim();
            const po = so ? res.value.find((o) => o.name === so)?.client_order_ref : null;
            if (po && !initialPoNumber?.trim()) setPoNumber((prev) => prev || po);
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoadingOrders(false);
        });
    } else {
      setSoNumber('');
      setCantidad('');
      setPoNumber('');
      setNotas('');
      setOdooOrders([]);
      setMatchingOrders([]);
      setError(null);
    }
    return () => { cancelled = true; generation.current += 1; };
  }, [drawing, initialSoNumber, initialCantidad, initialPoNumber]);

  useEffect(() => {
    if (drawing && odooOrders.length > 0) {
      const drawingSignals = extractLibrarySignals(drawing);
      const matches: { order: OdooOrderView; qty: number; score: number }[] = [];

      for (const order of odooOrders) {
        let bestQty = 0;
        let bestScore = 0;
        for (const line of order.order_lines ?? []) {
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
      // Con piezas pendientes ya se imprimió la primera OT: cerrar equivale a terminar (registra la impresión).
      if (pendingJobs) handleFinishSet();
      else onClose();
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

        const baseStamp: PlanoOtStamp = {
          soNumber: soNumber.trim() || 'N/A',
          cantidad: cantidad.trim(),
          poNumber: poNumber.trim(),
          fecha,
          notas: notas.trim(),
          partNumber: drawing.partNumber,
          customer: drawing.customer,
          piezaDescripcion: drawing.description,
          mode: printMode,
          headerStyle,
        };

        let preparedSet: PlanoOtSetItem[] | null = null;
        if (includeCompanions && companions.length > 0) {
          const compItems: PlanoOtSetItem[] = [];
          for (const comp of companions) {
            if (!comp.drawing.pdfUrl) continue;
            try {
              const compDataUrl = await fetchPdfAsDataUrl(comp.drawing.pdfUrl);
              compItems.push({
                pdfDataUrl: compDataUrl,
                partNumber: comp.drawing.partNumber,
                revision: comp.drawing.revision,
                description: comp.drawing.description,
                isCompanion: true,
                companionLabel: comp.label,
                customer: comp.drawing.customer,
                cantidadPorJuego: comp.cantidadPorJuego ?? 1,
              });
            } catch (err) {
              console.warn('[ToolcribPrintModal] no se pudo descargar companero', comp.drawing.partNumber, err);
            }
          }

          if (compItems.length > 0) {
            preparedSet = [
              {
                pdfDataUrl: dataUrl,
                partNumber: drawing.partNumber,
                revision: drawing.revision,
                description: drawing.description,
                customer: drawing.customer,
                cantidadPorJuego: baseQuantityFactor(drawing.partNumber, getActiveSets()),
              },
              ...compItems,
            ];
          }
        }

        setSetItems(preparedSet);
        setPreview({ dataUrl, stamp: baseStamp });
        setPreviewReady(false);
        return;
      }

      if (setItems && setItems.length > 1 && juegoMode === 'separadas') {
        const juegos = Number(cantidad);
        const pieces: SetPrintPiece[] = setItems.map((item, index) => ({
          pdfDataUrl: item.pdfDataUrl,
          partNumber: item.partNumber,
          revision: item.revision,
          description: item.description,
          customer: item.customer,
          companionLabel: index === 0 ? undefined : item.companionLabel,
          cantidadPorJuego: item.cantidadPorJuego ?? 1,
          permanentNotes: [],
        }));
        const jobs = buildSeparatePrintJobs(pieces, { ...preview.stamp, quantityMask: mask }, juegos, notas.trim());
        await openStampedPlanoOt(jobs[0].piece.pdfDataUrl, jobs[0].stamp);
        if (generation.current !== currentGeneration) return;
        setPendingJobs(jobs.map((job, index) => ({ job, printed: index === 0 })));
        return;
      }

      if (setItems && setItems.length > 1) {
        await openStampedPlanoOtSet(setItems, { ...preview.stamp, quantityMask: mask });
      } else {
        await openStampedPlanoOt(preview.dataUrl, { ...preview.stamp, quantityMask: mask });
      }
      if (generation.current !== currentGeneration) return;

      const submittedSoNumber = soNumber.trim() || null;
      setSoNumber('');
      setCantidad('');
      setPoNumber('');
      setNotas('');
      onSuccess({ soNumber: submittedSoNumber });
      onClose();
    } catch (err) {
      if (generation.current === currentGeneration) setError(err instanceof Error ? err.message : 'Error al procesar el PDF para impresión.');
    } finally {
      if (generation.current === currentGeneration) setIsProcessing(false);
    }
  };

  const handlePrintPending = async (index: number) => {
    if (!pendingJobs) return;
    setError(null);
    try {
      await openStampedPlanoOt(pendingJobs[index].job.piece.pdfDataUrl, pendingJobs[index].job.stamp);
      setPendingJobs((prev) => prev && prev.map((entry, i) => (i === index ? { ...entry, printed: true } : entry)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al imprimir esta pieza.');
    }
  };

  const handleFinishSet = () => {
    const submittedSoNumber = soNumber.trim() || null;
    setSoNumber('');
    setCantidad('');
    setPoNumber('');
    setNotas('');
    setPendingJobs(null);
    onSuccess({ soNumber: submittedSoNumber });
    onClose();
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
            onClick={() => (pendingJobs ? handleFinishSet() : onClose())}
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

          {pendingJobs ? (
            <div className="space-y-3" role="region" aria-label="Piezas del juego">
              <p className="text-[10px] font-mono font-black uppercase text-accent flex items-center gap-1.5">
                <Files size={13} /> Juego: una OT por pieza
              </p>
              {pendingJobs.map((entry, index) => (
                <div key={`${entry.job.piece.partNumber}-${index}`} className="flex items-center justify-between gap-2 border-2 border-line bg-surface-2 p-2">
                  <span className="font-mono text-xs">
                    <strong>{entry.job.piece.partNumber}</strong>{entry.job.piece.companionLabel ? ` · ${entry.job.piece.companionLabel}` : ''} · {entry.job.stamp.cantidad} pzs
                  </span>
                  <Button type="button" variant="outline" onClick={() => void handlePrintPending(index)} className="rounded-none border-2 border-line h-8 text-[10px] font-black uppercase">
                    {entry.printed ? 'Reimprimir' : 'Imprimir'}
                  </Button>
                </div>
              ))}
            </div>
          ) : preview ? <>
            <Suspense fallback={<p role="status">Cargando vista previa…</p>}>
              <PlanoOtPreview dataUrl={preview.dataUrl} stamp={preview.stamp} mask={mask} setItems={setItems}
                onMaskChange={next => { setMask(next); setSkipMask(false); }} onReady={setPreviewReady} />
            </Suspense>
            {!mask && <label className="flex gap-2 items-center text-sm">
              <input type="checkbox" checked={skipMask} onChange={event => setSkipMask(event.target.checked)} />
              Este plano no necesita ocultar una cantidad original.
            </label>}
          </> : <>
          {companions.length > 0 && (
            <div className="bg-accent/10 border-2 border-accent/40 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-black uppercase text-accent flex items-center gap-1.5">
                  <Files size={13} className="text-accent" /> Juego de planos detectado ({companions.length + 1} hojas)
                </span>
                <label className="flex items-center gap-2 text-[10px] font-mono font-bold cursor-pointer text-ink">
                  <input
                    type="checkbox"
                    checked={includeCompanions}
                    onChange={(e) => setIncludeCompanions(e.target.checked)}
                    disabled={isProcessing}
                    className="size-3.5 accent-accent"
                  />
                  Imprimir juego completo
                </label>
              </div>
              <p className="text-[10px] font-mono text-ink-dim leading-tight">
                Pieza base: <strong>{drawing?.partNumber}</strong> · Incluye:{' '}
                {companions.map((c) => `${c.drawing.partNumber} (${c.label})`).join(', ')}
              </p>
              <p className="text-[9px] font-mono text-ink-dim">Cantidad = juegos pedidos; cada pieza se multiplica por sus piezas por juego.</p>
            </div>
          )}

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
                      setPoNumber(match.order.client_order_ref ?? '');
                    }}
                    disabled={isProcessing}
                    className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider border-2 border-line bg-surface text-ink hover:border-accent hover:text-accent transition-colors"
                  >
                    {match.order.name}{match.order.client_order_ref ? ` · PO ${match.order.client_order_ref}` : ''} ({match.qty} pzs)
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
            <label htmlFor="print-po-number" className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
              Orden de Compra del cliente (PO)
            </label>
            <Input
              id="print-po-number"
              aria-label="Orden de Compra del cliente (PO)"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="Se llena desde Odoo · vacío = sin PO"
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

          <div className="pt-1 border-t border-line/60 space-y-2">
            <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim">
              Formato de Impresión
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPrintMode('both')}
                disabled={isProcessing}
                className={`p-2.5 text-left border-2 transition-all flex flex-col gap-1 rounded-none ${
                  printMode === 'both'
                    ? 'border-accent bg-accent/10 shadow-hard-accent text-accent'
                    : 'border-line bg-surface-2 text-ink hover:border-accent/40'
                }`}
              >
                <span className="font-mono text-[10px] font-black uppercase flex items-center gap-1.5">
                  📦 Ambos (Recomendado)
                </span>
                <span className="text-[9px] text-ink-dim leading-tight">
                  Ficha pizarrón (pág 1) + plano de taller (pág 2)
                </span>
              </button>

              <button
                type="button"
                onClick={() => setPrintMode('blueprint')}
                disabled={isProcessing}
                className={`p-2.5 text-left border-2 transition-all flex flex-col gap-1 rounded-none ${
                  printMode === 'blueprint'
                    ? 'border-accent bg-accent/10 shadow-hard-accent text-accent'
                    : 'border-line bg-surface-2 text-ink hover:border-accent/40'
                }`}
              >
                <span className="font-mono text-[10px] font-black uppercase flex items-center gap-1.5">
                  📐 Solo Plano (Slim)
                </span>
                <span className="text-[9px] text-ink-dim leading-tight">
                  Plano técnico a escala (~93%) con encabezado compacto
                </span>
              </button>

              <button
                type="button"
                onClick={() => setPrintMode('board_ticket')}
                disabled={isProcessing}
                className={`p-2.5 text-left border-2 transition-all flex flex-col gap-1 rounded-none ${
                  printMode === 'board_ticket'
                    ? 'border-accent bg-accent/10 shadow-hard-accent text-accent'
                    : 'border-line bg-surface-2 text-ink hover:border-accent/40'
                }`}
              >
                <span className="font-mono text-[10px] font-black uppercase flex items-center gap-1.5">
                  📋 Solo Ficha Pizarrón
                </span>
                <span className="text-[9px] text-ink-dim leading-tight">
                  2 tarjetas media carta (Pizarrón + Viajera de piso)
                </span>
              </button>
            </div>

            {printMode !== 'board_ticket' && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-[9px] font-mono text-ink-dim">
                  Encabezado en plano: <strong className="text-ink uppercase">{headerStyle === 'slim' ? 'Ultra-Compacto Slim (~93% escala)' : 'Clásico Grande (~78% escala)'}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setHeaderStyle((prev) => (prev === 'slim' ? 'classic' : 'slim'))}
                  className="text-[9px] font-mono text-accent hover:underline uppercase tracking-wider"
                >
                  Cambiar a {headerStyle === 'slim' ? 'Clásico' : 'Slim'}
                </button>
              </div>
            )}
          </div>
          </>}

          <DialogFooter className="pt-2 flex justify-end gap-2 border-t-2 border-line mt-4">
            {pendingJobs ? (
              <Button type="button" onClick={handleFinishSet} className="bg-accent text-bg px-6 h-9 text-[10px] font-black uppercase tracking-widest rounded-none">
                Terminar
              </Button>
            ) : (<>
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
                  {preview
                    ? setItems && setItems.length > 1
                      ? juegoMode === 'separadas'
                        ? `Imprimir ${setItems.length} OTs (una por pieza)`
                        : `Imprimir Juego (${setItems.length} Planos)`
                      : printMode === 'both'
                      ? 'Imprimir (Ficha + Plano)'
                      : printMode === 'board_ticket'
                      ? 'Imprimir Ficha Pizarrón'
                      : 'Imprimir Plano (Slim)'
                    : 'Vista previa'}
                </>
              )}
            </Button>
            </>)}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
