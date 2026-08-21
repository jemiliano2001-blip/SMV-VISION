import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Crop, RotateCcw, Check } from 'lucide-react';
import { cropIsometricView, isValidBoundingBox } from '../lib/imageProcessing';
import type { BoundingBox, Order } from '../types';

export interface CropAdjustModalProps {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onSaveCrop: (order: Order, newBox: BoundingBox, newCroppedUrl: string) => void;
}

export function CropAdjustModal({
  order,
  open,
  onClose,
  onSaveCrop,
}: CropAdjustModalProps) {
  const [box, setBox] = useState<BoundingBox>([100, 100, 900, 900]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Inicializar bounding box con el existente o default
  useEffect(() => {
    if (order) {
      const initialBox: BoundingBox =
        order.isometricBoundingBox && isValidBoundingBox(order.isometricBoundingBox)
          ? order.isometricBoundingBox
          : [100, 100, 900, 900];
      setBox(initialBox);
    }
  }, [order, open]);

  // Actualizar preview en tiempo real al cambiar el box
  useEffect(() => {
    if (!order?.sourceImageDataUrl) return;
    let alive = true;
    cropIsometricView(order.sourceImageDataUrl, box)
      .then((url) => {
        if (alive) setPreviewUrl(url);
      })
      .catch((e) => console.warn('Error generando preview de crop:', e));

    return () => {
      alive = false;
    };
  }, [order?.sourceImageDataUrl, box]);

  const getImageCoordinates = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current) return null;
    const rect = imageRef.current.getBoundingClientRect();
    const clientX = Math.max(rect.left, Math.min(e.clientX, rect.right));
    const clientY = Math.max(rect.top, Math.min(e.clientY, rect.bottom));

    const xRel = ((clientX - rect.left) / rect.width) * 1000;
    const yRel = ((clientY - rect.top) / rect.height) * 1000;

    return {
      x: Math.round(Math.max(0, Math.min(1000, xRel))),
      y: Math.round(Math.max(0, Math.min(1000, yRel))),
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const pt = getImageCoordinates(e);
    if (!pt) return;
    setIsDrawing(true);
    setStartPoint(pt);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !startPoint) return;
    const current = getImageCoordinates(e);
    if (!current) return;

    const xmin = Math.min(startPoint.x, current.x);
    const xmax = Math.max(startPoint.x, current.x);
    const ymin = Math.min(startPoint.y, current.y);
    const ymax = Math.max(startPoint.y, current.y);

    setBox([ymin, xmin, ymax, xmax]);
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setStartPoint(null);
  };

  const handleResetToAi = () => {
    if (order?.isometricBoundingBox) {
      setBox(order.isometricBoundingBox);
    } else {
      setBox([100, 100, 900, 900]);
    }
  };

  const handleSave = async () => {
    if (!order || !order.sourceImageDataUrl) return;
    setSaving(true);
    try {
      const newCroppedUrl = await cropIsometricView(order.sourceImageDataUrl, box);
      onSaveCrop(order, box, newCroppedUrl);
      onClose();
    } catch (err) {
      console.error('Error guardando recorte:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!order || !order.sourceImageDataUrl) return null;

  const [ymin, xmin, ymax, xmax] = box;
  const boxStyle: React.CSSProperties = {
    top: `${(ymin / 1000) * 100}%`,
    left: `${(xmin / 1000) * 100}%`,
    width: `${((xmax - xmin) / 1000) * 100}%`,
    height: `${((ymax - ymin) / 1000) * 100}%`,
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl bg-surface border-2 border-line p-0 overflow-hidden shadow-hard text-ink flex flex-col max-h-[90vh]">
        <DialogHeader className="px-6 py-4 border-b-2 border-line bg-[#0D2B4D] text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-accent text-bg flex items-center justify-center font-bold">
                <Crop size={18} />
              </div>
              <div>
                <DialogTitle className="font-display font-black text-xl uppercase tracking-tight">
                  Editor de Encuadre Isométrico
                </DialogTitle>
                <p className="font-mono text-[10px] opacity-75 uppercase tracking-widest">
                  {order.pieza} · SO: {order.orden}
                </p>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-4 flex-1 min-h-0 divide-y-2 md:divide-y-0 md:divide-x-2 divide-line bg-surface">
          {/* Canvas interactivo para seleccionar el área */}
          <div className="md:col-span-3 p-4 flex flex-col items-center justify-center bg-zinc-950/20 overflow-hidden select-none">
            <p className="font-mono text-[10px] text-ink-dim uppercase tracking-wider mb-2">
              Haz clic y arrastra con el cursor sobre la imagen para definir el encuadre exacto:
            </p>
            <div
              ref={containerRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="relative max-w-full max-h-[60vh] border-2 border-line bg-white shadow-sm cursor-crosshair flex items-center justify-center overflow-hidden"
            >
              <img
                ref={imageRef}
                src={order.sourceImageDataUrl}
                alt="Plano original"
                className="max-w-full max-h-[58vh] object-contain pointer-events-none"
                draggable={false}
              />

              {/* Bounding box interactivo */}
              <div
                style={boxStyle}
                className="absolute border-2 border-accent bg-accent/20 pointer-events-none transition-none shadow-sm"
              >
                <span className="absolute -top-5 left-0 bg-accent text-bg px-1 font-mono text-[9px] font-bold uppercase tracking-wider shadow">
                  Vista 3D ({xmax - xmin}×{ymax - ymin})
                </span>
              </div>
            </div>
          </div>

          {/* Panel Lateral: Vista Previa y Controles */}
          <div className="p-5 flex flex-col justify-between bg-surface-2 space-y-4">
            <div>
              <h4 className="font-mono text-[11px] font-black uppercase tracking-wider text-ink mb-2">
                Vista Previa del Reporte
              </h4>
              <div className="w-full aspect-square border-2 border-line bg-white shadow-sm flex items-center justify-center p-2 overflow-hidden mb-3">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview Recorte"
                    className="max-w-full max-h-full object-contain mix-blend-multiply"
                  />
                ) : (
                  <div className="text-ink-dim font-mono text-[10px] text-center uppercase">
                    Generando preview…
                  </div>
                )}
              </div>
              <p className="font-mono text-[9px] text-ink-dim leading-relaxed">
                El recorte se normaliza automáticamente al tamaño cuadrado y se centra con fondo blanco para la tabla del reporte PDF.
              </p>
            </div>

            <div className="space-y-2 pt-4 border-t border-line">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetToAi}
                className="w-full flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider h-8"
              >
                <RotateCcw size={12} />
                Restablecer a IA
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t-2 border-line bg-surface flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="text-[11px] font-black uppercase tracking-wider h-9"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="bg-accent text-bg border-2 border-accent hover:bg-accent/80 text-[11px] font-black uppercase tracking-wider h-9 shadow-hard flex items-center gap-1.5"
          >
            <Check size={14} />
            {saving ? 'Guardando…' : 'Aplicar Encuadre'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
