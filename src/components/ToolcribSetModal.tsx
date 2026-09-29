import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { deleteSet, saveSet } from '../lib/firebase/toolcribSets';
import { MAX_SET_MEMBERS, setPartKey, type ToolcribSet, type ToolcribSetMember, type ToolcribSetType } from '../lib/toolcribSets';

const TYPE_LABELS: Record<ToolcribSetType, string> = {
  par: 'Par (piezas distintas que se piden juntas)',
  hoja: 'Hojas de un mismo plano',
  complemento: 'Complemento',
  variante: 'Variante',
};

export interface ToolcribSetModalProps {
  open: boolean;
  /** Números de parte precargados (sugerencia o pieza desde la que se abrió). */
  initialMembers: string[];
  /** Juego existente que se edita; null = juego nuevo. */
  initialSet: ToolcribSet | null;
  /** Números de parte del catálogo, para elegir hermanos. */
  catalogParts: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function ToolcribSetModal({ open, initialMembers, initialSet, catalogParts, onClose, onSaved }: ToolcribSetModalProps) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<ToolcribSetType>('par');
  const [miembros, setMiembros] = useState<ToolcribSetMember[]>([]);
  const [nuevo, setNuevo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNuevo('');
    if (initialSet) {
      setNombre(initialSet.nombre);
      setTipo(initialSet.tipo);
      setMiembros(initialSet.miembros.map((m) => ({ ...m })));
    } else {
      setNombre(initialMembers[0] ?? '');
      setTipo('par');
      setMiembros(
        initialMembers.map((partNumber, index) => ({ partNumber: setPartKey(partNumber), rol: '', orden: index + 1, cantidadPorJuego: 1 })),
      );
    }
  }, [open, initialMembers, initialSet]);

  const update = (index: number, patch: Partial<ToolcribSetMember>) =>
    setMiembros((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  const addMember = () => {
    const key = setPartKey(nuevo);
    if (!key) return;
    if (miembros.some((m) => m.partNumber === key)) {
      setError('Esa pieza ya está en el juego.');
      return;
    }
    if (miembros.length >= MAX_SET_MEMBERS) {
      setError(`Máximo ${MAX_SET_MEMBERS} piezas por juego.`);
      return;
    }
    setError(null);
    setMiembros((prev) => [...prev, { partNumber: key, rol: '', orden: prev.length + 1, cantidadPorJuego: 1 }]);
    setNuevo('');
  };

  const handleSave = async () => {
    if (miembros.length < 2) {
      setError('Un juego necesita al menos 2 piezas.');
      return;
    }
    if (miembros.some((m) => !Number.isInteger(m.cantidadPorJuego) || m.cantidadPorJuego < 1 || m.cantidadPorJuego > 99)) {
      setError('Piezas por juego debe ser un entero de 1 a 99.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await saveSet({
      id: initialSet?.id,
      nombre: nombre.trim() || miembros[0].partNumber,
      tipo,
      miembros: miembros.map((m, index) => ({ ...m, rol: m.rol.trim() || m.partNumber, orden: index + 1 })),
    });
    setBusy(false);
    if (res.ok === false) {
      setError(`No se pudo guardar el juego (${res.reason}).`);
      return;
    }
    onSaved();
    onClose();
  };

  const handleDelete = async () => {
    if (!initialSet) return;
    setBusy(true);
    const res = await deleteSet(initialSet.id);
    setBusy(false);
    if (res.ok === false) {
      setError(`No se pudo borrar el juego (${res.reason}).`);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg bg-surface border-2 border-line rounded-none text-ink">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest">
            {initialSet ? 'Editar juego' : 'Vincular como juego'}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-ink-dim">
            Piezas que se piden juntas. Al imprimir una, se ofrece imprimir las demás, cada una con su propia OT.
          </DialogDescription>
        </DialogHeader>

        {error && <p role="alert" className="border-2 border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger">{error}</p>}

        <div className="space-y-3">
          <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim">
            Nombre del juego
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={busy} className="mt-1 rounded-none border-2 border-line bg-surface-2 h-9 text-[12px] font-mono" />
          </label>

          <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim">
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as ToolcribSetType)} disabled={busy} className="mt-1 w-full h-9 border-2 border-line bg-surface-2 text-[12px] font-mono px-2 rounded-none">
              {(Object.keys(TYPE_LABELS) as ToolcribSetType[]).map((key) => (
                <option key={key} value={key}>{TYPE_LABELS[key]}</option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-ink-dim">Piezas (en orden de impresión)</p>
            {miembros.map((m, index) => (
              <div key={m.partNumber} className="grid grid-cols-[1fr_1fr_64px_32px] gap-2 items-center">
                <span className="font-mono text-xs font-bold truncate" title={m.partNumber}>{m.partNumber}</span>
                <Input aria-label={`Rol de ${m.partNumber}`} value={m.rol} onChange={(e) => update(index, { rol: e.target.value })} placeholder="Ej. Mitad Chica" disabled={busy} className="rounded-none border-2 border-line bg-surface-2 h-8 text-[11px] font-mono" />
                <Input aria-label={`Cantidad por juego de ${m.partNumber}`} type="number" min={1} max={99} value={m.cantidadPorJuego} onChange={(e) => update(index, { cantidadPorJuego: Number(e.target.value) })} disabled={busy} className="rounded-none border-2 border-line bg-surface-2 h-8 text-[11px] font-mono" />
                <button type="button" aria-label={`Quitar ${m.partNumber}`} onClick={() => setMiembros((prev) => prev.filter((_, i) => i !== index))} disabled={busy} className="text-ink-dim hover:text-danger">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <p className="text-[9px] font-mono text-ink-dim">La columna numérica es "piezas por juego" (1 = una por cada juego pedido).</p>
          </div>

          <div className="flex gap-2">
            <Input list="set-modal-parts" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Agregar pieza del catálogo…" disabled={busy} className="rounded-none border-2 border-line bg-surface-2 h-9 text-[12px] font-mono" />
            <datalist id="set-modal-parts">{catalogParts.map((p) => <option key={p} value={p} />)}</datalist>
            <Button type="button" variant="outline" onClick={addMember} disabled={busy} className="rounded-none border-2 border-line h-9 text-[10px] font-black uppercase">Agregar</Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {initialSet && <Button type="button" variant="outline" onClick={handleDelete} disabled={busy} className="rounded-none border-2 border-danger/60 text-danger h-9 text-[10px] font-black uppercase mr-auto">Borrar juego</Button>}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="rounded-none border-2 border-line h-9 text-[10px] font-black uppercase">Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={busy} className="rounded-none bg-accent text-bg h-9 text-[10px] font-black uppercase flex items-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin" />} Guardar juego
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
