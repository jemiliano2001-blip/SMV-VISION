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
        className="inline-flex items-center gap-1 border-2 border-black bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wider hover:bg-black hover:text-white transition-colors"
        title="Más acciones"
      >
        <MoreHorizontal size={12} />
        Acciones
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[160px] rounded-none border-2 border-black bg-white p-1 shadow-[4px_4px_0_#000] text-black"
      >
        {showEncuadre && (
          <DropdownMenuItem
            className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer"
            onClick={onEncuadre}
          >
            <Crop size={12} />
            Encuadre
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer"
          onClick={onComprar}
        >
          <ShoppingCart size={12} />
          Comprar
        </DropdownMenuItem>
        {showAi && (
          <DropdownMenuItem
            className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer"
            disabled={isExtracting || isAiGenerating}
            onClick={onAiIso}
          >
            {isAiGenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {order.isometricSource === 'ai-generated' ? 'Regen 3D' : '3D IA'}
          </DropdownMenuItem>
        )}
        {showStl && (
          <DropdownMenuItem
            className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer"
            onClick={onStl}
          >
            <Box size={12} />
            Ver 3D
          </DropdownMenuItem>
        )}
        {showHistorial && (
          <DropdownMenuItem
            className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer"
            onClick={onHistorial}
          >
            <History size={12} />
            Historial
          </DropdownMenuItem>
        )}
        {showVincular && (
          <DropdownMenuItem
            className="rounded-none font-mono text-[10px] uppercase tracking-wider cursor-pointer"
            onClick={onVincular}
          >
            <Link2 size={12} />
            Vincular plano
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
