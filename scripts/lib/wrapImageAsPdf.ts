/**
 * Envuelve un JPG/PNG en un PDF de una página (pdf-lib).
 * Así el pipeline existente (pdf.js → raster → Gemini crop) sigue funcionando
 * con isométricas exportadas desde eDrawings.
 */

import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

export type ImageMime = 'image/jpeg' | 'image/png';

export function mimeFromPath(filePath: string): ImageMime {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

export async function wrapImageFileAsPdfBytes(imagePath: string): Promise<Uint8Array> {
  const bytes = await readFile(imagePath);
  return wrapImageBytesAsPdf(bytes, mimeFromPath(imagePath));
}

export async function wrapImageBytesAsPdf(
  imageBytes: Uint8Array,
  mime: ImageMime,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const embedded =
    mime === 'image/png'
      ? await pdf.embedPng(imageBytes)
      : await pdf.embedJpg(imageBytes);

  const page = pdf.addPage([embedded.width, embedded.height]);
  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: embedded.width,
    height: embedded.height,
  });

  return pdf.save();
}
