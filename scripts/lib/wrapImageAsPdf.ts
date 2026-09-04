/**
 * Envuelve un JPG/PNG en un PDF de una página (pdf-lib).
 * Así el pipeline existente (pdf.js → raster → Gemini crop) sigue funcionando
 * con isométricas exportadas desde eDrawings.
 *
 * La página se dimensiona en PAPEL REAL (carta), no en píxeles: un raster de
 * 2878×1798 sobre una página de 2878×1798 pt daría una hoja de 40"×25", que
 * descuadra la impresión en el taller, infla el rasterizado de pdf.js y rompe
 * la geometría del sello de OT (`stampPlanoOt` calcula márgenes y tamaños de
 * fuente contra el ancho de página). La imagen conserva su relación de aspecto
 * y se centra; la resolución no se pierde — el PDF guarda el raster completo y
 * el visor lo muestra a la densidad que tenga.
 */

import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

export type ImageMime = 'image/jpeg' | 'image/png';

/** Carta en puntos PostScript (1 pt = 1/72"). Los planos SMV son 11×8.5". */
export const LETTER_LONG_SIDE_PT = 792;
export const LETTER_SHORT_SIDE_PT = 612;

export interface WrapImageOptions {
  /** Ancho de página en pt. Por defecto: carta, orientada según la imagen. */
  pageWidth?: number;
  /** Alto de página en pt. Por defecto: carta, orientada según la imagen. */
  pageHeight?: number;
}

export function mimeFromPath(filePath: string): ImageMime {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

/** Carta con la orientación que menos recorta la imagen. */
export function defaultPageSize(
  imageWidth: number,
  imageHeight: number,
): { pageWidth: number; pageHeight: number } {
  return imageWidth >= imageHeight
    ? { pageWidth: LETTER_LONG_SIDE_PT, pageHeight: LETTER_SHORT_SIDE_PT }
    : { pageWidth: LETTER_SHORT_SIDE_PT, pageHeight: LETTER_LONG_SIDE_PT };
}

/** Escala la imagen para caber completa en la página, centrada. */
export function fitImageToPage(
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width: pageWidth, height: pageHeight };
  }
  const scale = Math.min(pageWidth / imageWidth, pageHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  };
}

export async function wrapImageFileAsPdfBytes(
  imagePath: string,
  options: WrapImageOptions = {},
): Promise<Uint8Array> {
  const bytes = await readFile(imagePath);
  return wrapImageBytesAsPdf(bytes, mimeFromPath(imagePath), options);
}

export async function wrapImageBytesAsPdf(
  imageBytes: Uint8Array,
  mime: ImageMime,
  options: WrapImageOptions = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const embedded =
    mime === 'image/png'
      ? await pdf.embedPng(imageBytes)
      : await pdf.embedJpg(imageBytes);

  const fallback = defaultPageSize(embedded.width, embedded.height);
  const pageWidth = options.pageWidth ?? fallback.pageWidth;
  const pageHeight = options.pageHeight ?? fallback.pageHeight;

  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(embedded, fitImageToPage(embedded.width, embedded.height, pageWidth, pageHeight));

  return pdf.save();
}
