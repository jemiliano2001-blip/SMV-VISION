/**
 * src/hooks/useIndustrialHotkeys.ts
 *
 * Hook para atajos de teclado de taller (industrial hotkeys).
 * Optimiza la velocidad de operación en planta permitiendo alternar
 * modos de edición, exportar PDFs, cerrar visores y navegar entre vistas.
 */

import { useEffect } from 'react';

export interface IndustrialHotkeysOptions {
  activeView: string;
  onToggleEdit?: () => void;
  onExportPdf?: () => void;
  onNavigate?: (view: string) => void;
  onEscape?: () => void;
  enabled?: boolean;
}

function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

export function useIndustrialHotkeys({
  activeView,
  onToggleEdit,
  onExportPdf,
  onNavigate,
  onEscape,
  enabled = true,
}: IndustrialHotkeysOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape siempre funciona, incluso dentro de inputs
      if (event.key === 'Escape') {
        onEscape?.();
        return;
      }

      // Si el usuario está escribiendo en un input, no capturar letras simples
      const inInput = isInputElement(event.target);

      // Ctrl+P / Cmd+P para exportar PDF del reporte cuando está en reporte
      if ((event.ctrlKey || event.metaKey) && (event.key === 'p' || event.key === 'P')) {
        if (activeView === 'reporte' && onExportPdf) {
          event.preventDefault();
          onExportPdf();
          return;
        }
      }

      if (inInput || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      // Atajos de una sola tecla (solo cuando no hay foco en inputs)
      switch (event.key.toLowerCase()) {
        case 'e': {
          if (activeView === 'reporte' && onToggleEdit) {
            event.preventDefault();
            onToggleEdit();
          }
          break;
        }
        case '1': {
          onNavigate?.('inicio');
          break;
        }
        case '2': {
          onNavigate?.('reporte');
          break;
        }
        case '3': {
          onNavigate?.('odoo');
          break;
        }
        case '4': {
          onNavigate?.('biblioteca');
          break;
        }
        case '5': {
          onNavigate?.('compras');
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, activeView, onToggleEdit, onExportPdf, onNavigate, onEscape]);
}
