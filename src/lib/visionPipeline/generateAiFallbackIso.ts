import type { Order } from '../../types';
import { MAX_ISO_GEN_CONCURRENCY } from './types';
import {
  canGenerateAiIsometric,
  generateIsometricImageFromDrawing,
  ISOMETRIC_GEN_PROMPT_VERSION,
} from '../generateIsometricImage';
import {
  createDocumentHash,
  readCachedValue,
  writeCachedValue,
} from '../documentAnalysis/cache';
import { runWithConcurrencyLimit } from '../documentAnalysis/concurrency';
import { log } from '../log';

export interface GenerateAiFallbackIsoOptions {
  bestMatchByOrder: Map<number, { score: number; fileId: string; isIso: boolean }>;
  orderEnrichmentByIdx: Map<number, Partial<Order>>;
  onStep: (step: string) => void;
  onApplyIso: (orderIdx: number, partial: Partial<Order>) => void;
}

export async function generateAiFallbackIso({
  bestMatchByOrder,
  orderEnrichmentByIdx,
  onStep,
  onApplyIso,
}: GenerateAiFallbackIsoOptions): Promise<void> {
  const cadOnlyIdxs: number[] = [];
  for (const [idx, match] of bestMatchByOrder) {
    if (match.isIso) continue;
    const enrichment = orderEnrichmentByIdx.get(idx);
    if (
      !canGenerateAiIsometric({
        sourceImageDataUrl: enrichment?.sourceImageDataUrl,
        isometricView: enrichment?.isometricView,
        sourcePdfName: enrichment?.sourcePdfName,
      })
    ) {
      continue;
    }
    cadOnlyIdxs.push(idx);
  }

  if (cadOnlyIdxs.length === 0) return;

  onStep(`Generando vistas 3D (IA): 0/${cadOnlyIdxs.length}`);
  let isoGenDone = 0;

  await runWithConcurrencyLimit(
    cadOnlyIdxs,
    MAX_ISO_GEN_CONCURRENCY,
    async (orderIdx) => {
      const enrichment = orderEnrichmentByIdx.get(orderIdx);
      const source =
        enrichment?.sourceImageDataUrl ?? enrichment?.isometricView ?? null;
      if (!source) {
        isoGenDone += 1;
        onStep(`Generando vistas 3D (IA): ${isoGenDone}/${cadOnlyIdxs.length}`);
        return;
      }
      try {
        const hash = await createDocumentHash(source);
        const cached = await readCachedValue<string>(
          'iso-gen',
          hash,
          ISOMETRIC_GEN_PROMPT_VERSION,
        );
        let generated = cached;
        if (!generated) {
          generated = await generateIsometricImageFromDrawing({
            sourceImageDataUrl: source,
          });
          if (generated) {
            await writeCachedValue('iso-gen', hash, ISOMETRIC_GEN_PROMPT_VERSION, generated);
          }
        }
        if (generated) {
          const partial: Partial<Order> = {
            isometricView: generated,
            isometricSource: 'ai-generated',
          };
          const prev = orderEnrichmentByIdx.get(orderIdx) ?? {};
          orderEnrichmentByIdx.set(orderIdx, { ...prev, ...partial });
          onApplyIso(orderIdx, partial);
        }
      } catch (e) {
        log.warn('[smv-vision][iso-gen] falló para orden', orderIdx, e);
      } finally {
        isoGenDone += 1;
        onStep(`Generando vistas 3D (IA): ${isoGenDone}/${cadOnlyIdxs.length}`);
      }
    },
  );
}
