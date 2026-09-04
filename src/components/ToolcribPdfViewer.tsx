/**
 * Visor propio de PDF para Biblioteca, en reemplazo del `<object>` embebido
 * (que delegaba todo al plugin de PDF del navegador: sin zoom controlado, sin
 * ajustar a ancho, y sin poder saltar de ISO a CAD sin cerrar el modal).
 *
 * Usa pdfjs-dist directamente en el hilo principal — es una librería
 * distinta al uso que ya existe en `pdfImageWorker.ts` (que corre DENTRO de
 * un Worker con `disableWorker:true` para rasterizar a JPEG para Gemini).
 * Aquí sí dejamos que pdf.js use su propio worker dedicado, apuntando al
 * mismo `pdf.worker.min.mjs` que Vite ya empaqueta.
 *
 * Se importa perezosamente (`lazy` en el caller) para no meter pdfjs-dist en
 * el bundle inicial — sólo se paga al abrir el modal de vista previa.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { Button } from './ui/button';
import { log } from '../lib/log';

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;

type ViewerStatus = 'loading' | 'ready' | 'error';

export interface ToolcribPdfViewerProps {
  pdfUrl: string;
  fileName: string;
}

export function ToolcribPdfViewer({ pdfUrl, fileName }: ToolcribPdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);
  // null = "ajustar a ancho" (se recalcula con el tamaño del contenedor).
  // Un número = zoom manual fijado por el usuario.
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [baseViewportWidth, setBaseViewportWidth] = useState<number | null>(null);

  // Carga del documento — se reinicia si cambia el PDF (p. ej. cambiar de
  // "Ver CAD" a "Ver ISO" sin cerrar el modal).
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMessage(null);
    setPageNumber(1);
    setManualScale(null);
    setBaseViewportWidth(null);

    (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();

        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        log.warn('[smv-vision][toolcrib] ToolcribPdfViewer no pudo cargar el PDF', error);
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'No fue posible cargar el PDF.');
      }
    })();

    return () => {
      cancelled = true;
      const pdf = pdfDocRef.current;
      pdfDocRef.current = null;
      if (pdf) void pdf.destroy();
    };
  }, [pdfUrl]);

  // Ancho del contenedor, para "ajustar a ancho" y para recalcular si se
  // redimensiona la ventana con el modal abierto.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const effectiveScale = useMemo(() => {
    if (manualScale !== null) return manualScale;
    if (!baseViewportWidth || containerWidth <= 0) return 1;
    // Márgenes del contenedor (padding) para que la página no toque el borde.
    const target = Math.max(containerWidth - 32, 50);
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, target / baseViewportWidth));
  }, [manualScale, baseViewportWidth, containerWidth]);

  // Render de la página actual al canvas.
  useEffect(() => {
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (status !== 'ready' || !pdf || !canvas) return;

    let cancelled = false;

    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        if (baseViewportWidth === null) {
          setBaseViewportWidth(page.getViewport({ scale: 1 }).width);
          return; // el cambio de baseViewportWidth dispara este efecto de nuevo con la escala ya calculable
        }

        const viewport = page.getViewport({ scale: effectiveScale });
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        renderTaskRef.current?.cancel();
        const task = page.render({ canvas, canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (error) {
        // Cancelar un render en vuelo (al hacer zoom rápido) lanza esta
        // excepción por diseño de pdf.js — no es un error real, se ignora.
        const isCancelled =
          error instanceof Error && error.name === 'RenderingCancelledException';
        if (!cancelled && !isCancelled) {
          log.warn('[smv-vision][toolcrib] ToolcribPdfViewer no pudo renderizar la página', error);
          setStatus('error');
          setErrorMessage('No fue posible dibujar la página del PDF.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, pageNumber, effectiveScale, baseViewportWidth]);

  const zoomIn = () => setManualScale(Math.min(MAX_SCALE, (manualScale ?? effectiveScale) * ZOOM_STEP));
  const zoomOut = () => setManualScale(Math.max(MIN_SCALE, (manualScale ?? effectiveScale) / ZOOM_STEP));
  const fitToWidth = () => setManualScale(null);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b-2 border-line bg-surface-2 shrink-0">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            onClick={zoomOut}
            disabled={status !== 'ready'}
            title="Alejar"
            className="border-2 border-line rounded-none h-7 px-2"
          >
            <ZoomOut size={13} />
          </Button>
          <span className="font-mono text-[11px] text-ink-dim w-12 text-center tabular-nums">
            {Math.round(effectiveScale * 100)}%
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={zoomIn}
            disabled={status !== 'ready'}
            title="Acercar"
            className="border-2 border-line rounded-none h-7 px-2"
          >
            <ZoomIn size={13} />
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={fitToWidth}
            disabled={status !== 'ready' || manualScale === null}
            title="Ajustar a ancho"
            className="border-2 border-line rounded-none h-7 px-2 ml-1"
          >
            <Maximize2 size={13} />
          </Button>
        </div>

        {numPages > 1 && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="xs"
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              disabled={status !== 'ready' || pageNumber <= 1}
              title="Página anterior"
              className="border-2 border-line rounded-none h-7 px-2"
            >
              <ChevronLeft size={13} />
            </Button>
            <span className="font-mono text-[11px] text-ink-dim tabular-nums">
              {pageNumber} / {numPages}
            </span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
              disabled={status !== 'ready' || pageNumber >= numPages}
              title="Página siguiente"
              className="border-2 border-line rounded-none h-7 px-2"
            >
              <ChevronRight size={13} />
            </Button>
          </div>
        )}

        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim hover:text-accent transition-colors"
          title={fileName}
        >
          <ExternalLink size={12} />
          <span className="hidden sm:inline">Abrir en pestaña nueva</span>
        </a>
      </div>

      <div ref={containerRef} className="grow overflow-auto bg-surface-2 flex items-start justify-center p-4">
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-2 text-ink-dim font-mono text-xs uppercase tracking-widest py-16">
            <Loader2 size={20} className="animate-spin text-accent" />
            Cargando PDF…
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 text-center py-16 max-w-md">
            <AlertCircle size={24} className="text-danger" />
            <p className="font-mono text-xs text-danger">{errorMessage}</p>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline text-xs font-mono"
            >
              Descargar o abrir PDF directamente
            </a>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={status === 'ready' ? 'bg-white shadow-hard' : 'hidden'}
        />
      </div>
    </div>
  );
}
