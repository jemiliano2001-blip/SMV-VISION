/**
 * Impresión en lote de OT desde Biblioteca.
 *
 * El motor (`openStampedPlanoOtBatch`) ya existía en `planoOt.ts` pero no
 * tenía UI que lo disparara — Biblioteca sólo imprimía plano por plano. En el
 * taller varias piezas suelen salir en la MISMA orden (mismo SO/fecha), así
 * que el número de orden y la fecha son compartidos; la cantidad sí puede
 * variar pieza por pieza, así que es editable por fila.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Printer, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { openStampedPlanoOtBatch, type BatchPlanoOtItem } from '../lib/planoOt';
import { log } from '../lib/log';
import type { ToolcribActiveDrawingView } from '../types';

export interface ToolcribBatchPrintModalProps {
  /** null = modal cerrado. Cada entrada debe tener `pdfUrl` (el caller ya filtró). */
  drawings: ToolcribActiveDrawingView[] | null;
  onClose: () => void;
  onSuccess: (info: { soNumber: string | null; drawings: ToolcribActiveDrawingView[] }) => void;
}

function defaultFecha(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function ToolcribBatchPrintModal({
  drawings,
  onClose,
  onSuccess,
}: ToolcribBatchPrintModalProps) {
  const [soNumber, setSoNumber] = useState('');
  const [notas, setNotas] = useState('');
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOpen = drawings !== null && drawings.length > 0;

  useEffect(() => {
    if (drawings) {
      setSoNumber('');
      setNotas('');
      setCantidades(Object.fromEntries(drawings.map((d) => [d.drawingId, '1'])));
      setError(null);
      setProgress(null);
    }
  }, [drawings]);

  const handleOpenChange = (open: boolean) => {
    if (!open && !isProcessing) onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!drawings || drawings.length === 0) return;

    setIsProcessing(true);
    setError(null);
    setProgress({ done: 0, total: drawings.length });

    try {
      const fecha = defaultFecha();
      const items: BatchPlanoOtItem[] = [];

      for (const drawing of drawings) {
        if (!drawing.pdfUrl) continue;
        const pdfDataUrl = await fetchPdfAsDataUrl(drawing.pdfUrl);
        items.push({
          pdfDataUrl,
          stamp: {
            soNumber: soNumber.trim() || 'N/A',
            cantidad: cantidades[drawing.drawingId]?.trim() || '1',
            fecha,
            notas: notas.trim(),
          },
          partNumber: drawing.partNumber,
          revision: drawing.revision,
        });
        setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }

      if (items.length === 0) {
        throw new Error('Ninguno de los planos seleccionados tiene un PDF accesible.');
      }

      await openStampedPlanoOtBatch(items);

      const submittedSoNumber = soNumber.trim() || null;
      onSuccess({ soNumber: submittedSoNumber, drawings });
      onClose();
    } catch (err) {
      log.warn('[smv-vision][toolcrib] impresión en lote falló', err);
      setError(err instanceof Error ? err.message : 'Error al preparar el lote de PDFs.');
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-xl bg-surface border-2 border-line p-0 overflow-hidden shadow-hard-accent text-ink rounded-none flex flex-col max-h-[85vh]"
      >
        <DialogHeader className="flex flex-row items-center justify-between px-5 py-3 border-b-2 border-line bg-[#0D2B4D] text-white shrink-0 space-y-0">
          <div className="flex items-center gap-3">
            <div className="size-8 bg-accent text-bg flex items-center justify-center font-bold">
              <Printer size={16} />
            </div>
            <div>
              <DialogTitle className="font-display text-lg font-black uppercase tracking-tight m-0 text-white">
                Imprimir Lote de OT
              </DialogTitle>
              <DialogDescription className="font-mono text-[10px] text-white/70 uppercase tracking-widest m-0">
                {drawings?.length ?? 0} {(drawings?.length ?? 0) === 1 ? 'plano' : 'planos'} seleccionados
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={onClose}
            disabled={isProcessing}
            className="h-8 w-8 rounded-none border-2 border-white/40 bg-transparent text-white hover:bg-accent hover:border-accent hover:text-bg transition-colors"
            title="Cerrar (ESC)"
          >
            <X size={14} />
          </Button>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 grow">
          <div className="p-5 space-y-4 overflow-y-auto">
            {error && (
              <div className="flex items-start gap-2 border-2 border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                  Número de Orden (SO)
                </label>
                <Input
                  value={soNumber}
                  onChange={(e) => setSoNumber(e.target.value)}
                  placeholder="Ej. 2026/S00781"
                  disabled={isProcessing}
                  className="w-full border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                  Notas (todas las hojas)
                </label>
                <Input
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder='Ej. "Cuidado con el acabado"'
                  disabled={isProcessing}
                  className="w-full border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none"
                />
              </div>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1.5">
                Cantidad por pieza
              </p>
              <div className="border-2 border-line divide-y-2 divide-line max-h-[300px] overflow-y-auto">
                {(drawings ?? []).map((drawing) => (
                  <div key={drawing.drawingId} className="flex items-center gap-3 px-3 py-2 bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-bold text-ink truncate">{drawing.partNumber}</p>
                      {!drawing.pdfUrl && (
                        <p className="font-mono text-[10px] text-danger">Sin PDF — se omitirá</p>
                      )}
                    </div>
                    <Input
                      type="number"
                      min="1"
                      value={cantidades[drawing.drawingId] ?? '1'}
                      onChange={(e) =>
                        setCantidades((prev) => ({ ...prev, [drawing.drawingId]: e.target.value }))
                      }
                      disabled={isProcessing || !drawing.pdfUrl}
                      className="w-20 border-2 border-line bg-surface text-ink h-8 text-[12px] font-mono text-right focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none shrink-0"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="px-5 py-3 flex justify-end gap-2 border-t-2 border-line shrink-0">
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
              disabled={isProcessing}
              className="bg-accent text-bg px-6 h-9 text-[10px] font-black uppercase tracking-widest hover:bg-accent/80 transition-colors shadow-hard active:translate-x-0.5 active:translate-y-0.5 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 rounded-none flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  {progress ? `Preparando ${progress.done}/${progress.total}…` : 'Preparando…'}
                </>
              ) : (
                <>
                  <Printer size={13} />
                  Imprimir Lote
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
