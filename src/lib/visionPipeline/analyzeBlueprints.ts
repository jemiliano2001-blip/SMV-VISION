import type {
  BlueprintAnalysis,
  BlueprintSpec,
  BoundingBox,
  ExtractedOrder,
  Order,
  WorkshopPdfUpload,
} from '../../types';
import {
  FALLBACK_CENTER_BOX,
  GEMINI_BLUEPRINT_MODEL,
  MAX_BLUEPRINT_CONCURRENCY,
  REFINEMENT_SKIP_AREA_THRESHOLD,
  type BlueprintStatusPatch,
  type BlueprintTaskResult,
} from './types';
import {
  createDocumentHash,
  readCachedValue,
  writeCachedValue,
} from '../documentAnalysis/cache';
import { runWithConcurrencyLimit } from '../documentAnalysis/concurrency';
import { rasterizeAndNormalizePdf } from '../documentAnalysis/pdfWorkerClient';
import { callWithRetry, prepareImagePart } from '../gemini';
import { callGeminiProxy } from '../geminiProxy';
import { parseBoundingBox, parseBlueprintResponse } from '../blueprintParsers';
import {
  cropIsometricView,
  cropToBoxRaw,
  isValidBoundingBox,
} from '../imageProcessing';
import { selectBestBlueprintMatch, MIN_BLUEPRINT_MATCH_SCORE } from '../matching';
import { log } from '../log';

export interface AnalyzeBlueprintsOptions {
  currentWorkshopPdfs: WorkshopPdfUpload[];
  ordersList: ExtractedOrder[];
  catalogFields: (order: ExtractedOrder) => Partial<Order>;
  blueprintPromptVersion: string;
  onStep: (step: string) => void;
  onStatusPatch: (patch: BlueprintStatusPatch) => void;
  onApplyResults: (updates: Array<{ orderIdx: number; partial: Partial<Order> }>) => void;
}

export interface AnalyzeBlueprintsResult {
  blueprintTaskResults: BlueprintTaskResult[];
  pdfRasterMs: number;
  aiBlueprintMs: number;
  bestMatchByOrder: Map<number, { score: number; fileId: string; isIso: boolean }>;
  orderEnrichmentByIdx: Map<number, Partial<Order>>;
  matchedBlueprintFileIds: Set<string>;
}

