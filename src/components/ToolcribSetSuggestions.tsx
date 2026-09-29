import { Sparkles, X } from 'lucide-react';
import type { SetSuggestion } from '../lib/toolcribSetSuggestions';

export interface ToolcribSetSuggestionsProps {
  suggestions: SetSuggestion[];
  onAccept: (suggestion: SetSuggestion) => void;
  onDismiss: (suggestion: SetSuggestion) => void;
}

export function ToolcribSetSuggestions({ suggestions, onAccept, onDismiss }: ToolcribSetSuggestionsProps) {
  if (suggestions.length === 0) return null;
  const visible = suggestions.slice(0, 5);
  return (
    <div className="border-2 border-accent/40 bg-accent/10 p-3 space-y-2" role="region" aria-label="Sugerencias de juegos">
      <p className="text-[10px] font-mono font-black uppercase tracking-wider text-accent flex items-center gap-1.5">
        <Sparkles size={12} /> Posibles juegos ({suggestions.length})
      </p>
      {visible.map((suggestion) => (
        <div key={suggestion.root} className="flex items-center justify-between gap-2 text-[11px] font-mono">
          <span className="truncate">{suggestion.partNumbers.join(' + ')}</span>
          <span className="flex gap-1.5 shrink-0">
            <button type="button" onClick={() => onAccept(suggestion)} className="px-2 py-0.5 border-2 border-accent text-accent font-black uppercase text-[9px] hover:bg-accent hover:text-bg">Revisar</button>
            <button type="button" aria-label={`Descartar ${suggestion.root}`} onClick={() => onDismiss(suggestion)} className="px-1 border-2 border-line text-ink-dim hover:text-danger"><X size={11} /></button>
          </span>
        </div>
      ))}
    </div>
  );
}
