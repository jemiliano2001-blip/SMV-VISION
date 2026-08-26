/**
 * Utilidades de bajo nivel para la API de Gemini.
 *
 * callWithRetry: reintentos con backoff exponencial (1 s / 2 s), solo para
 *   errores transitorios (429/5xx, códigos gRPC transitorios, o de red).
 *   Errores definitivos (401/400/403, unauthenticated/invalid-argument) fallan
 *   de inmediato — reintentarlos solo quema tiempo y cupo de concurrencia.
 * preparePdfPart / prepareImagePart: construyen el objeto inlineData
 *   que espera @google/genai para PDFs e imágenes JPEG.
 */

// HTTP status codes que vale la pena reintentar: rate limit y errores
// transitorios del servidor. Todo lo demás (400 bad request, 401/403 auth,
// 404 not found) es definitivo — reintentarlo no cambia el resultado.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

// Códigos de error de Firebase Callable Functions (gRPC) que vale la pena
// reintentar — llegan como `error.code === 'functions/<code>'` desde
// `httpsCallable` (ver src/lib/geminiProxy.ts). El resto (unauthenticated,
// invalid-argument, permission-denied, etc.) es definitivo.
const RETRYABLE_FUNCTIONS_CODES = new Set([
  'functions/unavailable',
  'functions/deadline-exceeded',
  'functions/resource-exhausted',
  'functions/internal',
  'functions/aborted',
  'functions/unknown',
  'functions/cancelled',
]);

function isRetryableError(error: unknown): boolean {
  const err = error as { status?: unknown; code?: unknown } | null;

  if (typeof err?.code === 'string' && err.code.startsWith('functions/')) {
    return RETRYABLE_FUNCTIONS_CODES.has(err.code);
  }

  if (typeof err?.status === 'number') {
    return RETRYABLE_STATUS_CODES.has(err.status);
  }

  // Sin status HTTP ni código de Functions (fetch falló, timeout, DNS, etc.)
  // — tratar como transitorio.
  return true;
}

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts - 1 && isRetryableError(e)) {
        await new Promise<void>((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

export function preparePdfPart(dataUrl: string): {
  inlineData: { mimeType: string; data: string };
} {
  const base64Data = dataUrl.split(';base64,')[1];
  return { inlineData: { mimeType: 'application/pdf', data: base64Data } };
}

export function prepareImagePart(dataUrl: string): {
  inlineData: { mimeType: string; data: string };
} {
  const base64Data = dataUrl.split(';base64,')[1];
  const mimeMatch = /^data:([^;]+);base64,/.exec(dataUrl);
  const mimeType = mimeMatch?.[1] && mimeMatch[1].startsWith('image/')
    ? mimeMatch[1]
    : 'image/jpeg';
  return { inlineData: { mimeType, data: base64Data } };
}
