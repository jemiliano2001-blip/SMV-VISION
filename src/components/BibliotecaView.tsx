/**
 * BibliotecaView — destino de primer nivel para navegar/imprimir el catálogo
 * Tool Crib. Reutiliza `ToolcribLibraryPanel` en modo página (sin adjuntar
 * al análisis): una pieza por fila, CAD+ISO agrupados, lista a viewport.
 */

import type { ReactElement } from 'react';

import { PageFrame } from './shell/PageFrame';
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
    <PageFrame
      title="Biblioteca de planos"
      subtitle="Una fila por pieza: CAD para imprimir OT, ISO para ver/reportar, 3D si hay STL. Imprimir queda en el audit log."
      scrollBody={false}
      notices={
        pendingLink && (
          <div className="shrink-0 px-4 sm:px-6 pt-3">
            <div className="flex items-center gap-3 rounded-xl border border-accent/50 bg-accent/10 px-4 py-3 max-w-2xl">
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
          </div>
        )
      }
    >
      <ToolcribLibraryPanel
        variant="page"
        excludeIsoForPrint
        initialSearchTerm={searchPrefill}
        pendingLinkLabel={pendingLabel}
        onUseForPendingOrder={onUseDrawingForPending}
        onCatalogChanged={onCatalogChanged}
      />
    </PageFrame>
  );
}
