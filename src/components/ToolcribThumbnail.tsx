/**
 * Miniatura de un plano Tool Crib para la tabla de Biblioteca.
 *
 * Perezosa por fila (IntersectionObserver): con 163+ piezas, rasterizar
 * todos los PDFs al montar la tabla saturaría el worker y la red por nada —
 * la mayoría nunca entra al viewport. Sólo se rasteriza cuando la fila se
 * acerca a la vista, y el resultado se cachea en memoria por `pdfUrl` para
 * que hacer scroll de ida y vuelta no vuelva a pagar el costo.
 *
 * Reutiliza el worker de rasterizado ya existente (`pdfWorkerClient`), el
 * mismo que usa el pipeline de Gemini — no hay código de PDF nuevo aquí,
 * sólo una opción de tamaño mucho más chica.
 */

import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';

import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { rasterizeAndNormalizePdf } from '../lib/documentAnalysis/pdfWorkerClient';
import { log } from '../lib/log';

const THUMBNAIL_OPTIONS = {
  maxDim: 96,
  renderScale: 0.35,
  jpegQuality: 0.6,
  normalizeQuality: 0.7,
};

// Cache de sesión: pdfUrl -> dataURL del JPEG ya reducido. Vive mientras dure
// la pestaña; no hace falta persistirlo (IndexedDB) para el uso de Biblioteca.
const thumbnailCache = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<string>>();

async function loadThumbnail(pdfUrl: string): Promise<string> {
  const cached = thumbnailCache.get(pdfUrl);
  if (cached) return cached;

  const pending = inFlightRequests.get(pdfUrl);
  if (pending) return pending;

  const request = (async () => {
    const dataUrl = await fetchPdfAsDataUrl(pdfUrl);
    const result = await rasterizeAndNormalizePdf(dataUrl, THUMBNAIL_OPTIONS);
    thumbnailCache.set(pdfUrl, result.imageDataUrl);
    return result.imageDataUrl;
  })();

  inFlightRequests.set(pdfUrl, request);
  try {
    return await request;
  } finally {
    inFlightRequests.delete(pdfUrl);
  }
}

export interface ToolcribThumbnailProps {
  pdfUrl: string | null;
  alt: string;
}

export function ToolcribThumbnail({ pdfUrl, alt }: ToolcribThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(
    pdfUrl ? (thumbnailCache.get(pdfUrl) ?? null) : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || isNearViewport) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isNearViewport]);

  useEffect(() => {
    if (!isNearViewport || !pdfUrl || imageSrc) return;
    let cancelled = false;
    setFailed(false);

    loadThumbnail(pdfUrl)
      .then((dataUrl) => {
        if (!cancelled) setImageSrc(dataUrl);
      })
      .catch((error) => {
        log.warn('[smv-vision][toolcrib] miniatura falló', error);
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isNearViewport, pdfUrl, imageSrc]);

  return (
    <div
      ref={containerRef}
      className="w-11 h-11 shrink-0 border-2 border-line bg-surface-2 flex items-center justify-center overflow-hidden"
    >
      {!pdfUrl || failed ? (
        <FileText size={16} className="text-ink-dim" />
      ) : imageSrc ? (
        <img src={imageSrc} alt={alt} className="w-full h-full object-contain" />
      ) : (
        <Loader2 size={13} className="animate-spin text-ink-dim" />
      )}
    </div>
  );
}
