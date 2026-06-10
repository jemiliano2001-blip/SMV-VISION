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
  CheckCircle2,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Printer,
  RefreshCcw,
  Search,
} from 'lucide-react';
import Fuse from 'fuse.js';

import {
  listActiveDrawingViews,
  recordToolcribPrintLogFireAndForget,
} from '../lib/firebase/toolcrib';
import type { ToolcribActiveDrawingView } from '../types';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';

export interface ToolcribAttachment {
  drawingId: string;
  partId: string;
  partNumber: string;
  revision: string;
  sourcePath: string;
  displayName: string;
  dataUrl: string;
}

export interface ToolcribLibraryPanelProps {
  /**
   * Callback usado para adjuntar un PDF resuelto (dataURL) al flujo de
   * análisis existente. El panel garantiza que el dataURL ya esté listo.
   */
  onAttachDrawing?: (attachment: ToolcribAttachment) => void;
  /**
   * IDs de dibujos ya adjuntados al flujo de análisis, para evitar dobles
   * inserciones y reflejar el estado en la UI.
   */
  attachedDrawingIds?: ReadonlySet<string>;
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RowActionState {
  status: 'idle' | 'attaching' | 'printing' | 'error';
  message?: string;
}

function normalizeSearchTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function buildDisplayName(view: ToolcribActiveDrawingView): string {
  const base = view.partNumber.trim();
  const revision = view.revision.trim();
  return `${base} (Rev ${revision}).pdf`;
}

export function ToolcribLibraryPanel({
  onAttachDrawing,
  attachedDrawingIds,
}: ToolcribLibraryPanelProps): ReactElement {
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

  // El índice solo depende del catálogo — construirlo dentro del memo de
  // filtrado lo reconstruía en cada tecleo del buscador.
  const fuse = useMemo(() => new Fuse(views, {
    keys: [
      { name: 'partNumber', weight: 2 },
      { name: 'description', weight: 1 },
      { name: 'sourcePath', weight: 1 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  }), [views]);

  const filteredViews = useMemo(() => {
    const term = normalizeSearchTerm(searchTerm);
    if (term.length === 0) {
      return views;
    }

    // Sort logic to prioritize exact matches or `.iso` files for identical scores
    return fuse.search(term).sort((a, b) => {
      const aIso = a.item.partNumber.toLowerCase().includes('.iso') || (a.item.sourcePath || '').toLowerCase().includes('.iso');
      const bIso = b.item.partNumber.toLowerCase().includes('.iso') || (b.item.sourcePath || '').toLowerCase().includes('.iso');

      // If one is an .iso file and scores are relatively close, give it a tiny priority
      if (aIso && !bIso && Math.abs((a.score || 0) - (b.score || 0)) < 0.1) return -1;
      if (!aIso && bIso && Math.abs((a.score || 0) - (b.score || 0)) < 0.1) return 1;

      return (a.score || 0) - (b.score || 0);
    }).map(result => result.item);
  }, [searchTerm, fuse, views]);

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

  const handleAttach = useCallback(
    async (view: ToolcribActiveDrawingView) => {
      if (!onAttachDrawing) {
        return;
      }
      if (!view.pdfUrl) {
        setRowState((prev) => ({
          ...prev,
          [view.drawingId]: {
            status: 'error',
            message:
              'Este plano no tiene URL HTTP accesible. Súbelo manualmente o configura pdfUrl.',
          },
        }));
        return;
      }

      setRowState((prev) => ({
        ...prev,
        [view.drawingId]: { status: 'attaching' },
      }));

      try {
        const dataUrl = await fetchPdfAsDataUrl(view.pdfUrl);
        onAttachDrawing({
          drawingId: view.drawingId,
          partId: view.partId,
          partNumber: view.partNumber,
          revision: view.revision,
          sourcePath: view.sourcePath,
          displayName: buildDisplayName(view),
          dataUrl,
        });
        setRowState((prev) => ({
          ...prev,
          [view.drawingId]: { status: 'idle' },
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        console.warn('[smv-vision][toolcrib] handleAttach falló', error);
        setRowState((prev) => ({
          ...prev,
          [view.drawingId]: {
            status: 'error',
            message: `No fue posible descargar el PDF (${message}).`,
          },
        }));
      }
    },
    [onAttachDrawing],
  );

  const totalCount = views.length;
  const visibleCount = filteredViews.length;
  const isEmpty = status === 'ready' && totalCount === 0;

  return (
    <div className="border-2 border-line bg-surface">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2.5 font-display text-[12px] font-black uppercase tracking-wider text-ink hover:text-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2">
          <FolderOpen size={15} className="text-accent" />
          Biblioteca Tool Crib
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px]">
          {status === 'loading' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : status === 'ready' ? (
            <span className="bg-ink text-bg px-1.5 py-0.5">{totalCount}</span>
          ) : status === 'error' ? (
            <AlertCircle size={12} className="text-danger" />
          ) : null}
        </span>
      </button>

      {isOpen && (
        <div className="border-t-2 border-line p-3 space-y-3">
          <div className="flex items-center gap-2">
            <div className="grow flex items-center gap-2 border border-line px-2 py-1.5 bg-surface-2">
              <Search size={12} className="text-ink-dim shrink-0" />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar parte, descripción o revisión…"
                className="grow bg-transparent outline-none text-[11px] font-mono text-ink placeholder:text-ink-dim/70"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadLibrary()}
              disabled={status === 'loading'}
              className="shrink-0 border border-line bg-surface-2 px-2 py-1.5 text-[9px] font-black uppercase tracking-wider text-ink-dim hover:text-accent hover:border-accent disabled:opacity-40 transition-colors flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
              className="flex items-start gap-2 border border-danger/60 bg-danger/10 px-2 py-1.5 text-[10px] font-mono text-danger leading-snug"
              role="alert"
            >
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span className="text-left">{errorMessage}</span>
            </div>
          )}

          {status === 'loading' && (
            <div className="text-[10px] font-mono text-ink-dim flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> Cargando catálogo…
            </div>
          )}

          {isEmpty && (
            <div className="text-[10px] font-mono text-ink-dim">
              Aún no hay planos registrados. Ejecuta el script de bootstrap o carga el primer inventario.
            </div>
          )}

          {status === 'ready' && totalCount > 0 && (
            <>
              <p className="text-[9px] font-mono text-ink-dim">
                Mostrando {visibleCount} de {totalCount} planos activos.
              </p>
              <div className="max-h-64 overflow-y-auto pr-1 space-y-2">
                {filteredViews.map((view) => {
                  const rowActionState = rowState[view.drawingId] ?? { status: 'idle' };
                  const isAttached = attachedDrawingIds?.has(view.drawingId) === true;
                  return (
                    <div
                      key={view.drawingId}
                      className="border border-line bg-surface-2 p-2 space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-black uppercase tracking-tight truncate text-ink" title={view.partNumber}>
                            {view.partNumber}
                          </p>
                          <p className="text-[9px] font-mono text-ink-dim truncate" title={view.description}>
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

                      <p className="text-[9px] font-mono text-ink-dim/70 truncate" title={view.sourcePath}>
                        <FileText size={9} className="inline-block mr-1 -mt-0.5" />
                        {view.sourcePath || '(sin ruta)'}
                      </p>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => void handlePrint(view)}
                          disabled={rowActionState.status === 'printing'}
                          className="border border-line bg-surface px-2 py-1 text-[9px] font-black uppercase tracking-wider text-ink hover:border-accent hover:text-accent disabled:opacity-40 transition-colors flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

                        {onAttachDrawing && (
                          <button
                            type="button"
                            onClick={() => void handleAttach(view)}
                            disabled={
                              rowActionState.status === 'attaching' || isAttached || !view.pdfUrl
                            }
                            className="border border-accent bg-accent text-bg px-2 py-1 text-[9px] font-black uppercase tracking-wider hover:bg-accent/80 disabled:opacity-40 transition-colors flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            title={
                              !view.pdfUrl
                                ? 'Falta pdfUrl accesible'
                                : isAttached
                                  ? 'Ya adjunto al análisis'
                                  : 'Adjuntar al análisis'
                            }
                          >
                            {isAttached ? (
                              <>
                                <CheckCircle2 size={10} /> Adjunto
                              </>
                            ) : rowActionState.status === 'attaching' ? (
                              <>
                                <Loader2 size={10} className="animate-spin" /> Adjuntando
                              </>
                            ) : (
                              <>
                                <Plus size={10} /> Análisis
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {rowActionState.status === 'error' && rowActionState.message && (
                        <p className="text-[9px] font-mono text-danger leading-tight">
                          {rowActionState.message}
                        </p>
                      )}
                    </div>
                  );
                })}
                {filteredViews.length === 0 && (
                  <p className="text-[10px] font-mono text-ink-dim italic">
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
