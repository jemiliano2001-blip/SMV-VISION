import { useEffect, useRef, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { savePartNotes } from '../lib/firebase/partNotes';
import { MAX_NOTE_LENGTH, MAX_NOTES_PER_PART, type PartNote } from '../lib/partNotes';

export interface ToolcribNotesModalProps {
  partNumber: string | null;
  notes: PartNote[];
  onClose: () => void;
  onSaved: () => void;
}

let noteIdCounter = 0;

export function ToolcribNotesModal({ partNumber, notes, onClose, onSaved }: ToolcribNotesModalProps) {
  const [draft, setDraft] = useState<PartNote[]>([]);
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El borrador se siembra solo al abrir para una pieza (cambia partNumber). Depender de `notes`
  // lo reiniciaría en cada render del padre (`?? []` crea un arreglo nuevo) y borraría lo escrito.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => {
    setDraft(notesRef.current.map((n) => ({ ...n })));
    setTexto('');
    setError(null);
  }, [partNumber]);

  const add = () => {
    const value = texto.trim();
    if (!value) return;
    if (draft.length >= MAX_NOTES_PER_PART) {
      setError(`Máximo ${MAX_NOTES_PER_PART} notas por pieza.`);
      return;
    }
    setError(null);
    setDraft((prev) => [...prev, { id: `n${Date.now().toString(36)}${(noteIdCounter++).toString(36)}`, texto: value.slice(0, MAX_NOTE_LENGTH), imprimirEnOT: true }]);
    setTexto('');
  };

  const handleSave = async () => {
    if (!partNumber) return;
    setBusy(true);
    const res = await savePartNotes(partNumber, draft);
    setBusy(false);
    if (res.ok === false) {
      setError(`No se pudieron guardar las notas (${res.reason}).`);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Dialog open={partNumber !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg bg-surface border-2 border-line rounded-none text-ink">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest">Notas de {partNumber}</DialogTitle>
          <DialogDescription className="text-[11px] text-ink-dim">
            Se guardan con la pieza. Las marcadas "en OT" aparecen precargadas al imprimir.
          </DialogDescription>
        </DialogHeader>

        {error && <p role="alert" className="border-2 border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger">{error}</p>}

        <div className="space-y-2">
          {draft.length === 0 && <p className="text-[11px] font-mono text-ink-dim">Sin notas todavía.</p>}
          {draft.map((note, index) => (
            <div key={note.id} className="flex items-start gap-2 border-2 border-line bg-surface-2 p-2">
              <p className="flex-1 text-xs font-mono">{note.texto}</p>
              <label className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase whitespace-nowrap">
                <input type="checkbox" checked={note.imprimirEnOT} onChange={(e) => setDraft((prev) => prev.map((n, i) => (i === index ? { ...n, imprimirEnOT: e.target.checked } : n)))} className="accent-accent" />
                en OT
              </label>
              <button type="button" aria-label="Quitar nota" onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))} className="text-ink-dim hover:text-danger"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input aria-label="Nueva nota" value={texto} maxLength={MAX_NOTE_LENGTH} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder='Ej. "Usar inserto X"' disabled={busy} className="rounded-none border-2 border-line bg-surface-2 h-9 text-[12px] font-mono" />
            <Button type="button" variant="outline" onClick={add} disabled={busy} className="rounded-none border-2 border-line h-9 text-[10px] font-black uppercase">Agregar</Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="rounded-none border-2 border-line h-9 text-[10px] font-black uppercase">Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={busy} className="rounded-none bg-accent text-bg h-9 text-[10px] font-black uppercase flex items-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin" />} Guardar notas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
