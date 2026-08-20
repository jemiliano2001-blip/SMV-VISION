import { useState, useEffect } from 'react';
import { Printer, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { openStampedPlanoOt } from '../lib/planoOt';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { listOrdersToInvoice, type OdooOrderView } from '../lib/firebase/odooOrders';
import {
  extractLibrarySignals,
  extractOrderSignals,
  MIN_BLUEPRINT_MATCH_SCORE,
  scorePieceMatch,
} from '../lib/matching';
import type { ToolcribActiveDrawingView } from '../types';

export interface ToolcribPrintModalProps {
  drawing: ToolcribActiveDrawingView | null;
  onClose: () => void;
  onSuccess: () => void;
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

  const [odooOrders, setOdooOrders] = useState<OdooOrderView[]>([]);
  const [matchingOrders, setMatchingOrders] = useState<{ order: OdooOrderView; qty: number }[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);

  const isOpen = drawing !== null;

  useEffect(() => {
    if (drawing) {
      setSoNumber(initialSoNumber?.trim() ?? '');
      setCantidad(initialCantidad?.trim() ?? '');
      setNotas('');
      setError(null);
      setIsLoadingOrders(true);
      listOrdersToInvoice()
        .then((res) => {
          if (res.ok) {
            setOdooOrders(res.value);
          }
        })
        .finally(() => {
          setIsLoadingOrders(false);
        });
    } else {
      setSoNumber('');
      setCantidad('');
      setNotas('');
      setOdooOrders([]);
      setMatchingOrders([]);
      setError(null);
    }
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

    setIsProcessing(true);
    setError(null);

    try {
      const dataUrl = await fetchPdfAsDataUrl(drawing.pdfUrl);

      const now = new Date();
      const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      await openStampedPlanoOt(dataUrl, {
        soNumber: soNumber.trim() || 'N/A',
        cantidad: cantidad.trim() || 'N/A',
        fecha,
        notas: notas.trim(),
      });

      setSoNumber('');
      setCantidad('');
      setNotas('');
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar el PDF para impresión.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer size={18} className="text-primary" />
            Imprimir Plano
          </DialogTitle>
          <DialogDescription>
            {drawing?.partNumber} - Rev {drawing?.revision}
            <br />
            Agrega información del reporte antes de imprimir para el taller.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {matchingOrders.length > 0 && (
            <div className="space-y-2 rounded-md bg-secondary/30 p-3 border border-secondary/50">
              <p className="text-xs font-semibold text-secondary-foreground flex items-center gap-1.5">
                <Sparkles size={12} className="text-primary" /> Sugerencias de Odoo
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {matchingOrders.map((match) => (
                  <Button
                    key={match.order.id}
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      setSoNumber(match.order.name);
                      setCantidad(match.qty.toString());
                    }}
                    disabled={isProcessing}
                  >
                    {match.order.name} ({match.qty} pzs)
                  </Button>
                ))}
              </div>
            </div>
          )}

          {isLoadingOrders && matchingOrders.length === 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Buscando órdenes en Odoo...
            </p>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Número de Orden (SO)
            </label>
            <Input
              value={soNumber}
              onChange={(e) => setSoNumber(e.target.value)}
              placeholder="Ej. 2026/S00781"
              disabled={isProcessing}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Cantidad de Piezas
            </label>
            <Input
              type="number"
              min="1"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              placeholder="Ej. 50"
              disabled={isProcessing}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Notas Adicionales (Aparecerán en el PDF)
            </label>
            <Input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder='Ej. "Cuidado con el acabado aquí"'
              disabled={isProcessing}
            />
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isProcessing}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" /> Preparando PDF...
                </>
              ) : (
                <>
                  <Printer size={16} className="mr-2" />
                  Imprimir
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
