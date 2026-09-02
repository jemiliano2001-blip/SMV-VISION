import type {
  ExtractedOrder,
  OrderDrawingLink,
  ToolcribActiveDrawingView,
  WorkshopPdfUpload,
} from '../../types';
import type { CatalogMatch } from './types';
import { listOrdersToInvoice, REPORT_PARTNER_KEY_PREFIX } from '../firebase/odooOrders';
import { listActiveDrawingViews } from '../firebase/toolcrib';
import { listPartAliases } from '../firebase/aliases';
import { normalizeAliasKey } from '../aliasKey';
import {
  MIN_BLUEPRINT_MATCH_SCORE,
  extractBlueprintSignals,
  extractLibrarySignals,
  extractOrderSignals,
  isIsoDrawingView,
  scorePieceMatch,
  selectLibraryDrawingMatch,
} from '../matching';
import { canonicalPartNumber } from '../toolcribCatalog';
import { isHotStampCatalogEntry, isHotStampPiece } from '../hotStamp';
import { fetchPdfAsDataUrl } from '../fetchPdf';
import { rasterizeAndNormalizePdf } from '../documentAnalysis/pdfWorkerClient';
import { getReportDrawingSnapshot, viewFromSnapshot } from '../orderDrawingBridge';
import { log } from '../log';

export interface FetchOrdersAndMatchOptions {
  currentWorkshopPdfs: WorkshopPdfUpload[];
  toolcribPdfToDrawing: Record<string, string>;
  seededBridgeLinks: OrderDrawingLink[];
  onStep: (step: string) => void;
}

export interface FetchOrdersAndMatchResult {
  ordersList: ExtractedOrder[];
  matchByOrder: Map<ExtractedOrder, CatalogMatch>;
  newUploads: WorkshopPdfUpload[];
  newDrawingMap: Record<string, string>;
  hotStampRefImage: string | null;
  orderFetchMs: number;
  currentWorkshopPdfs: WorkshopPdfUpload[];
}

