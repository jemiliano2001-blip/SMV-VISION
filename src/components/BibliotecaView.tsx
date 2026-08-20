/**
 * BibliotecaView — destino de primer nivel para navegar/imprimir el catálogo
 * Tool Crib. Reutiliza `ToolcribLibraryPanel` SIN `onAttachDrawing`, por lo que
 * el panel queda en modo solo navegar/imprimir (no adjunta al análisis).
 */

import type { ReactElement } from 'react';
import { Library } from 'lucide-react';

import { ToolcribLibraryPanel } from './ToolcribLibraryPanel';
import type { OrderDrawingLink, ToolcribActiveDrawingView } from '../types';

export interface BibliotecaViewProps {
  searchPrefill?: string;
  pendingLink?: OrderDrawingLink | null;
  onUseDrawingForPending?: (view: ToolcribActiveDrawingView) => void;
}

export function BibliotecaView({
  searchPrefill = '',
  pendingLink = null,
  onUseDrawingForPending,
}: BibliotecaViewProps): ReactElement {
  const pendingLabel = pendingLink
    ? `${pendingLink.soNumber}${pendingLink.numeroParte ? ` · ${pendingLink.numeroParte}` : ''}`
    : null;

  return (
    <div className="bp-grid-lg min-h-full p-6 lg:p-10 max-w-[1100px]">
      <header className="mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-1">Catálogo Tool Crib</p>
        <h1 className="font-display font-black text-5xl lg:text-6xl uppercase italic tracking-[-2px] leading-none flex items-center gap-4">
          <Library size={44} className="text-accent" /> Biblioteca
        </h1>
        <p className="font-mono text-[11px] text-ink-dim mt-3 max-w-xl">
          Busca planos por número de parte, descripción o revisión. Imprime la revisión activa (queda registrado en el audit log).
          Si hay STL exportado desde eDrawings, abre la vista 3D con el botón <strong>3D</strong>.
        </p>
        {pendingLink && (
          <p className="mt-3 border-2 border-accent bg-accent/10 px-3 py-2 font-mono text-[11px] text-ink max-w-xl">
            Elige un plano y pulsa <strong>Usar para {pendingLabel}</strong> para vincularlo a la orden sin volver a buscar.
          </p>
        )}
      </header>

      <ToolcribLibraryPanel
        excludeIsoForPrint
        initialSearchTerm={searchPrefill}
        pendingLinkLabel={pendingLabel}
        onUseForPendingOrder={onUseDrawingForPending}
      />
    </div>
  );
}
