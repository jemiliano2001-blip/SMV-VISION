import { useState, useEffect } from 'react';
import { UploadCloud, Loader2, AlertCircle } from 'lucide-react';
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud size={18} className="text-primary" />
            Subir Nuevo Plano
          </DialogTitle>
          <DialogDescription>
            Sube un nuevo PDF y asignalo a un número de parte y revisión.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Cliente <span className="text-destructive">*</span>
            </label>
            <Input
              required
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              disabled={isUploading || !!initialCustomer}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Número de Parte <span className="text-destructive">*</span>
            </label>
            <Input
              required
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
              placeholder="Ej. D7PT-19E525-AA"
              className="uppercase"
              disabled={isUploading || !!initialPartNumber}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Revisión <span className="text-destructive">*</span>
            </label>
            <Input
              required
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              placeholder="Ej. A, B, 1, 2"
              className="uppercase"
              disabled={isUploading}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Descripción
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Breve descripción de la parte"
              disabled={isUploading}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Archivo PDF <span className="text-destructive">*</span>
            </label>
            <Input
              type="file"
              accept=".pdf"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="cursor-pointer file:text-primary file:font-medium"
              disabled={isUploading}
            />
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isUploading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" /> Guardando...
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
