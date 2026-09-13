import type { ReactElement } from 'react';
import { Code, Copy, Check } from 'lucide-react';
import type { SpeedsFeedsState } from './useSpeedsFeedsState';

interface GcodePanelProps {
  state: SpeedsFeedsState;
}

/** Plantilla de G-Code Haas de referencia + botón de copiar. */
export function GcodePanel({ state }: GcodePanelProps): ReactElement {
  const { operationMode, haasGcode, copiedGcode, handleCopyGcode } = state;

  return (
    <div className="border-2 border-line bg-surface p-4 shadow-hard">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink flex items-center gap-1.5">
          <Code size={14} className="text-accent" />
          Plantilla G-Code Haas CNC ({operationMode === 'turning' ? 'Torno G71' : 'Fresa Setup'})
        </h4>
        <button
          type="button"
          onClick={handleCopyGcode}
          className="cursor-pointer px-3 py-1 bg-accent text-bg text-[10px] font-mono font-black uppercase border-2 border-accent hover:bg-accent/80 flex items-center gap-1.5 shadow-sm"
        >
          {copiedGcode ? <Check size={12} /> : <Copy size={12} />}
          {copiedGcode ? 'Copiado al Portapapeles' : 'Copiar G-Code'}
        </button>
      </div>
      <pre className="bg-[#0D2B4D] text-emerald-300 p-3.5 font-mono text-[11px] leading-relaxed border border-line overflow-x-auto max-h-56 select-all">
        {haasGcode}
      </pre>
    </div>
  );
}
