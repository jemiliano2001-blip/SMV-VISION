import { useCallback, useState } from 'react';
import type { OdooOrderView, OdooOrderLineView } from '../lib/firebase/odooOrders';
import type { OrderDrawingLink, ToolcribActiveDrawingView } from '../types';
import type { UseToolcribCatalogResult } from './useToolcribCatalog';
import type { UseOrderDrawingBridgeResult } from './useOrderDrawingBridge';
import { makeOrderDrawingLinkKey, parseOdooLineLabels } from '../lib/orderDrawingBridge';

export interface UseOdooLineActionsOptions {
  catalog: UseToolcribCatalogResult;
  bridge: UseOrderDrawingBridgeResult;
  onSendToReport: (link: OrderDrawingLink) => Promise<void>;
  onOpenBiblioteca: (query: string, linkKey: string) => void;
}

export function useOdooLineActions({
  catalog,
  bridge,
  onSendToReport,
  onOpenBiblioteca,
}: UseOdooLineActionsOptions) {
  const [printDrawing, setPrintDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const [printSoNumber, setPrintSoNumber] = useState('');
  const [printCantidad, setPrintCantidad] = useState('');
  const [lineBusyKey, setLineBusyKey] = useState<string | null>(null);
  const [lineActionError, setLineActionError] = useState<string | null>(null);
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  const catalogErrorMessage = useCallback((): string => {
    return catalog.errorReason === 'not-configured'
      ? 'Firebase no está configurado para la biblioteca.'
      : catalog.errorReason === 'not-authenticated'
        ? 'Inicia sesión para buscar planos en la biblioteca.'
        : 'No fue posible cargar la biblioteca de planos.';
  }, [catalog.errorReason]);

  const ensureCatalogViews = useCallback(async (): Promise<readonly ToolcribActiveDrawingView[] | null> => {
    if (catalog.status === 'ready') {
      return catalog.views;
    }
    if (catalog.status === 'loading') {
      setLineActionError('Cargando catálogo de planos…');
      return null;
    }
    const loaded = await catalog.reload();
    if (!loaded) {
      setLineActionError(catalogErrorMessage());
      return null;
    }
    return loaded;
  }, [catalog, catalogErrorMessage]);

  const resolveLineLink = useCallback(
    (
      order: OdooOrderView,
      line: OdooOrderLineView,
      lineIdx: number,
      library: readonly ToolcribActiveDrawingView[],
    ): OrderDrawingLink => {
      const { pieza, numeroParte } = parseOdooLineLabels(line.product, line.description || '');
      return bridge.resolveAndStore(
        {
          orderId: order.id,
          lineIndex: lineIdx,
          soNumber: order.name,
          poNumber: order.client_order_ref ?? '',
          pieza,
          numeroParte,
          qtyPending: line.qty_pending,
        },
        library,
        undefined,
      );
    },
    [bridge],
  );

  const handlePrintLinePlano = useCallback(
    async (order: OdooOrderView, line: OdooOrderLineView, lineIdx: number) => {
      const key = makeOrderDrawingLinkKey(order.id, lineIdx);
      setLineBusyKey(key);
      setLineActionError(null);

      const library = await ensureCatalogViews();
      if (!library) {
        setLineBusyKey(null);
        return;
      }

      const link = resolveLineLink(order, line, lineIdx, library);
      const cadView = bridge.getCadViewForPrint(link);
      if (!cadView) {
        setLineActionError('No hay plano CAD en biblioteca para esta pieza.');
        setLineBusyKey(null);
        return;
      }

      setPrintSoNumber(order.name);
      setPrintCantidad(String(line.qty_pending));
      setPrintDrawing(cadView);
      setLineBusyKey(null);
    },
    [ensureCatalogViews, resolveLineLink, bridge],
  );

  const handleSendLineToReport = useCallback(
    async (order: OdooOrderView, line: OdooOrderLineView, lineIdx: number) => {
      const key = makeOrderDrawingLinkKey(order.id, lineIdx);
      setSendingKey(key);
      setLineActionError(null);

      const library = await ensureCatalogViews();
      if (!library) {
        setSendingKey(null);
        return;
      }

      const link = resolveLineLink(order, line, lineIdx, library);
      const reportSnap = bridge.getReportSnapshot(link);
      if (!reportSnap) {
        setLineActionError('No hay plano (ISO/CAD) para enviar al reporte.');
        setSendingKey(null);
        return;
      }
      if (!reportSnap.pdfUrl) {
        setLineActionError(`El plano ${reportSnap.partNumber} no tiene URL descargable.`);
        setSendingKey(null);
        return;
      }

      try {
        await onSendToReport(link);
      } catch {
        setLineActionError('No se pudo enviar al reporte. Revisa la conexión.');
      } finally {
        setSendingKey(null);
      }
    },
    [ensureCatalogViews, resolveLineLink, bridge, onSendToReport],
  );

  const handleSendOrderToReport = useCallback(
    async (order: OdooOrderView) => {
      setSendingKey(order.id);
      setLineActionError(null);

      const library = await ensureCatalogViews();
      if (!library) {
        setSendingKey(null);
        return;
      }

      let sentCount = 0;
      let skippedCount = 0;

      for (let idx = 0; idx < order.order_lines.length; idx++) {
        const line = order.order_lines[idx];
        const pending = line.qty_pending_from_pickings ?? line.qty_pending;
        if (pending <= 0) continue;

        const link = resolveLineLink(order, line, idx, library);
        const reportSnap = bridge.getReportSnapshot(link);
        if (!reportSnap || !reportSnap.pdfUrl) {
          skippedCount++;
          continue;
        }

        try {
          await onSendToReport(link);
          sentCount++;
        } catch {
          // continue with other lines
        }
      }

      if (sentCount === 0 && skippedCount > 0) {
        setLineActionError('Ninguna línea de esta orden tiene plano con PDF descargable asociado.');
      }
      setSendingKey(null);
    },
    [ensureCatalogViews, resolveLineLink, bridge, onSendToReport]
  );

  const handleOpenBibliotecaForLine = useCallback(
    (order: OdooOrderView, line: OdooOrderLineView, lineIdx: number) => {
      const library = catalog.views;
      resolveLineLink(order, line, lineIdx, library);
      const { pieza, numeroParte, productLabel } = parseOdooLineLabels(
        line.product,
        line.description || '',
      );
      const query = (numeroParte || productLabel || pieza).trim();
      const linkKey = makeOrderDrawingLinkKey(order.id, lineIdx);
      onOpenBiblioteca(query, linkKey);
    },
    [catalog.views, resolveLineLink, onOpenBiblioteca],
  );

  return {
    lineBusyKey,
    lineActionError,
    setLineActionError,
    sendingKey,
    printDrawing,
    setPrintDrawing,
    printSoNumber,
    printCantidad,
    ensureCatalogViews,
    resolveLineLink,
    handlePrintLinePlano,
    handleSendLineToReport,
    handleSendOrderToReport,
    handleOpenBibliotecaForLine,
  };
}
