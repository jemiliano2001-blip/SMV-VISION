/**
 * Alias de taller: le enseña al buscador un apodo para una pieza
 * ("el punzón de la M" → PUNZONES DE MARCA-SUPRAJIT SMV-001).
 *
 * No es una colección nueva: reutiliza `partAliases` (`src/lib/firebase/aliases.ts`),
 * la misma memoria que ya usa el puente orden↔plano de Reporte cuando un
 * operador vincula manualmente una orden de Odoo a un plano. Un alias
 * enseñado aquí (o allá) sirve para ambos flujos.
 */

import { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Tag, X } from 'lucide-react';

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
import { savePartAlias } from '../lib/firebase/aliases';
import { log } from '../lib/log';

export interface ToolcribAliasTarget {
  partNumber: string;
  drawingId: string;
}

export interface ToolcribAliasModalProps {
  target: ToolcribAliasTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ToolcribAliasModal({ target, onClose, onSaved }: ToolcribAliasModalProps) {
  const [pattern, setPattern] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isOpen = target !== null;

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSaving) {
      setPattern('');
      setError(null);
      setSaved(false);
      onClose();
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!target || pattern.trim().length === 0) return;

    setIsSaving(true);
    setError(null);

    const result = await savePartAlias({
      pattern: pattern.trim(),
      partNumber: target.partNumber,
      drawingId: target.drawingId,
    });

    setIsSaving(false);

    if (result.ok === false) {
      log.warn('[smv-vision][toolcrib] savePartAlias falló', result.reason);
      setError(
        result.reason === 'not-authenticated'
          ? 'Necesitas sesión activa para guardar un alias.'
          : 'No fue posible guardar el alias. Intenta de nuevo.',
      );
      return;
    }

    setSaved(true);
    setPattern('');
    onSaved();
    window.setTimeout(() => {
      setSaved(false);
      onClose();
    }, 900);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-md bg-surface border-2 border-line p-0 overflow-hidden shadow-hard-accent text-ink rounded-none flex flex-col"
      >
        <DialogHeader className="flex flex-row items-center justify-between px-5 py-3 border-b-2 border-line bg-[#0D2B4D] text-white shrink-0 space-y-0">
          <div className="flex items-center gap-3">
            <div className="size-8 bg-accent text-bg flex items-center justify-center font-bold">
              <Tag size={16} />
            </div>
            <div>
              <DialogTitle className="font-display text-lg font-black uppercase tracking-tight m-0 text-white">
                Alias de Taller
              </DialogTitle>
              <DialogDescription className="font-mono text-[10px] text-white/70 uppercase tracking-widest m-0">
                {target?.partNumber}
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={onClose}
            disabled={isSaving}
            className="h-8 w-8 rounded-none border-2 border-white/40 bg-transparent text-white hover:bg-accent hover:border-accent hover:text-bg transition-colors"
            title="Cerrar (ESC)"
          >
            <X size={14} />
          </Button>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="font-mono text-[11px] text-ink-dim leading-relaxed">
            Enséñale al buscador cómo le dicen a esta pieza en el taller. La próxima vez que alguien
            escriba ese apodo, esta pieza va a aparecer.
          </p>

          {error && (
            <div className="flex items-start gap-2 border-2 border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {saved && (
            <div className="flex items-center gap-2 border-2 border-ok/60 bg-ok/10 px-3 py-2 text-[11px] font-mono text-ok">
              <CheckCircle2 size={14} className="shrink-0" />
              <span>Alias guardado.</span>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
              Apodo / alias
            </label>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder='Ej. "punzón de la M", "el gavilán chico"'
              disabled={isSaving}
              autoFocus
              className="w-full border-2 border-line bg-surface-2 text-ink h-9 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none"
            />
          </div>

          <DialogFooter className="pt-2 flex justify-end gap-2 border-t-2 border-line mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
              className="border-2 border-line text-ink font-black uppercase text-[10px] tracking-widest hover:bg-surface-2 hover:text-ink transition-colors rounded-none h-9 px-4"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving || pattern.trim().length === 0}
              className="bg-accent text-bg px-6 h-9 text-[10px] font-black uppercase tracking-widest hover:bg-accent/80 transition-colors shadow-hard active:translate-x-0.5 active:translate-y-0.5 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 rounded-none flex items-center gap-2"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} />}
              Guardar Alias
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
