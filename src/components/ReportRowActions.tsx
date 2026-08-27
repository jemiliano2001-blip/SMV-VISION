/**
 * Menú overflow de acciones por fila del Audit Dashboard.
 */

import type { ReactElement } from 'react';
import {
  Crop,
  ShoppingCart,
  Sparkles,
  Loader2,
  Box,
  History,
  Link2,
  MoreHorizontal,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { canGenerateAiIsometric } from '../lib/generateIsometricImage';
import type { Order } from '../types';

export interface ReportRowActionsProps {
  order: Order;
  isExtracting: boolean;
  isAiGenerating: boolean;
  onEncuadre: () => void;
  onComprar: () => void;
  onAiIso: () => void;
  onStl: () => void;
  onHistorial: () => void;
  onVincular: () => void;
}

export function ReportRowActions({
  order,
  isExtracting,
  isAiGenerating,
  onEncuadre,
  onComprar,
  onAiIso,
  onStl,
  onHistorial,
  onVincular,
}: ReportRowActionsProps): ReactElement {
  const showEncuadre = Boolean(order.sourceImageDataUrl);
  const showAi = canGenerateAiIsometric(order);
  const showStl = Boolean(order.matchedStlUrl);
  const showHistorial = Boolean(order.matchedDrawingId);
  const showVincular = !order.matchedDrawingId && !order.sourcePdfName;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 border-2 border-line bg-surface text-ink px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-wider hover:bg-surface-2 hover:border-accent hover:text-accent transition-colors outline-none"
        title="Más acciones"
      >
        <MoreHorizontal size={12} />
        Acciones
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[160px] rounded-none border-2 border-line bg-surface p-1 shadow-hard-accent text-ink"
      >
        {showEncuadre && (
          <DropdownMenuItem
            className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer hover:bg-surface-2 hover:text-accent"
            onClick={onEncuadre}
          >
            <Crop size={12} className="mr-1.5" />
            Encuadre
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer hover:bg-surface-2 hover:text-accent"
          onClick={onComprar}
        >
          <ShoppingCart size={12} className="mr-1.5" />
          Comprar
        </DropdownMenuItem>
        {showAi && (
          <DropdownMenuItem
            className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer hover:bg-surface-2 hover:text-accent"
            disabled={isExtracting || isAiGenerating}
            onClick={onAiIso}
          >
            {isAiGenerating ? <Loader2 size={12} className="animate-spin mr-1.5 text-accent" /> : <Sparkles size={12} className="mr-1.5 text-accent" />}
            {order.isometricSource === 'ai-generated' ? 'Regen 3D' : '3D IA'}
          </DropdownMenuItem>
        )}
        {showStl && (
          <DropdownMenuItem
            className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer hover:bg-surface-2 hover:text-accent"
            onClick={onStl}
          >
            <Box size={12} className="mr-1.5" />
            Ver 3D
          </DropdownMenuItem>
        )}
        {showHistorial && (
          <DropdownMenuItem
            className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer hover:bg-surface-2 hover:text-accent"
            onClick={onHistorial}
          >
            <History size={12} className="mr-1.5" />
            Historial
          </DropdownMenuItem>
        )}
        {showVincular && (
          <DropdownMenuItem
            className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer hover:bg-surface-2 hover:text-accent"
            onClick={onVincular}
          >
            <Link2 size={12} className="mr-1.5" />
            Vincular plano
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
