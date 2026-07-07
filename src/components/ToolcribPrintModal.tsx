import { useState, useEffect } from 'react';
import { Printer, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { openStampedPlanoOt } from '../lib/planoOt';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { listOrdersToInvoice, type OdooOrderView } from '../lib/firebase/odooOrders';
import type { ToolcribActiveDrawingView } from '../types';

export interface ToolcribPrintModalProps {
  drawing: ToolcribActiveDrawingView | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ToolcribPrintModal({ drawing, onClose, onSuccess }: ToolcribPrintModalProps) {
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
      // Limpiar cuando se cierra
      setSoNumber('');
      setCantidad('');
      setNotas('');
      setOdooOrders([]);
      setMatchingOrders([]);
      setError(null);
    }
  }, [drawing]);

  useEffect(() => {
    if (drawing && odooOrders.length > 0) {
      const matches: { order: OdooOrderView; qty: number }[] = [];
      const pnLower = drawing.partNumber.toLowerCase();
      
      for (const order of odooOrders) {
        let matchedLine = null;
        for (const line of order.order_lines) {
          if (line.product.toLowerCase().includes(pnLower) || line.description.toLowerCase().includes(pnLower)) {
            matchedLine = line;
            break;
          }
        }
        if (matchedLine) {
          matches.push({
            order,
            qty: matchedLine.qty_pending > 0 ? matchedLine.qty_pending : matchedLine.qty,
          });
        }
      }
      setMatchingOrders(matches);
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
      // 1. Fetch PDF bytes
      const dataUrl = await fetchPdfAsDataUrl(drawing.pdfUrl);

      // 2. Formatear la fecha
      const now = new Date();
      const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // 3. Imprimir el documento (lo sella y abre en nueva pestaña)
      await openStampedPlanoOt(dataUrl, {
        soNumber: soNumber.trim() || 'N/A',
        cantidad: cantidad.trim() || 'N/A',
        fecha,
        notas: notas.trim(),
      });

      // 4. Limpiar y cerrar
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
