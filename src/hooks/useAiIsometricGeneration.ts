import { useCallback, useState } from 'react';
import type { Order } from '../types';
import {
  canGenerateAiIsometric,
  generateIsometricImageFromDrawing,
  ISOMETRIC_GEN_PROMPT_VERSION,
} from '../lib/generateIsometricImage';
import {
  createDocumentHash,
  readCachedValue,
  writeCachedValue,
} from '../lib/documentAnalysis/cache';
import { log } from '../lib/log';

export interface UseAiIsometricGenerationOptions {
  setResults: React.Dispatch<React.SetStateAction<Order[] | null>>;
  snapshotOriginalOnce: () => void;
  setError: (msg: string | null) => void;
}

export function useAiIsometricGeneration({
  setResults,
  snapshotOriginalOnce,
  setError,
}: UseAiIsometricGenerationOptions) {
  /** Orden en curso de generación 3D IA (`orderAiKey`), o null. */
  const [aiIsoGeneratingKey, setAiIsoGeneratingKey] = useState<string | null>(null);

  const orderAiKey = useCallback((order: Order): string => {
    return `${order.orden}::${order.pieza}::${order.numero_parte ?? ''}::${order.sourcePdfName ?? ''}`;
  }, []);

  /**
   * Genera vista 3D con Gemini a partir del plano 2D de una orden.
   * Usa cache IndexedDB; marca `isometricSource: 'ai-generated'`.
   */
  const generateAiIsometricForOrder = useCallback(
    async (order: Order): Promise<void> => {
      if (!canGenerateAiIsometric(order)) {
        setError(
          'No se puede generar 3D IA: falta imagen del plano 2D, o el plano ya es un ISO real.',
        );
        return;
      }
      const source = order.sourceImageDataUrl ?? order.isometricView;
      if (!source) return;

      const key = orderAiKey(order);
      setAiIsoGeneratingKey(key);
      setError(null);
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
        if (!generated) {
          setError('Gemini no devolvió una imagen 3D. Intenta de nuevo o revisa el plano.');
          return;
        }
        snapshotOriginalOnce();
        setResults((prev) => {
          if (!prev) return prev;
          return prev.map((row) =>
            row === order || orderAiKey(row) === key
              ? {
                  ...row,
                  isometricView: generated,
                  isometricSource: 'ai-generated',
                  haSidoAuditada: true,
                }
              : row,
          );
        });
      } catch (e) {
        log.warn('[smv-vision][iso-gen] generateAiIsometricForOrder falló', e);
        const message = e instanceof Error ? e.message : String(e);
        setError(`Error generando vista 3D IA: ${message}`);
      } finally {
        setAiIsoGeneratingKey(null);
      }
    },
    [orderAiKey, snapshotOriginalOnce, setResults, setError],
  );

  const isAiIsoGenerating = useCallback(
    (order: Order) => aiIsoGeneratingKey === orderAiKey(order),
    [aiIsoGeneratingKey, orderAiKey],
  );

  return {
    aiIsoGeneratingKey,
    orderAiKey,
    generateAiIsometricForOrder,
    isAiIsoGenerating,
  };
}
