const FETCH_TIMEOUT_MS = 30_000;

export async function fetchPdfAsDataUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Lectura de PDF no devolvió un dataURL.'));
      };
      reader.onerror = () => reject(new Error('No fue posible leer el PDF.'));
      reader.readAsDataURL(blob);
    });
  } finally {
    window.clearTimeout(timer);
  }
}
