/**
 * Genera una imagen isométrica “3D” a partir de un plano 2D rasterizado.
 * Solo para fallback visual del reporte cuando no hay ISO / eDrawing real.
 *
 * Geometría NO es confiable para maquinado — el caller debe marcar
 * `isometricSource: 'ai-generated'` en la UI.
 */

import { callWithRetry, prepareImagePart } from './gemini';
import { callGeminiProxy } from './geminiProxy';
import { log } from './log';

export const ISOMETRIC_GEN_PROMPT_VERSION = 'iso-gen-v2';
export const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

const DEFAULT_PROMPT = `You are converting a 2D mechanical engineering drawing (orthographic CAD views) into a clean isometric 3D-style product render of the SAME machined part.

Rules:
- Infer the solid from the visible 2D views (front / side / top / detail) on the sheet.
- Preserve overall shape, proportions, holes, chamfers, and features visible in the drawing.
- Neutral studio background, soft lighting, no text, no dimensions, no title block, no grid.
- Single solid metal-looking part, classic isometric / 3/4 engineering view.
- Do NOT invent logos, fasteners, or extra assemblies that are not part of the piece.
- Output only the image.`;

export interface GenerateIsometricOptions {
  /** dataURL JPEG/PNG del plano o crop 2D. */
  sourceImageDataUrl: string;
  prompt?: string;
  model?: string;
}

export interface GeminiInlineImagePart {
  inlineData?: {
    data?: string;
    mimeType?: string;
  } | null;
}

/**
 * Extrae el primer dataURL de imagen de las parts de una respuesta Gemini.
 * Puro / testeable — no llama a la red.
 */
export function extractGeneratedImageDataUrl(
  parts: readonly GeminiInlineImagePart[] | undefined,
): string | null {
  if (!parts || parts.length === 0) return null;
  for (const part of parts) {
    const inline = part.inlineData;
    if (!inline?.data) continue;
    const mime =
      inline.mimeType && inline.mimeType.startsWith('image/')
        ? inline.mimeType
        : 'image/png';
    return `data:${mime};base64,${inline.data}`;
  }
  return null;
}

/** True si el plano asociado ya es un ISO real (no conviene inventar 3D con IA). */
export function isRealIsoPdfLabel(sourcePdfName: string | undefined | null): boolean {
  return (sourcePdfName ?? '').toLowerCase().includes('.iso');
}

/**
 * Una orden puede pedir generación IA si tiene imagen 2D fuente y el plano
 * no es un ISO real del Tool Crib / eDrawings.
 */
export function canGenerateAiIsometric(order: {
  sourceImageDataUrl?: string;
  isometricView?: string;
  sourcePdfName?: string;
}): boolean {
  const hasSource = Boolean(order.sourceImageDataUrl || order.isometricView);
  if (!hasSource) return false;
  return !isRealIsoPdfLabel(order.sourcePdfName);
}

/**
 * Devuelve un dataURL JPEG/PNG de la imagen generada, o null si el modelo
 * no devolvió inline image data (fail-soft).
 */
export async function generateIsometricImageFromDrawing(
  options: GenerateIsometricOptions,
): Promise<string | null> {
  const model = options.model ?? GEMINI_IMAGE_MODEL;
  const prompt = options.prompt ?? DEFAULT_PROMPT;
  const imagePart = prepareImagePart(options.sourceImageDataUrl);

  const response = await callWithRetry(() =>
    callGeminiProxy({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }, imagePart] }],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    }),
  );

  const parts = response.candidates[0]?.content?.parts as
    | GeminiInlineImagePart[]
    | undefined;
  const dataUrl = extractGeneratedImageDataUrl(parts);
  if (!dataUrl) {
    log.warn('[smv-vision][iso-gen] Gemini no devolvió imagen inline');
  }
  return dataUrl;
}
