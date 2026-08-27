import { useCallback, useState } from 'react';
import type { OdooOrderView, OdooOrderLineView } from '../lib/firebase/odooOrders';
import type { ToolcribActiveDrawingView, OrderDrawingLink } from '../types';
import type { UseOrderDrawingBridgeResult } from './useOrderDrawingBridge';
import { recordToolcribPrintLogFireAndForget } from '../lib/firebase/toolcrib';
import { makeOrderDrawingLinkKey } from '../lib/orderDrawingBridge';
import { openStampedPlanoOtBatch, type BatchPlanoOtItem } from '../lib/planoOt';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { log } from '../lib/log';

export interface UseBatchPrintOtsOptions {
  orders: OdooOrderView[];
  bridge: UseOrderDrawingBridgeResult;
  ensureCatalogViews: () => Promise<readonly ToolcribActiveDrawingView[] | null>;
  resolveLineLink: (
    order: OdooOrderView,
    line: OdooOrderLineView,
    lineIdx: number,
    library: readonly ToolcribActiveDrawingView[],
  ) => OrderDrawingLink;
  onError: (msg: string | null) => void;
}

export function useBatchPrintOts({
  orders,
  bridge,
  ensureCatalogViews,
  resolveLineLink,
  onError,
}: UseBatchPrintOtsOptions) {
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [batchPrintStatus, setBatchPrintStatus] = useState<string | null>(null);

  const clearSelection = useCallback(() => {
    setSelectedLines(new Set());
  }, []);

  const toggleSelectLine = useCallback((lineKey: string) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineKey)) {
        next.delete(lineKey);
      } else {
        next.add(lineKey);
      }
      return next;
    });
  }, []);

  const toggleSelectAllInOrder = useCallback((order: OdooOrderView) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      const orderLineKeys = order.order_lines
        .map((l, idx) => ({ l, key: makeOrderDrawingLinkKey(order.id, idx) }))
        .filter(({ l }) => l.qty_pending > 0)
        .map(({ key }) => key);

      const allSelected = orderLineKeys.length > 0 && orderLineKeys.every((k) => next.has(k));
      if (allSelected) {
        orderLineKeys.forEach((k) => next.delete(k));
      } else {
        orderLineKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  }, []);

  const handleBatchPrintOts = useCallback(async () => {
    if (selectedLines.size === 0) return;
    setBatchPrinting(true);
    onError(null);
    setBatchPrintStatus(`Preparando catálogo para ${selectedLines.size} OTs…`);

    try {
      const library = await ensureCatalogViews();
      if (!library) {
        onError('No se pudo cargar el catálogo de planos.');
        setBatchPrinting(false);
        setBatchPrintStatus(null);
        return;
      }

      const items: BatchPlanoOtItem[] = [];
      const now = new Date();
      const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      let processedCount = 0;
      for (const order of orders) {
        for (let idx = 0; idx < order.order_lines.length; idx++) {
          const line = order.order_lines[idx];
          const lineKey = makeOrderDrawingLinkKey(order.id, idx);
          if (!selectedLines.has(lineKey) || line.qty_pending <= 0) continue;

          processedCount += 1;
          setBatchPrintStatus(`Descargando plano ${processedCount} de ${selectedLines.size}…`);

          const link = resolveLineLink(order, line, idx, library);
          const cadView = bridge.getCadViewForPrint(link);
          if (!cadView || !cadView.pdfUrl) {
            log.warn(`[batch-print] Sin plano accesible para ${line.product}`);
            continue;
          }

          try {
            const pdfDataUrl = await fetchPdfAsDataUrl(cadView.pdfUrl);
            items.push({
              pdfDataUrl,
              stamp: {
                soNumber: order.name,
                cantidad: String(line.qty_pending),
                fecha,
                notas: line.description ? line.description.slice(0, 80) : undefined,
              },
              partNumber: cadView.partNumber,
              revision: cadView.revision,
            });

            // Log de impresión audit trail
            recordToolcribPrintLogFireAndForget({
              drawingId: cadView.drawingId,
              partId: cadView.partId,
              copies: 1,
              orderRef: order.name,
            });
          } catch (err) {
            log.warn(`[batch-print] Error descargando ${cadView.partNumber}`, err);
          }
        }
      }

      if (items.length === 0) {
        onError('Ninguna de las líneas seleccionadas tiene un plano CAD descargable.');
        return;
      }

      setBatchPrintStatus(`Combinando y sellando ${items.length} planos…`);
      await openStampedPlanoOtBatch(items);
      setSelectedLines(new Set());
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error al procesar lote de OTs.');
    } finally {
      setBatchPrinting(false);
      setBatchPrintStatus(null);
    }
  }, [selectedLines, orders, ensureCatalogViews, resolveLineLink, bridge, onError]);

  return {
    selectedLines,
    setSelectedLines,
    clearSelection,
    batchPrinting,
    batchPrintStatus,
    toggleSelectLine,
    toggleSelectAllInOrder,
    handleBatchPrintOts,
  };
}
