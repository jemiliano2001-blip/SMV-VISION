const WORKER_TIMEOUT_MS = 45_000;

export interface RasterizeNormalizeOptions {
  maxDim: number;
  renderScale: number;
  jpegQuality: number;
  normalizeQuality: number;
}

export interface RasterizeNormalizeMetrics {
  pdfRasterMs: number;
  normalizeMs: number;
}

export interface RasterizeNormalizeResult {
  imageDataUrl: string;
  metrics: RasterizeNormalizeMetrics;
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
  metrics: RasterizeNormalizeMetrics;
}

interface WorkerErrorResponse {
  id: string;
  success: false;
  error: string;
}

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

function isWorkerSuccess(response: WorkerResponse): response is WorkerSuccessResponse {
  return response.success;
}

interface WorkerResolver {
  resolve: (value: RasterizeNormalizeResult) => void;
  reject: (reason: Error) => void;
}

let workerInstance: Worker | null = null;
const pendingRequests = new Map<string, WorkerResolver>();

function getWorkerInstance(): Worker {
  if (workerInstance) {
    return workerInstance;
  }

  workerInstance = new Worker(new URL('../../workers/pdfImageWorker.ts', import.meta.url), { type: 'module' });
  workerInstance.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const pending = pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    pendingRequests.delete(response.id);
    if (isWorkerSuccess(response)) {
      pending.resolve({
        imageDataUrl: response.imageDataUrl,
        metrics: response.metrics,
      });
    } else {
      pending.reject(new Error(response.error));
    }
  };

  workerInstance.onerror = (event) => {
    const err = new Error(event.message || 'PDF worker failed');
    pendingRequests.forEach(({ reject }) => reject(err));
    pendingRequests.clear();
    workerInstance = null; // Allow re-creation on the next request
  };

  return workerInstance;
}

function makeRequestId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function rasterizeAndNormalizePdf(
  dataUrl: string,
  options: RasterizeNormalizeOptions,
): Promise<RasterizeNormalizeResult> {
  const worker = getWorkerInstance();
  const id = makeRequestId();
  const request: WorkerRequest = {
    id,
    type: 'rasterize-normalize',
    payload: {
      dataUrl,
      options,
    },
  };

  return new Promise<RasterizeNormalizeResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('El worker de rasterizado no respondió a tiempo (posible cuelgue).'));
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      reject: (reason) => {
        window.clearTimeout(timer);
        reject(reason);
      },
    });
    worker.postMessage(request);
  });
}
