import { useEffect, useState, type ReactElement } from 'react';
import { History, Printer, Loader2, AlertCircle, Calendar, FileSpreadsheet, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { listPrintLogsForDrawing, type ToolcribPrintLogRecord } from '../lib/firebase/toolcrib';
import { formatRelativeTime } from '../lib/age';
import type { ToolcribActiveDrawingView } from '../types';

export interface ToolcribHistoryModalProps {
  drawing: ToolcribActiveDrawingView | null;
  onClose: () => void;
}

export function ToolcribHistoryModal({
  drawing,
  onClose,
}: ToolcribHistoryModalProps): ReactElement {
  const [logs, setLogs] = useState<ToolcribPrintLogRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = drawing !== null;

  useEffect(() => {
    if (!drawing) {
      setLogs([]);
      setError(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);

    listPrintLogsForDrawing(drawing.drawingId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setLogs(res.value);
        } else {
          setError('No fue posible cargar el historial de impresiones.');
        }
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Error al consultar logs.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [drawing]);

  const totalCopies = logs.reduce((sum, log) => sum + log.copies, 0);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="max-w-lg bg-surface border-2 border-line p-0 overflow-hidden shadow-hard-accent text-ink rounded-none flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between px-5 py-3 border-b-2 border-line bg-[#0D2B4D] text-white shrink-0 space-y-0">
          <div className="flex items-center gap-3">
            <div className="size-8 bg-accent text-bg flex items-center justify-center font-bold">
              <History size={16} />
            </div>
            <div>
              <DialogTitle className="font-display text-lg font-black uppercase tracking-tight m-0 text-white">
                Historial de Impresiones
              </DialogTitle>
              <DialogDescription className="font-mono text-[10px] text-white/70 uppercase tracking-widest m-0">
                {drawing?.partNumber} · Rev {drawing?.revision}
                {drawing?.description && ` · ${drawing.description}`}
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

        <div className="p-5">
          {error && (
            <div className="flex items-start gap-2 border-2 border-danger/60 bg-danger/10 p-3 text-xs text-danger mb-3 font-mono">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-ink-dim">
              <Loader2 size={20} className="animate-spin text-accent" />
              <p className="font-mono text-xs uppercase tracking-widest">Cargando trazabilidad…</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center border-2 border-dashed border-line bg-surface-2 p-6 corner-ticks">
              <Printer size={28} className="mx-auto text-ink-dim opacity-40 mb-2" />
              <p className="font-display font-bold uppercase text-sm">Sin impresiones registradas</p>
              <p className="font-mono text-[11px] text-ink-dim mt-1">
                Este plano aún no tiene registros de impresión de OT en taller.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-surface-2 border-2 border-line p-2.5 px-3">
                <div className="font-mono text-xs text-ink-dim uppercase">
                  Impresiones: <strong className="text-ink font-bold">{logs.length}</strong>
                </div>
                <div className="font-mono text-xs text-ink-dim uppercase">
                  Copias totales: <strong className="text-accent font-bold">{totalCopies}</strong>
                </div>
              </div>

              <div className="max-h-[320px] overflow-y-auto space-y-2 pr-1">
                {logs.map((log) => {
                  const date = log.printedAtUTC ? new Date(log.printedAtUTC) : null;
                  const formattedDate = date
                    ? date.toLocaleDateString('es-MX', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Fecha desconocida';

                  return (
                    <div
                      key={log.id}
                      className="bg-surface border-2 border-line p-3 flex flex-col gap-1.5 hover:border-accent transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-accent">
                          <Printer size={12} />
                          {log.copies} {log.copies === 1 ? 'copia' : 'copias'}
                        </span>
                        <span className="font-mono text-[10px] text-ink-dim">
                          {date ? formatRelativeTime(date) : ''}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono mt-1 pt-1.5 border-t border-line/60">
                        <div className="flex items-center gap-1.5 text-ink min-w-0">
                          <FileSpreadsheet size={11} className="text-ink-dim shrink-0" />
                          <span className="truncate">
                            {log.orderRef ? (
                              <strong className="text-accent">{log.orderRef}</strong>
                            ) : (
                              <span className="text-ink-dim italic">Sin orden ref</span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-1.5 text-ink-dim min-w-0">
                          <Calendar size={11} className="shrink-0" />
                          <span className="truncate">{formattedDate}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
