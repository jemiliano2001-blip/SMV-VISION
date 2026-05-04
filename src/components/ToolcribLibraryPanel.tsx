/**
 * ToolcribLibraryPanel
 *
 * Panel read-only del catálogo de planos Tool Crib. Permite:
 * - Buscar partes por número o descripción.
 * - Ver la revisión activa emparejada con la parte.
 * - Imprimir / abrir el PDF de la revisión activa (registra audit log).
 * - Adjuntar el PDF al flujo de análisis existente sin re-subirlo cada vez.
 *
 * Principios seguidos (user_rules):
 * - Componente puro: toda la E/S pasa por `src/lib/firebase/toolcrib.ts`.
 * - Manejo silencioso: los errores se muestran como feedback constructivo,
 *   nunca rompen el flujo (no throws).
 * - Modularidad: no acopla la lógica de auditoría al render. El padre
 *   decide qué hacer con los PDFs vía `onAttachDrawing`.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  AlertCircle,
  FileText,
  FolderOpen,
  Loader2,
  Printer,
  RefreshCcw,
  Search,
} from 'lucide-react';

import {
  listActiveDrawingViews,
  recordToolcribPrintLogFireAndForget,
} from '../lib/firebase/toolcrib';
import type { ToolcribActiveDrawingView } from '../types';

export interface ToolcribLibraryPanelProps {}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RowActionState {
  status: 'idle' | 'attaching' | 'printing' | 'error';
  message?: string;
}

const FETCH_TIMEOUT_MS = 30_000;

async function fetchPdfAsDataUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }
        reject(new Error('Lectura de PDF no devolvió un dataURL.'));
      };
      reader.onerror = () => reject(new Error('No fue posible leer el PDF descargado.'));
      reader.readAsDataURL(blob);
    });
  } finally {
    window.clearTimeout(timer);
  }
}

function normalizeSearchTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesSearch(view: ToolcribActiveDrawingView, term: string): boolean {
  if (term.length === 0) {
    return true;
  }
  const haystack = normalizeSearchTerm(
    `${view.partNumber} ${view.description} ${view.revision} ${view.customer}`,
  );
  return haystack.includes(term);
}

function buildDisplayName(view: ToolcribActiveDrawingView): string {
  const base = view.partNumber.trim();
  const revision = view.revision.trim();
  return `${base} (Rev ${revision}).pdf`;
}

export function ToolcribLibraryPanel(_props: ToolcribLibraryPanelProps): ReactElement {
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [views, setViews] = useState<ToolcribActiveDrawingView[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [rowState, setRowState] = useState<Record<string, RowActionState>>({});

  const loadLibrary = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    const result = await listActiveDrawingViews({ customer: 'SUPRAJIT' });
    if (result.ok === false) {
      setStatus('error');
      if (result.reason === 'not-configured') {
        setErrorMessage(
          'Firebase no está configurado. Completa las variables VITE_FIREBASE_* en .env.local para activar la biblioteca Tool Crib.',
        );
      } else if (result.reason === 'not-authenticated') {
        setErrorMessage(
          'La biblioteca Tool Crib requiere sesión activa. Inicia sesión para consultar planos y registrar auditoría.',
        );
      } else {
        setErrorMessage(
          'No fue posible cargar la biblioteca. Verifica tu conexión y permisos.',
        );
      }
      return;
    }
    setViews(result.value);
    setStatus('ready');
  }, []);

  useEffect(() => {
    if (status === 'idle') {
      void loadLibrary();
    }
  }, [loadLibrary, status]);

  const filteredViews = useMemo(() => {
    const term = normalizeSearchTerm(searchTerm);
    if (term.length === 0) {
      return views;
    }
    return views.filter((view) => matchesSearch(view, term));
  }, [searchTerm, views]);

  const handlePrint = useCallback(
    async (view: ToolcribActiveDrawingView) => {
      setRowState((prev) => ({
        ...prev,
        [view.drawingId]: { status: 'printing' },
      }));

      try {
        if (view.pdfUrl) {
          const openedWindow = window.open(view.pdfUrl, '_blank', 'noopener,noreferrer');
          if (!openedWindow) {
            setRowState((prev) => ({
              ...prev,
              [view.drawingId]: {
                status: 'error',
                message:
                  'Tu navegador bloqueó la ventana del PDF. Habilita pop-ups y reintenta.',
              },
            }));
            return;
          }
        }

        recordToolcribPrintLogFireAndForget({
          drawingId: view.drawingId,
          partId: view.partId,
          copies: 1,
          orderRef: null,
        });

        setRowState((prev) => ({
          ...prev,
          [view.drawingId]: { status: 'idle' },
        }));
      } catch (error) {
        console.warn('[smv-vision][toolcrib] handlePrint falló', error);
        setRowState((prev) => ({
          ...prev,
          [view.drawingId]: {
            status: 'error',
            message: 'No fue posible abrir el PDF. Intenta nuevamente.',
          },
        }));
      }
    },
    [],
  );

  const totalCount = views.length;
  const visibleCount = filteredViews.length;
  const isEmpty = status === 'ready' && totalCount === 0;

  return (
    <div className="border-2 border-ink bg-white shadow-[3px_3px_0px_rgba(0,0,0,1)]">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-black uppercase tracking-wider hover:bg-ink hover:text-bg transition-colors"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2">
          <FolderOpen size={14} />
          Biblioteca Tool Crib (planos Suprajit)
        </span>
        <span className="flex items-center gap-2 text-[10px] font-mono">
          {status === 'loading' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : status === 'ready' ? (
            <span className="bg-ink text-bg px-1.5 py-0.5">{totalCount}</span>
          ) : status === 'error' ? (
            <AlertCircle size={12} className="text-accent" />
          ) : null}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-ink p-3 space-y-3">
          <div className="flex items-center gap-2">
            <div className="grow flex items-center gap-2 border border-ink/30 px-2 py-1 bg-[#F4F4F4]">
              <Search size={12} className="text-ink/50 shrink-0" />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar parte, descripción o revisión…"
                className="grow bg-transparent outline-none text-[11px] font-mono"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadLibrary()}
              disabled={status === 'loading'}
              className="shrink-0 border border-ink bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wider hover:bg-ink hover:text-bg disabled:opacity-40 transition-colors flex items-center gap-1"
              aria-label="Refrescar biblioteca"
              title="Refrescar biblioteca"
            >
              {status === 'loading' ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCcw size={11} />
              )}
            </button>
          </div>

          {errorMessage && (
            <div
              className="flex items-start gap-2 border border-accent bg-accent/10 px-2 py-1.5 text-[10px] font-mono text-accent leading-snug"
              role="alert"
            >
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span className="text-left">{errorMessage}</span>
            </div>
          )}

          {status === 'loading' && (
            <div className="text-[10px] font-mono text-ink/60 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> Cargando catálogo…
            </div>
          )}

          {isEmpty && (
            <div className="text-[10px] font-mono text-ink/60">
              Aún no hay planos registrados. Ejecuta el script de bootstrap o carga el primer inventario.
            </div>
          )}

          {status === 'ready' && totalCount > 0 && (
            <>
              <p className="text-[9px] font-mono text-ink/50">
                Mostrando {visibleCount} de {totalCount} planos activos.
              </p>
              <div className="max-h-64 overflow-y-auto pr-1 space-y-2">
                {filteredViews.map((view) => {
                  const rowActionState = rowState[view.drawingId] ?? { status: 'idle' };
                  return (
                    <div
                      key={view.drawingId}
                      className="border border-ink/40 bg-[#FBFBFB] p-2 space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-black uppercase tracking-tight truncate" title={view.partNumber}>
                            {view.partNumber}
                          </p>
                          <p className="text-[9px] font-mono text-ink/60 truncate" title={view.description}>
                            {view.description || 'Sin descripción'}
                          </p>
                        </div>
                        <span
                          className="shrink-0 bg-ink text-bg px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
                          title={`Revisión activa: ${view.revision}`}
                        >
                          Rev {view.revision}
                        </span>
                      </div>

                      <p className="text-[9px] font-mono text-ink/40 truncate" title={view.sourcePath}>
                        <FileText size={9} className="inline-block mr-1 -mt-0.5" />
                        {view.sourcePath || '(sin ruta)'}
                      </p>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => void handlePrint(view)}
                          disabled={rowActionState.status === 'printing'}
                          className="border border-ink bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wider hover:bg-ink hover:text-bg disabled:opacity-40 transition-colors flex items-center gap-1"
                        >
                          {rowActionState.status === 'printing' ? (
                            <>
                              <Loader2 size={10} className="animate-spin" /> Abriendo
                            </>
                          ) : (
                            <>
                              <Printer size={10} /> Imprimir
                            </>
                          )}
                        </button>

                      </div>

                      {rowActionState.status === 'error' && rowActionState.message && (
                        <p className="text-[9px] font-mono text-accent leading-tight">
                          {rowActionState.message}
                        </p>
                      )}
                    </div>
                  );
                })}
                {filteredViews.length === 0 && (
                  <p className="text-[10px] font-mono text-ink/50 italic">
                    Ningún plano coincide con la búsqueda.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
