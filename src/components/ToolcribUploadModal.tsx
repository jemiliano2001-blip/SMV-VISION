import { useState, useEffect } from 'react';
import { UploadCloud, Loader2, AlertCircle, X } from 'lucide-react';
import { uploadDrawingPdf, createPartAndDrawing } from '../lib/firebase/toolcrib';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

export interface ToolcribUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialPartNumber?: string;
  initialCustomer?: string;
  initialDescription?: string;
}

export function ToolcribUploadModal({ isOpen, onClose, onSuccess, initialPartNumber, initialCustomer, initialDescription }: ToolcribUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [partNumber, setPartNumber] = useState(initialPartNumber || '');
  const [customer, setCustomer] = useState(initialCustomer || 'SUPRAJIT');
  const [description, setDescription] = useState(initialDescription || '');
  const [revision, setRevision] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFile(null);
      setPartNumber(initialPartNumber || '');
      setCustomer(initialCustomer || 'SUPRAJIT');
      setDescription(initialDescription || '');
      setRevision('');
      setError(null);
      setIsUploading(false);
    }
  }, [isOpen, initialPartNumber, initialCustomer, initialDescription]);

  const handleOpenChange = (open: boolean) => {
    if (!open && !isUploading) {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !partNumber || !revision || !customer) {
      setError('Por favor completa todos los campos requeridos y selecciona un PDF.');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const uploadRes = await uploadDrawingPdf(file, customer.trim(), partNumber.trim(), revision.trim());
      if (!uploadRes.ok) {
        throw new Error('Falló al subir el PDF a Storage. Verifica permisos o red.');
      }

      const createRes = await createPartAndDrawing({
        partNumber: partNumber.trim().toUpperCase(),
        customer: customer.trim().toUpperCase(),
        description: description.trim(),
        revision: revision.trim().toUpperCase(),
        pdfUrl: uploadRes.value,
        sourceType: 'storage',
        sourcePath: `Upload UI: ${file.name}`,
        isActive: true,
      });

      if (!createRes.ok) {
        throw new Error('Falló al guardar metadatos en Firestore.');
      }

      setFile(null);
      setPartNumber('');
      setDescription('');
      setRevision('');
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-lg bg-surface border-2 border-line p-0 overflow-hidden shadow-hard-accent text-ink rounded-none flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between px-5 py-3 border-b-2 border-line bg-[#0D2B4D] text-white shrink-0 space-y-0">
          <div className="flex items-center gap-3">
            <div className="size-8 bg-accent text-bg flex items-center justify-center font-bold">
              <UploadCloud size={16} />
            </div>
            <div>
              <DialogTitle className="font-display text-lg font-black uppercase tracking-tight m-0 text-white">
                Subir Nuevo Plano
              </DialogTitle>
              <DialogDescription className="font-mono text-[10px] text-white/70 uppercase tracking-widest m-0">
                Tool Crib · Catálogo de planos
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-none border-2 border-white/40 bg-transparent text-white hover:bg-accent hover:border-accent hover:text-bg transition-colors"
            title="Cerrar (ESC)"
          >
            <X size={14} />
          </Button>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 border-2 border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                Cliente <span className="text-accent">*</span>
              </label>
              <Input
                required
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                disabled={isUploading || !!initialCustomer}
                className="w-full border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none uppercase"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                Revisión <span className="text-accent">*</span>
              </label>
              <Input
                required
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder="Ej. A, B, 1, 2"
                className="w-full border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none uppercase"
                disabled={isUploading}
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
              Número de Parte <span className="text-accent">*</span>
            </label>
            <Input
              required
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
              placeholder="Ej. D7PT-19E525-AA"
              className="w-full border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none uppercase"
              disabled={isUploading || !!initialPartNumber}
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
              Descripción
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Breve descripción de la pieza"
              disabled={isUploading}
              className="w-full border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
              Archivo PDF <span className="text-accent">*</span>
            </label>
            <input
              type="file"
              accept=".pdf"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full border-2 border-line bg-surface-2 text-ink px-3 py-2 text-[12px] font-mono outline-none file:mr-3 file:py-1 file:px-2 file:border-2 file:border-line file:bg-surface file:text-ink file:text-[10px] file:font-black file:uppercase file:cursor-pointer hover:file:border-accent hover:file:text-accent cursor-pointer"
              disabled={isUploading}
            />
          </div>

          <DialogFooter className="pt-2 flex justify-end gap-2 border-t-2 border-line mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isUploading}
              className="border-2 border-line text-ink font-black uppercase text-[10px] tracking-widest hover:bg-surface-2 hover:text-ink transition-colors rounded-none h-9 px-4"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isUploading}
              className="bg-accent text-bg px-6 h-9 text-[10px] font-black uppercase tracking-widest hover:bg-accent/80 transition-colors shadow-hard active:translate-x-0.5 active:translate-y-0.5 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 rounded-none flex items-center gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Guardando…
                </>
              ) : (
                'Subir Plano'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