export async function fetchOrdersAndMatch({
  currentWorkshopPdfs,
  toolcribPdfToDrawing,
  seededBridgeLinks,
  onStep,
}: FetchOrdersAndMatchOptions): Promise<FetchOrdersAndMatchResult> {
  const updatedPdfs = [...currentWorkshopPdfs];
  onStep('Leyendo Odoo y biblioteca...');
  const orderAiStart = performance.now();

  const [odooResult, libResult] = await Promise.all([
    listOrdersToInvoice({ partnerKeyPrefix: REPORT_PARTNER_KEY_PREFIX }),
    listActiveDrawingViews({ customer: 'SUPRAJIT' }),
  ]);

  const orderFetchMs = performance.now() - orderAiStart;

  if (!odooResult.ok) {
    throw new Error('Fallo al obtener órdenes de Odoo');
  }

  // Mapear órdenes de Odoo a ExtractedOrder, excluyendo líneas completamente entregadas.
  const rawOrders: ExtractedOrder[] = [];
  for (const order of odooResult.value) {
    for (const line of order.order_lines) {
      const qty =
        line.qty_pending_from_pickings !== undefined
          ? line.qty_pending_from_pickings
          : line.qty_pending;

      if (qty <= 0) continue;

      let numeroParte = '';
      let piezaName = line.product;

      const bracketMatch = line.product.match(/^\[(.*?)\]\s*(.*)$/);
      if (bracketMatch) {
        numeroParte = bracketMatch[1];
        piezaName = bracketMatch[2];
      }

      const fullPieza =
        line.description && line.description !== piezaName
          ? `${piezaName} - ${line.description}`
          : piezaName;

      rawOrders.push({
        pieza: fullPieza,
        numero_parte: numeroParte,
        cantidad: qty.toString(),
        orden: order.name,
        fecha: order.date_order ? order.date_order.split(' ')[0] : '',
        prioridad: 'Normal',
        poNumber: order.client_order_ref ?? '',
      });
    }
  }

  const ordersList = rawOrders;
  const matchByOrder = new Map<ExtractedOrder, CatalogMatch>();
  const newUploads: WorkshopPdfUpload[] = [];
  const newDrawingMap: Record<string, string> = {};
  let hotStampRefImage: string | null = null;

  onStep('Buscando planos en biblioteca...');
  log.debug(
    '[smv-vision][library] resultado:',
    libResult.ok
      ? `${libResult.value.length} entradas`
      : `FALLO: ${(libResult as { ok: false; reason: string }).reason}`,
  );

  if (libResult.ok) {
    const library = libResult.value;
    log.debug(
      '[smv-vision][library] entradas cargadas:',
      library.map((v) => `${v.partNumber} pdfUrl=${v.pdfUrl ? '✓' : '✗null'}`),
    );
    const autoAttachedIds = new Set(Object.values(toolcribPdfToDrawing));

    const aliasResult = await listPartAliases();
    const aliases = aliasResult.ok ? aliasResult.value : [];

    const librarySignals = new Map(
      library.map((view) => [view.drawingId, extractLibrarySignals(view)]),
    );
    const manualPdfSignals = updatedPdfs.map((pdf) => ({
      pdf,
      signals: extractBlueprintSignals(pdf.relativePath, []),
    }));

    const toFetchMap = new Map<string, { bestView: ToolcribActiveDrawingView; pdfId: string }>();
    const noUrlMatches: Array<{ pieza: string; partNumber: string; drawingId: string }> = [];

    const queueFetch = (view: ToolcribActiveDrawingView) => {
      if (!view.pdfUrl) {
        noUrlMatches.push({
          pieza: view.description || view.partNumber,
          partNumber: view.partNumber,
          drawingId: view.drawingId,
        });
        return;
      }
      if (!autoAttachedIds.has(view.drawingId) && !toFetchMap.has(view.drawingId)) {
        toFetchMap.set(view.drawingId, {
          bestView: view,
          pdfId: `toolcrib-${view.drawingId}-${crypto.randomUUID()}`,
        });
      }
    };

    for (const order of ordersList) {
      const orderSignals = extractOrderSignals(order.pieza, order.numero_parte);

      const hasManualMatch = manualPdfSignals.some(
        ({ signals }) => scorePieceMatch(orderSignals, signals) >= MIN_BLUEPRINT_MATCH_SCORE,
      );
      if (hasManualMatch) continue;

      const seeded = seededBridgeLinks.find((l) => {
        if (l.soNumber !== order.orden) return false;
        if (l.numeroParte && order.numero_parte) {
          return l.numeroParte === order.numero_parte;
        }
        return l.pieza === order.pieza;
      });
      const seededSnap = seeded ? getReportDrawingSnapshot(seeded) : null;
      if (seededSnap) {
        const seededView =
          library.find((v) => v.drawingId === seededSnap.drawingId) ??
          viewFromSnapshot(seededSnap);
        matchByOrder.set(order, {
          drawingId: seededView.drawingId,
          partId: seededView.partId,
          score: seeded?.matchScore ?? 100,
          revision: seededView.revision,
          stlUrl: seededView.stlUrl,
          matchSource: seeded?.status === 'manual' ? 'alias' : 'seed',
        });
        queueFetch(seededView);
        continue;
      }

      if (aliases.length > 0) {
        const aliasCandidates = new Set(
          [order.numero_parte, order.pieza]
            .map(normalizeAliasKey)
            .filter((value) => value.length > 0),
        );
        const matchedAlias = aliases.find((a) =>
          aliasCandidates.has(normalizeAliasKey(a.pattern)),
        );
        if (matchedAlias) {
          const canonicalAlias = canonicalPartNumber(matchedAlias.partNumber).toUpperCase();
          const aliasView = library.find(
            (v) =>
              (matchedAlias.drawingId && v.drawingId === matchedAlias.drawingId) ||
              v.partNumber.toUpperCase() === matchedAlias.partNumber.toUpperCase() ||
              canonicalPartNumber(v.partNumber).toUpperCase() === canonicalAlias,
          );
          if (aliasView) {
            // Regla ISO-first para reporte: si el alias apuntaba a CAD pero la pieza tiene ISO,
            // preferir el ISO para la inspección visual.
            const canonical = canonicalPartNumber(aliasView.partNumber).toUpperCase();
            const reportView = isIsoDrawingView(aliasView)
              ? aliasView
              : (library.find((v) => isIsoDrawingView(v) && canonicalPartNumber(v.partNumber).toUpperCase() === canonical) ?? aliasView);

            matchByOrder.set(order, {
              drawingId: reportView.drawingId,
              partId: reportView.partId,
              score: 100,
              revision: reportView.revision,
              stlUrl: reportView.stlUrl,
              matchSource: 'alias',
            });
            queueFetch(reportView);
            continue;
          }
        }
      }

      const { view: bestView, score: bestScore } =
        selectLibraryDrawingMatch(orderSignals, library, librarySignals);

      log.debug(
        '[smv-vision][match]',
        order.pieza,
        '→ best:',
        bestView
          ? `${bestView.partNumber} (score ${bestScore}, pdfUrl: ${bestView.pdfUrl ? '✓' : '✗null'})`
          : 'sin coincidencia',
      );

      if (bestView && bestScore >= MIN_BLUEPRINT_MATCH_SCORE) {
        if (!bestView.pdfUrl) {
          log.warn(
            '[smv-vision][match] coincidencia encontrada sin pdfUrl (plano en red, no en Storage):',
            order.pieza,
            '→',
            bestView.partNumber,
            `(drawingId: ${bestView.drawingId})`,
          );
          noUrlMatches.push({
            pieza: order.pieza,
            partNumber: bestView.partNumber,
            drawingId: bestView.drawingId,
          });
        } else {
          queueFetch(bestView);
        }
        matchByOrder.set(order, {
          drawingId: bestView.drawingId,
          partId: bestView.partId,
          score: bestScore,
          revision: bestView.revision,
          stlUrl: bestView.stlUrl,
          matchSource: 'fuzzy',
        });
      }
    }

    if (noUrlMatches.length > 0) {
      log.warn(
        '[smv-vision] Planos encontrados en catálogo pero sin URL de descarga (subir a Firebase Storage):',
        noUrlMatches.map((m) => `${m.pieza} → ${m.partNumber}`).join(', '),
      );
    }

    const hotStampOrders = ordersList.filter((o) => isHotStampPiece(o.pieza));
    if (hotStampOrders.length >= 2) {
      const hotStampEntry =
        library.find(
          (v) =>
            isHotStampCatalogEntry(v) &&
            (v.partNumber.toLowerCase().includes('.iso') ||
              (v.sourcePath ?? '').toLowerCase().includes('.iso')),
        ) ?? library.find((v) => isHotStampCatalogEntry(v));

      if (hotStampEntry?.pdfUrl) {
        try {
          const hsDataUrl = await fetchPdfAsDataUrl(hotStampEntry.pdfUrl);
          const hsRaster = await rasterizeAndNormalizePdf(hsDataUrl, {
            maxDim: 1024,
            renderScale: 1.5,
            jpegQuality: 0.8,
            normalizeQuality: 0.78,
          });
          hotStampRefImage = hsRaster.imageDataUrl;
          log.debug(
            '[smv-vision][hot-stamp] ISO de referencia rasterizado:',
            hotStampEntry.partNumber,
          );
        } catch (e) {
          log.warn('[smv-vision][hot-stamp] Error al rasterizar ISO de referencia:', e);
        }
      }
    }

    if (toFetchMap.size > 0) {
      onStep(`Auto-adjuntando ${toFetchMap.size} plano(s)...`);
      const fetchResults = await Promise.allSettled(
        [...toFetchMap.values()].map(async ({ bestView, pdfId }) => {
          const dataUrl = await fetchPdfAsDataUrl(bestView.pdfUrl!);
          return { bestView, pdfId, dataUrl };
        }),
      );

      for (const result of fetchResults) {
        if (result.status === 'rejected') {
          log.warn('[smv-vision] auto-attach fetch failed', result.reason);
          continue;
        }
        const { bestView, pdfId, dataUrl } = result.value;
        const newUpload: WorkshopPdfUpload = {
          id: pdfId,
          name: `${bestView.partNumber} (Rev ${bestView.revision}).pdf`,
          relativePath: bestView.sourcePath || bestView.partNumber,
          dataUrl,
        };
        newUploads.push(newUpload);
        newDrawingMap[pdfId] = bestView.drawingId;
        updatedPdfs.push(newUpload);
      }
    }
  }

  return {
    ordersList,
    matchByOrder,
    newUploads,
    newDrawingMap,
    hotStampRefImage,
    orderFetchMs,
    currentWorkshopPdfs: updatedPdfs,
  };
}
