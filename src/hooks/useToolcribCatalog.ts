/**
 * Catálogo Tool Crib cacheado en sesión: una carga, invalidate manual.
 * Evita que cada "Imprimir" en Órdenes vuelva a pegarle a Firestore.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listActiveDrawingViews } from '../lib/firebase/toolcrib';
import type { ToolcribFailureReason } from '../lib/firebase/toolcrib';
import { buildLibrarySignalsMap } from '../lib/orderDrawingBridge';
import type { ToolcribActiveDrawingView } from '../types';
import type { PieceMatchSignals } from '../lib/matching';

export type ToolcribCatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseToolcribCatalogResult {
  status: ToolcribCatalogStatus;
  views: readonly ToolcribActiveDrawingView[];
  errorReason: ToolcribFailureReason | null;
  signalsByDrawingId: ReadonlyMap<string, PieceMatchSignals>;
  /**
   * Recarga el catálogo. Devuelve las vistas si ok; null si falló
   * (así el caller no depende del state de React aún no flushed).
   */
  reload: () => Promise<ToolcribActiveDrawingView[] | null>;
}

export function useToolcribCatalog(
  customer: string = 'SUPRAJIT',
): UseToolcribCatalogResult {
  const [status, setStatus] = useState<ToolcribCatalogStatus>('idle');
  const [views, setViews] = useState<ToolcribActiveDrawingView[]>([]);
  const [errorReason, setErrorReason] = useState<ToolcribFailureReason | null>(null);

  const reload = useCallback(async (): Promise<ToolcribActiveDrawingView[] | null> => {
    setStatus('loading');
    setErrorReason(null);
    const result = await listActiveDrawingViews({ customer });
    if (result.ok === false) {
      setViews([]);
      setErrorReason(result.reason);
      setStatus('error');
      return null;
    }
    setViews(result.value);
    setErrorReason(null);
    setStatus('ready');
    return result.value;
  }, [customer]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const signalsByDrawingId = useMemo(
    () => buildLibrarySignalsMap(views),
    [views],
  );

  return {
    status,
    views,
    errorReason,
    signalsByDrawingId,
    reload,
  };
}