// Second-pass refinement: re-asks Gemini to tighten the bounding box on the
// already-cropped region of the blueprint. Returns the refined box in the
// original image's 0–1000 coordinate space, or the original box if the second
// pass fails or returns an unusable result.
export async function refineSpecBox(
  imageDataUrl: string,
  spec: BlueprintSpec,
): Promise<BlueprintSpec> {
  if (!isValidBoundingBox(spec.isometricBoundingBox)) return spec;
  const [ymin, xmin, ymax, xmax] = spec.isometricBoundingBox;
  if ((xmax - xmin) * (ymax - ymin) < REFINEMENT_SKIP_AREA_THRESHOLD) return spec;
  try {
    const croppedImageUrl = await cropToBoxRaw(imageDataUrl, spec.isometricBoundingBox);
    const response = await callWithRetry(() =>
      callGeminiProxy({
        model: GEMINI_BLUEPRINT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Esta imagen es un recorte de un plano que contiene la vista de una pieza mecánica.
Devuelve EXCLUSIVAMENTE un JSON con un campo "box" = [ymin, xmin, ymax, xmax] en escala 0-1000 sobre ESTA imagen.
El box debe centrar la geometría sólida de la pieza eliminando espacio en blanco, cotas y notas a su alrededor.
Si la pieza ya ocupa toda la imagen y no hay margen recortable, devuelve [0, 0, 1000, 1000].
No inventes información.`,
              },
              prepareImagePart(croppedImageUrl),
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              box: {
                type: 'ARRAY',
                items: { type: 'NUMBER' },
              },
            },
            required: ['box'],
          },
        },
      }),
    );
    const parsed = JSON.parse(response.text.trim()) as { box?: unknown };
    const refinedRelative = parseBoundingBox(parsed.box);
    if (!refinedRelative) return spec;

    // Map refined box from cropped-image 0-1000 space back to original-image 0-1000 space.
    const [oYmin, oXmin, oYmax, oXmax] = spec.isometricBoundingBox;
    const origW = oXmax - oXmin;
    const origH = oYmax - oYmin;
    const [rYmin, rXmin, rYmax, rXmax] = refinedRelative;
    const mapped: BoundingBox = [
      oYmin + (rYmin / 1000) * origH,
      oXmin + (rXmin / 1000) * origW,
      oYmin + (rYmax / 1000) * origH,
      oXmin + (rXmax / 1000) * origW,
    ];
    if (!isValidBoundingBox(mapped)) return spec;
    return { ...spec, isometricBoundingBox: mapped };
  } catch (e) {
    log.warn('[smv-vision] box refinement failed, keeping initial box', e);
    return spec;
  }
}

export async function analyzeBlueprints({
  currentWorkshopPdfs,
  ordersList,
  catalogFields,
  blueprintPromptVersion,
  onStep,
  onStatusPatch,
  onApplyResults,
}: AnalyzeBlueprintsOptions): Promise<AnalyzeBlueprintsResult> {
  const bestMatchByOrder = new Map<number, { score: number; fileId: string; isIso: boolean }>();
  const orderEnrichmentByIdx = new Map<number, Partial<Order>>();
  const matchedBlueprintFileIds = new Set<string>();
  let completedBlueprints = 0;
  const totalBlueprints = currentWorkshopPdfs.length;
  const cropCache = new Map<string, string>();
  const usedSpecsByFileId = new Map<string, Map<BlueprintSpec, number>>();

  const applyBlueprintToResults = async (result: BlueprintTaskResult): Promise<void> => {
    type Update = { orderIdx: number; partial: Partial<Order> };
    const updates: Update[] = [];

    if (!usedSpecsByFileId.has(result.fileId)) {
      usedSpecsByFileId.set(result.fileId, new Map());
    }
    const usedSpecsForFile = usedSpecsByFileId.get(result.fileId)!;

    for (let i = 0; i < ordersList.length; i++) {
      const order = ordersList[i];
      const usedSet = new Set<BlueprintSpec>();
      for (const [spec, idx] of usedSpecsForFile) {
        if (idx !== i) usedSet.add(spec);
      }
      const match = selectBestBlueprintMatch(
        order.pieza,
        {
          fileLabel: result.fileLabel,
          specs: result.analysis.specs,
        },
        order.numero_parte,
        usedSet,
      );
      if (match.score < MIN_BLUEPRINT_MATCH_SCORE) continue;
      const isNewIso = result.fileLabel.toLowerCase().includes('.iso');
      const current = bestMatchByOrder.get(i);
      if (current) {
        if (current.isIso && !isNewIso) continue; // ISO protege su posición
        if (!current.isIso && isNewIso) {
          /* ISO reemplaza CAD */
        } else if (current.score >= match.score) continue; // comparación normal
      }

      bestMatchByOrder.set(i, { score: match.score, fileId: result.fileId, isIso: isNewIso });
      matchedBlueprintFileIds.add(result.fileId);

      if (match.spec) {
        usedSpecsForFile.set(match.spec, i);
      }

      const cropBox = isValidBoundingBox(match.spec?.isometricBoundingBox)
        ? match.spec!.isometricBoundingBox
        : FALLBACK_CENTER_BOX;
      let isometricView: string | undefined;
      if (result.analysis.image) {
        try {
          const cropKey = `${result.fileId}:${cropBox.join(',')}`;
          const cached = cropCache.get(cropKey);
          if (cached !== undefined) {
            isometricView = cached;
          } else {
            isometricView = await cropIsometricView(result.analysis.image, cropBox);
            cropCache.set(cropKey, isometricView);
          }
        } catch (e) {
          log.error('Auto-crop error', e);
        }
      }

      updates.push({
        orderIdx: i,
        partial: {
          haSidoAuditada: true,
          isometricBoundingBox: match.spec?.isometricBoundingBox,
          sourcePdfName: result.fileLabel,
          sourcePdfPath: result.fileLabel,
          isometricView,
          isometricSource: isometricView ? 'crop' : undefined,
          matchScore: match.score,
          sourceImageDataUrl: result.analysis.image || undefined,
          material: match.spec?.material || undefined,
          dureza: match.spec?.dureza || undefined,
          tratamiento: match.spec?.tratamiento || undefined,
          acabado: match.spec?.acabado || undefined,
          ...catalogFields(order),
        },
      });
    }

    if (updates.length === 0) return;
    for (const u of updates) {
      const prev = orderEnrichmentByIdx.get(u.orderIdx) ?? {};
      orderEnrichmentByIdx.set(u.orderIdx, { ...prev, ...u.partial });
    }
    onApplyResults(updates);
  };

  onStep(`Analizando planos: 0/${totalBlueprints}`);

  // Phase A: parallel cache lookup
  const cacheCheckResults = await Promise.all(
    currentWorkshopPdfs.map(async (pdf, index) => {
      const hash = await createDocumentHash(pdf.dataUrl);
      const cached = await readCachedValue<BlueprintAnalysis>(
        'blueprint',
        hash,
        blueprintPromptVersion,
      );
      return { pdf, hash, index, cached };
    }),
  );

  const blueprintTaskResults: BlueprintTaskResult[] = new Array(currentWorkshopPdfs.length);

  for (const { pdf, index, cached } of cacheCheckResults) {
    if (!cached) continue;
    onStatusPatch({ fileId: pdf.id, status: 'done' });
    const taskResult: BlueprintTaskResult = {
      index,
      fileId: pdf.id,
      fileLabel: pdf.relativePath,
      analysis: cached,
      metrics: { pdfRasterMs: 0, aiBlueprintMs: 0 },
    };
    blueprintTaskResults[index] = taskResult;
    await applyBlueprintToResults(taskResult);
    completedBlueprints += 1;
    onStep(`Analizando planos: ${completedBlueprints}/${totalBlueprints}`);
  }

  // Phase B: only cache misses go through concurrency pool
  const cacheMisses = cacheCheckResults.filter(({ cached }) => cached === null);
  const missResults = await runWithConcurrencyLimit(
    cacheMisses,
    MAX_BLUEPRINT_CONCURRENCY,
    async ({ pdf, hash, index }): Promise<BlueprintTaskResult> => {
      let taskResult: BlueprintTaskResult;
      try {
        const workerResult = await rasterizeAndNormalizePdf(pdf.dataUrl, {
          maxDim: 1024,
          renderScale: 1.5,
          jpegQuality: 0.8,
          normalizeQuality: 0.78,
        });

        const blueprintAiStart = performance.now();
        const response = await callWithRetry(() =>
          callGeminiProxy({
            model: GEMINI_BLUEPRINT_MODEL,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `Analiza este plano de taller y devuelve EXCLUSIVAMENTE un JSON array.
Campos por objeto:
- pieza_detectada: nombre o código de la pieza
- isometricBoundingBox: [ymin, xmin, ymax, xmax] (0 a 1000)
- material: string o null (ej. "D2", "4140", "O1", "ACERO INOX 304", "ALUMINIO 6061-T6", etc., según lo indicado en el cajetín o notas)
- dureza: string o null (ej. "58-60 HRC", "60-62 RC", "40 HRC", etc.)
- tratamiento: string o null (ej. "TEMPLE Y REVENIDO", "NITRURADO", "PAVONADO", "ANODIZADO", "CROMO DURO", etc.)
- acabado: string o null (ej. "RECTIFICADO", "PULIDO ESPEJO", "ELECTROPULIDO", etc.)

Reglas de extracción (ESTILO UT2033):
1) Identifica el "Código de Parte" o "Número de Dibujo" y metadatos técnicos en el Cajetín (Title Block), esquina INFERIOR DERECHA o en la tabla de materiales.
2) PRIORIDAD ABSOLUTA: Elige la Vista Isométrica 3D (el dibujo que muestra la pieza con volumen). Si existe, el bounding box DEBE ser sobre esta vista. Usa una vista 2D solo si no hay isométrica.
3) GEOMETRÍA LIMPIA: El bounding box debe contener ÚNICAMENTE la geometría sólida de la pieza.
4) REGLA CRÍTICA: Excluye ABSOLUTAMENTE todas las líneas de dimensión (cotas), flechas, números de medidas, líneas de extensión y notas de texto que rodeen la pieza. El recorte debe verse "limpio" como una foto de catálogo.
5) Excluye el marco del plano, marcas de coordenadas en los bordes, cajetines y logos.
6) El bounding box debe estar bien centrado sobre la masa física de la pieza.
7) MULTI-PIEZA — REGLA OBLIGATORIA: si el plano contiene varias piezas (común en planos de variantes por tamaño, p.ej. HEX SWAGE BLOCK 7/32, 9/32, 3/8, 1/4, 5/16, 13/32, 7/16; o conjuntos de remaches, navajas, blocks, etc.), DEBES devolver UNA entrada por cada variante con su PROPIO bounding box centrado en SU geometría. NO devuelvas una sola entrada que englobe a todas. En "pieza_detectada" incluye el sufijo distintivo (tamaño, fracción, código, letra) que diferencia cada variante.
8) Si solo hay una pieza con varias vistas (frontal, lateral, isométrica), devuelve UNA sola entrada con el bbox de la vista isométrica.
9) Si no hay vistas útiles, devuelve [].
10) No inventes información.`,
                  },
                  prepareImagePart(workerResult.imageDataUrl),
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    pieza_detectada: { type: 'STRING' },
                    isometricBoundingBox: {
                      type: 'ARRAY',
                      items: { type: 'NUMBER' },
                    },
                    material: { type: 'STRING' },
                    dureza: { type: 'STRING' },
                    tratamiento: { type: 'STRING' },
                    acabado: { type: 'STRING' },
                  },
                  required: ['pieza_detectada', 'isometricBoundingBox'],
                },
              },
            },
          }),
        );
        const aiElapsed = performance.now() - blueprintAiStart;
        const initialSpecs = parseBlueprintResponse(response.text.trim());

        const refinedSpecs = await Promise.all(
          initialSpecs.map((spec) => refineSpecBox(workerResult.imageDataUrl, spec)),
        );

        const analysis: BlueprintAnalysis = {
          specs: refinedSpecs,
          image: workerResult.imageDataUrl,
        };
        await writeCachedValue('blueprint', hash, blueprintPromptVersion, analysis);
        onStatusPatch({ fileId: pdf.id, status: 'done' });
        taskResult = {
          index,
          fileId: pdf.id,
          fileLabel: pdf.relativePath,
          analysis,
          metrics: {
            pdfRasterMs: workerResult.metrics.pdfRasterMs + workerResult.metrics.normalizeMs,
            aiBlueprintMs: aiElapsed,
          },
        };
      } catch (e) {
        onStatusPatch({ fileId: pdf.id, status: 'error' });
        log.error('[smv-vision] blueprint analysis failed for', pdf.name, e);
        taskResult = {
          index,
          fileId: pdf.id,
          fileLabel: pdf.relativePath,
          analysis: { specs: [], image: '' },
          metrics: { pdfRasterMs: 0, aiBlueprintMs: 0 },
        };
      }

      await applyBlueprintToResults(taskResult);
      completedBlueprints += 1;
      onStep(`Analizando planos: ${completedBlueprints}/${totalBlueprints}`);
      return taskResult;
    },
  );

  for (const result of missResults) {
    blueprintTaskResults[result.index] = result;
  }

  let pdfRasterMs = 0;
  let aiBlueprintMs = 0;
  blueprintTaskResults.forEach((entry) => {
    if (entry) {
      pdfRasterMs += entry.metrics.pdfRasterMs;
      aiBlueprintMs += entry.metrics.aiBlueprintMs;
    }
  });

  return {
    blueprintTaskResults,
    pdfRasterMs,
    aiBlueprintMs,
    bestMatchByOrder,
    orderEnrichmentByIdx,
    matchedBlueprintFileIds,
  };
}
