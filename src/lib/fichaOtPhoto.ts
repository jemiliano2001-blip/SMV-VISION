/**
 * Foto de la ficha OT: ISO real, STL en blanco y negro, o dibujo de línea por IA.
 * La decisión es pura. La descarga y Gemini viven en la resolución, nunca en el sello.
 */

import type { ToolcribActiveDrawingView } from '../types';
import { log } from './log';
import type { FichaPhotoKind, PlanoOtFichaPhoto, PlanoOtStamp } from './planoOt';
import { groupDrawingViews } from './toolcribCatalog';

export interface FichaPhotoSignals {
  isoPdfUrl?: string | null;
  stlUrl?: string | null;
  cadPdfAvailable: boolean;
}

export function chooseFichaPhotoKind(signals: FichaPhotoSignals): FichaPhotoKind {
  if ((signals.isoPdfUrl ?? '').trim()) return 'iso';
  if ((signals.stlUrl ?? '').trim()) return 'stl';
  if (signals.cadPdfAvailable) return 'ai';
  return 'none';
}

export function photoSourcesForPart(
  partNumber: string,
  views: readonly ToolcribActiveDrawingView[],
): { isoPdfUrl: string | null; stlUrl: string | null } {
  const key = partNumber.trim().toUpperCase().replace(/\.ISO$/i, '');
  const group = groupDrawingViews(views).find((candidate) => candidate.key === key);
  return {
    isoPdfUrl: group?.iso?.pdfUrl ?? null,
    stlUrl: group?.stlView?.stlUrl ?? null,
  };
}

export interface ResolveFichaPhotoInput {
  isoPdfUrl?: string | null;
  stlUrl?: string | null;
  cadPdfDataUrl?: string | null;
}

export interface ResolveFichaPhotoDeps {
  fetchPdf?: (url: string) => Promise<string>;
  renderStl?: (url: string) => Promise<string | null>;
  generateAi?: (cadPdfDataUrl: string) => Promise<string | null>;
}

async function defaultFetchPdf(url: string): Promise<string> {
  const { fetchPdfAsDataUrl } = await import('./fetchPdf');
  return fetchPdfAsDataUrl(url);
}

async function defaultRenderStl(url: string): Promise<string | null> {
  const { renderStlToDataUrl } = await import('./stlImageRenderer');
  const rendered = await renderStlToDataUrl(url, { tone: 'print', width: 900, height: 700 });
  return rendered.ok ? rendered.dataUrl : null;
}

async function defaultGenerateAi(cadPdfDataUrl: string): Promise<string | null> {
  const { rasterizeAndNormalizePdf } = await import('./documentAnalysis/pdfWorkerClient');
  const { createDocumentHash, readCachedValue, writeCachedValue } = await import('./documentAnalysis/cache');
  const { generateIsometricImageFromDrawing, ISOMETRIC_GEN_PROMPT_VERSION } = await import('./generateIsometricImage');
  const raster = await rasterizeAndNormalizePdf(cadPdfDataUrl, {
    maxDim: 1024,
    renderScale: 1.5,
    jpegQuality: 0.8,
    normalizeQuality: 0.78,
  });
  const hash = await createDocumentHash(raster.imageDataUrl);
  const cached = await readCachedValue<string>('iso-gen', hash, ISOMETRIC_GEN_PROMPT_VERSION);
  if (cached) return cached;
  const generated = await generateIsometricImageFromDrawing({ sourceImageDataUrl: raster.imageDataUrl });
  if (generated) {
    await writeCachedValue('iso-gen', hash, ISOMETRIC_GEN_PROMPT_VERSION, generated);
  }
  return generated;
}

export async function resolveFichaPhoto(
  input: ResolveFichaPhotoInput,
  deps: ResolveFichaPhotoDeps = {},
): Promise<PlanoOtFichaPhoto> {
  const fetchPdf = deps.fetchPdf ?? defaultFetchPdf;
  const renderStl = deps.renderStl ?? defaultRenderStl;
  const generateAi = deps.generateAi ?? defaultGenerateAi;
  const cadPdfDataUrl = input.cadPdfDataUrl ?? '';
  const kind = chooseFichaPhotoKind({
    isoPdfUrl: input.isoPdfUrl,
    stlUrl: input.stlUrl,
    cadPdfAvailable: cadPdfDataUrl.trim().length > 0,
  });

  if (kind === 'iso') {
    try {
      const pdfDataUrl = await fetchPdf((input.isoPdfUrl ?? '').trim());
      if (pdfDataUrl.trim()) return { kind: 'iso', pdfDataUrl };
      log.warn('[ficha-ot] el PDF ISO llegó vacío');
    } catch (error) {
      log.warn('[ficha-ot] no se pudo descargar el ISO', error);
    }
  }

  if (kind === 'iso' || kind === 'stl') {
    const stlUrl = (input.stlUrl ?? '').trim();
    if (stlUrl) {
      try {
        const imageDataUrl = await renderStl(stlUrl);
        if (imageDataUrl) return { kind: 'stl', imageDataUrl };
        log.warn('[ficha-ot] el STL no produjo imagen');
      } catch (error) {
        log.warn('[ficha-ot] no se pudo renderizar el STL', error);
      }
    }
  }

  if (cadPdfDataUrl.trim()) {
    try {
      const imageDataUrl = await generateAi(cadPdfDataUrl);
      if (imageDataUrl) return { kind: 'ai', imageDataUrl };
      log.warn('[ficha-ot] la IA no devolvió imagen');
    } catch (error) {
      log.warn('[ficha-ot] falló la isométrica por IA', error);
    }
  }

  return { kind: 'none' };
}

/** Adjunta la foto solo cuando la impresión incluye ficha. */
export async function attachFichaPhoto(
  stamp: PlanoOtStamp,
  input: ResolveFichaPhotoInput,
  deps?: ResolveFichaPhotoDeps,
): Promise<PlanoOtStamp> {
  if ((stamp.mode ?? 'blueprint') === 'blueprint') return stamp;
  const fichaPhoto = await resolveFichaPhoto(input, deps);
  return { ...stamp, fichaPhoto };
}
