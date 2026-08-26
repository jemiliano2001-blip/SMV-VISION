/// <reference lib="webworker" />

import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface RasterizeNormalizeOptions {
  maxDim: number;
  renderScale: number;
  jpegQuality: number;
  normalizeQuality: number;
}

interface WorkerRequest {
  id: string;
  type: 'rasterize-normalize';
  payload: {
    dataUrl: string;
    options: RasterizeNormalizeOptions;
  };
}

interface WorkerSuccessResponse {
  id: string;
  success: true;
  imageDataUrl: string;
  metrics: {
    pdfRasterMs: number;
    normalizeMs: number;
  };
}

interface WorkerErrorResponse {
  id: string;
  success: false;
  error: string;
}

interface CanvasAndContext {
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
}

class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const canvas = new OffscreenCanvas(safeWidth, safeHeight);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create OffscreenCanvas context');
    }
    return { canvas, context };
  }

  reset(target: CanvasAndContext, width: number, height: number): void {
    target.canvas.width = Math.max(1, Math.floor(width));
    target.canvas.height = Math.max(1, Math.floor(height));
  }

  destroy(target: CanvasAndContext): void {
    target.canvas.width = 0;
    target.canvas.height = 0;
  }
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const marker = ';base64,';
  const markerIndex = dataUrl.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error('Invalid data URL payload for PDF');
  }

  const base64 = dataUrl.slice(markerIndex + marker.length);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return `data:image/jpeg;base64,${base64}`;
}

// Served from Vite's `public/` directory (populated at config load from
// `node_modules/pdfjs-dist/wasm/`). pdf.js appends the exact wasm filenames
// (`jbig2.wasm`, `openjpeg.wasm`, `qcms_bg.wasm`) to this prefix at runtime,
// so the path must be stable and unhashed.
const PDFJS_WASM_URL = '/pdfjs-wasm/';

type PdfJsGetDocumentOptions = Parameters<typeof pdfjsLib.getDocument>[0];

async function renderPdfPageToBlob(pdfDataUrl: string, scale: number, quality: number): Promise<Blob> {
  const pdfBytes = dataUrlToUint8Array(pdfDataUrl);
  // `disableWorker` is an internal pdf.js option not exposed in the public
  // `DocumentInitParameters` type. We run inside a dedicated web worker and
  // must avoid spawning a nested worker (unsupported in Safari and flaky in
  // Vite module resolution), so we pass it through with an explicit widening
  // cast. This is a narrowly-scoped escape hatch, not a blanket `any`.
  const loadingOptions = {
    data: pdfBytes,
    disableWorker: true,
    wasmUrl: PDFJS_WASM_URL,
    CanvasFactory: OffscreenCanvasFactory,
  } as PdfJsGetDocumentOptions;
  const loadingTask = pdfjsLib.getDocument(loadingOptions);
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Failed to create OffscreenCanvas context');
  }

  await page.render({
    // pdf.js v5 requires `canvas`; passing `null` tells it to use the
    // provided `canvasContext` directly (OffscreenCanvas is not an
    // HTMLCanvasElement, so we explicitly decouple them here).
    canvas: null,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  canvas.width = 0;
  canvas.height = 0;
  return resultBlob;
}

async function normalizeBlob(blob: Blob, maxDim: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  let width = bitmap.width;
  let height = bitmap.height;

  if (width > height && width > maxDim) {
    height = Math.round((height * maxDim) / width);
    width = maxDim;
  } else if (height >= width && height > maxDim) {
    width = Math.round((width * maxDim) / height);
    height = maxDim;
  }

  const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to normalize image');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const normalizedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  canvas.width = 0;
  canvas.height = 0;
  return normalizedBlob;
}

async function handleRasterizeNormalize(request: WorkerRequest): Promise<WorkerSuccessResponse | WorkerErrorResponse> {
  const { dataUrl, options } = request.payload;
  const rasterStart = performance.now();
  const rasterBlob = await renderPdfPageToBlob(dataUrl, options.renderScale, options.jpegQuality);
  const rasterEnd = performance.now();

  const normalizeStart = performance.now();
  const normalizedBlob = await normalizeBlob(rasterBlob, options.maxDim, options.normalizeQuality);
  const normalizedBuffer = await normalizedBlob.arrayBuffer();
  const normalizeEnd = performance.now();

  return {
    id: request.id,
    success: true,
    imageDataUrl: arrayBufferToDataUrl(normalizedBuffer),
    metrics: {
      pdfRasterMs: rasterEnd - rasterStart,
      normalizeMs: normalizeEnd - normalizeStart,
    },
  };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'rasterize-normalize') {
    const unsupported: WorkerErrorResponse = {
      id: request.id,
      success: false,
      error: 'Unsupported worker request type',
    };
    self.postMessage(unsupported);
    return;
  }

  try {
    const response = await handleRasterizeNormalize(request);
    self.postMessage(response);
  } catch (error) {
    const errResponse: WorkerErrorResponse = {
      id: request.id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown worker error',
    };
    self.postMessage(errResponse);
  }
};
