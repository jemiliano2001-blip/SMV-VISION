/**
 * BibliotecaView — destino de primer nivel para navegar/imprimir el catálogo
 * Tool Crib. Reutiliza `ToolcribLibraryPanel` SIN `onAttachDrawing`, por lo que
 * el panel queda en modo solo navegar/imprimir (no adjunta al análisis).
 */

import type { ReactElement } from 'react';
import { Library } from 'lucide-react';

import { ToolcribLibraryPanel } from './ToolcribLibraryPanel';

export function BibliotecaView(): ReactElement {
  return (
    <div className="bp-grid-lg min-h-full p-6 lg:p-10 max-w-[1100px]">
      <header className="mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-1">Catálogo Tool Crib</p>
        <h1 className="font-display font-black text-5xl lg:text-6xl uppercase italic tracking-[-2px] leading-none flex items-center gap-4">
          <Library size={44} className="text-accent" /> Biblioteca
        </h1>
        <p className="font-mono text-[11px] text-ink-dim mt-3 max-w-xl">
          Busca planos por número de parte, descripción o revisión. Imprime la revisión activa (queda registrado en el audit log).
        </p>
      </header>

      <ToolcribLibraryPanel />
    </div>
  );
}
