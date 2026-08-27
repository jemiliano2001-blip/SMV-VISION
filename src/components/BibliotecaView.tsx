/**
 * BibliotecaView — destino de primer nivel para navegar/imprimir el catálogo
 * Tool Crib. Reutiliza `ToolcribLibraryPanel` en modo página (sin adjuntar
 * al análisis): una pieza por fila, CAD+ISO agrupados, lista a viewport.
 */

import type { ReactElement } from 'react';
import { Library } from 'lucide-react';

import { ToolcribLibraryPanel } from './ToolcribLibraryPanel';
import type { OrderDrawingLink, ToolcribActiveDrawingView } from '../types';

export interface BibliotecaViewProps {
  searchPrefill?: string;
  pendingLink?: OrderDrawingLink | null;
  onUseDrawingForPending?: (view: ToolcribActiveDrawingView) => void;
  onCancelPending?: () => void;
  onCatalogChanged?: () => void;
}

export function BibliotecaView({
  searchPrefill = '',
  pendingLink = null,
  onUseDrawingForPending,
  onCancelPending,
  onCatalogChanged,
}: BibliotecaViewProps): ReactElement {
  const pendingLabel = pendingLink
    ? `${pendingLink.soNumber}${pendingLink.numeroParte ? ` · ${pendingLink.numeroParte}` : ''}`
    : null;

  return (
    <div className="bp-grid-lg h-full min-h-0 flex flex-col p-6 lg:p-8 max-w-[1200px]">
      <header className="mb-4 shrink-0">
        <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-1">Catálogo Tool Crib</p>
        <h1 className="font-display font-black text-4xl lg:text-5xl uppercase italic tracking-[-2px] leading-none flex items-center gap-3">
          <Library size={36} className="text-accent" /> Biblioteca
        </h1>
        <p className="font-mono text-[11px] text-ink-dim mt-2 max-w-2xl">
          Una fila por pieza: CAD para imprimir OT, ISO para ver/reportar, 3D si hay STL.
          Imprimir queda en el audit log.
        </p>
        {pendingLink && (
          <div className="mt-3 flex items-center gap-3 border-2 border-accent bg-accent/10 px-3 py-2 max-w-xl">
            <p className="font-mono text-[11px] text-ink flex-1">
              Elige un plano y pulsa <strong>Usar para {pendingLabel}</strong> para vincularlo a la orden sin volver a buscar.
            </p>
            {onCancelPending && (
              <button
                type="button"
                onClick={onCancelPending}
                className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim hover:text-accent underline"
              >
                Cancelar
              </button>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 flex flex-col">
        <ToolcribLibraryPanel
          variant="page"
          excludeIsoForPrint
          initialSearchTerm={searchPrefill}
          pendingLinkLabel={pendingLabel}
          onUseForPendingOrder={onUseDrawingForPending}
          onCatalogChanged={onCatalogChanged}
        />
      </div>
    </div>
  );
}
