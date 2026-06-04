/**
 * Manipulación de imágenes para el pipeline de blueprints.
 *
 * isValidBoundingBox: validación pura (testeable en Node).
 * cropIsometricView / cropToBoxRaw: requieren Canvas del browser (no testeables
 *   en Node sin jsdom — deuda técnica documentada).
 */

export function isValidBoundingBox(box?: number[]): box is number[] {
  if (!box || box.length !== 4) return false;
  const [ymin, xmin, ymax, xmax] = box;
  if (![ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) return false;
  const width = xmax - xmin;
  const height = ymax - ymin;
  if (width <= 50 || height <= 50) return false;   // < 5% of the 0-1000 grid
  if (width * height > 750 * 750) return false;    // > ~56% area
  if (Math.min(width, height) / Math.max(width, height) < 0.25) return false; // sliver
  return true;
}

export function cropIsometricView(base64: string, box: number[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const padding = 12;
      const [ymin, xmin, ymax, xmax] = box;
      const x = Math.max(0, (xmin / 1000) * img.width - padding);
      const y = Math.max(0, (ymin / 1000) * img.height - padding);
      const width = Math.min(img.width - x, ((xmax - xmin) / 1000) * img.width + padding * 2);
      const height = Math.min(img.height - y, ((ymax - ymin) / 1000) * img.height + padding * 2);

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = width;
      cropCanvas.height = height;
      const cropCtx = cropCanvas.getContext('2d')!;
      cropCtx.fillStyle = '#FFFFFF';
      cropCtx.fillRect(0, 0, width, height);
      cropCtx.drawImage(img, x, y, width, height, 0, 0, width, height);

      const side = Math.ceil(Math.max(width, height));
      const squareCanvas = document.createElement('canvas');
      squareCanvas.width = side;
      squareCanvas.height = side;
      const squareCtx = squareCanvas.getContext('2d')!;
      squareCtx.fillStyle = '#FFFFFF';
      squareCtx.fillRect(0, 0, side, side);
      squareCtx.drawImage(
        cropCanvas,
        0, 0, width, height,
        Math.floor((side - width) / 2), Math.floor((side - height) / 2), width, height,
      );
      resolve(squareCanvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () =>
      reject(new Error('No se pudo cargar la imagen para recortar la vista isométrica.'));
    img.src = base64;
  });
}

export function cropToBoxRaw(base64: string, box: number[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [ymin, xmin, ymax, xmax] = box;
      const x = Math.max(0, (xmin / 1000) * img.width);
      const y = Math.max(0, (ymin / 1000) * img.height);
      const width = Math.min(img.width - x, ((xmax - xmin) / 1000) * img.width);
      const height = Math.min(img.height - y, ((ymax - ymin) / 1000) * img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(width));
      canvas.height = Math.max(1, Math.floor(height));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, x, y, width, height, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () =>
      reject(new Error('No se pudo cargar la imagen para el refinamiento del bounding box.'));
    img.src = base64;
  });
}
