/**
 * Utilidades de bajo nivel para la API de Gemini.
 *
 * callWithRetry: reintentos con backoff exponencial (1 s / 2 s).
 * preparePdfPart / prepareImagePart: construyen el objeto inlineData
 *   que espera @google/genai para PDFs e imágenes JPEG.
 */

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
      if (attempt < maxAttempts - 1) {
        await new Promise<void>((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
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
  return { inlineData: { mimeType: 'image/jpeg', data: base64Data } };
}
