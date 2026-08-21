import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { ShoppingCart, Check, AlertCircle, Loader2 } from 'lucide-react';
import { createPurchase } from '../lib/firebase/purchases';
import type { PurchaseItemType } from '../types';

export interface QuickPurchaseModalProps {
  open: boolean;
  onClose: () => void;
  defaultData?: {
    soNumber?: string;
    poNumber?: string;
    pieza?: string;
    numeroParte?: string;
    cantidad?: number | string;
    material?: string | null;
  } | null;
  onSuccess?: (createdId: string) => void;
}

const COMMON_PROVEEDORES = [
  'Aceros y Metales',
  'McMaster-Carr',
  'Misumi',
  'Grainger',
  'Fastenal',
  'Aluminio Especializado',
];

export function QuickPurchaseModal({
  open,
  onClose,
  defaultData,
  onSuccess,
}: QuickPurchaseModalProps) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<PurchaseItemType>('metal');
  const [sku, setSku] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [link, setLink] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && defaultData) {
      const mat = defaultData.material ? `${defaultData.material} ` : '';
      const partLabel = defaultData.numeroParte || defaultData.pieza || 'Pieza';
      setNombre(`${mat}para ${partLabel} (SO ${defaultData.soNumber || '—'})`);
      setSku(defaultData.numeroParte || '');
      setTipo(defaultData.material ? 'metal' : 'metal');
      setProveedor('');
      setLink('');

      const noteParts: string[] = [];
      if (defaultData.soNumber) noteParts.push(`SO: ${defaultData.soNumber}`);
      if (defaultData.poNumber) noteParts.push(`PO: ${defaultData.poNumber}`);
      if (defaultData.cantidad) noteParts.push(`Cantidad requerida: ${defaultData.cantidad} pzas`);
      if (defaultData.pieza) noteParts.push(`Pieza: ${defaultData.pieza}`);
      setNotas(noteParts.join(' · '));
      setError(null);
    }
  }, [open, defaultData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) {
      setError('El nombre del material o pieza es obligatorio.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await createPurchase({
        nombre: nombre.trim(),
        tipo,
        sku: sku.trim(),
        proveedor: proveedor.trim(),
        link: link.trim(),
        notas: notas.trim(),
      });

      if (res.ok) {
        if (onSuccess) onSuccess(res.value.id);
        onClose();
      } else {
        const reason = 'reason' in res ? (res as { reason: string }).reason : 'write-failed';
        setError(
          reason === 'not-authenticated'
            ? 'Debes iniciar sesión para guardar compras.'
            : reason === 'not-configured'
              ? 'Firebase no está configurado.'
              : 'Error al registrar la compra en la base de datos.',
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-surface border-2 border-line p-0 overflow-hidden shadow-hard text-ink">
        <DialogHeader className="px-6 py-4 border-b-2 border-line bg-[#0D2B4D] text-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-accent text-bg flex items-center justify-center font-bold">
              <ShoppingCart size={18} />
            </div>
            <div>
              <DialogTitle className="font-display font-black text-xl uppercase tracking-tight">
                Requisición Rápida de Material
              </DialogTitle>
              <p className="font-mono text-[10px] opacity-75 uppercase tracking-widest">
                Envía material directo al catálogo de Compras
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-2.5 bg-danger/10 border border-danger/40 text-danger text-xs font-mono">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Nombre / Descripción */}
          <div className="space-y-1">
            <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim">
              Material o Pieza Requerida *
            </label>
            <input
              type="text"
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Redondo D2 1.5 pulg x 100mm"
              className="w-full bg-surface border-2 border-line px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-accent uppercase"
            />
          </div>

          {/* Tipo y SKU */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                Tipo de Compra
              </label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as PurchaseItemType)}
                className="w-full bg-surface border-2 border-line px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-accent uppercase cursor-pointer"
              >
                <option value="metal">Metal / Barra / Placa</option>
                <option value="ensamble">Ensamble / Componente</option>
                <option value="herramienta">Herramienta / Cortador</option>
                <option value="otro">Otro</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                SKU / Código de Parte
              </label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Ej. 90-1012-05"
                className="w-full bg-surface border-2 border-line px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-accent uppercase"
              />
            </div>
          </div>

          {/* Proveedor y Link */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                Proveedor Sugerido
              </label>
              <input
                type="text"
                list="proveedores-list"
                value={proveedor}
                onChange={(e) => setProveedor(e.target.value)}
                placeholder="Ej. McMaster-Carr"
                className="w-full bg-surface border-2 border-line px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-accent uppercase"
              />
              <datalist id="proveedores-list">
                {COMMON_PROVEEDORES.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1">
              <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                Enlace / Cotización (URL)
              </label>
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://..."
                className="w-full bg-surface border-2 border-line px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Notas y Trazabilidad */}
          <div className="space-y-1">
            <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim">
              Notas y Trazabilidad SO / PO
            </label>
            <textarea
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Detalles adicionales, medidas, urgencia…"
              className="w-full bg-surface border-2 border-line p-2 font-mono text-xs text-ink focus:outline-none focus:border-accent resize-none"
            />
          </div>

          <DialogFooter className="pt-3 border-t border-line flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-[11px] font-black uppercase tracking-wider h-9"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-accent text-bg border-2 border-accent hover:bg-accent/80 text-[11px] font-black uppercase tracking-wider h-9 shadow-hard flex items-center gap-1.5"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {saving ? 'Guardando…' : 'Crear Requisición'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
