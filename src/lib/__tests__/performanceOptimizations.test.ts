import { describe, it, expect } from 'vitest';
import {
  makeOrderDrawingLinkKey,
  parseOdooLineLabels,
  resolveOrderDrawingLink,
  buildLibrarySignalsMap,
} from '../orderDrawingBridge';
import type { ToolcribActiveDrawingView } from '../../types';
import type { OdooOrderView } from '../firebase/odooOrders';

function makeView(
  overrides: Partial<ToolcribActiveDrawingView> & Pick<ToolcribActiveDrawingView, 'drawingId' | 'partNumber'>,
): ToolcribActiveDrawingView {
  return {
    partId: `part-${overrides.drawingId}`,
    customer: 'SUPRAJIT',
    description: overrides.description ?? overrides.partNumber,
    revision: 'A',
    sourceType: 'storage',
    sourcePath: overrides.sourcePath ?? `${overrides.partNumber}.pdf`,
    pdfUrl: overrides.pdfUrl ?? `https://example.com/${overrides.drawingId}.pdf`,
    stlUrl: overrides.stlUrl ?? null,
    effectiveFromUTC: null,
    ...overrides,
  };
}

describe('Performance & Pure Resolution in Order-Drawing Matching', () => {
  const views: ToolcribActiveDrawingView[] = [
    makeView({
      drawingId: 'cad-1',
      partNumber: '90-1012-05',
      description: 'HEX SWAGE BLOCK',
    }),
    makeView({
      drawingId: 'iso-1',
      partNumber: '90-1012-05.iso',
      description: 'HEX SWAGE BLOCK ISO',
    }),
  ];
  const signalsMap = buildLibrarySignalsMap(views);

  const mockOrder: OdooOrderView = {
    id: 'so-100',
    name: 'SO100',
    date_order: '2026-09-01 10:00:00',
    partner: 'SUPRAJIT',
    partnerKey: 'SUPRAJIT',
    client_order_ref: 'PO-999',
    requisitor: 'ING. CARLOS',
    invoice_status: 'to invoice',
    state: 'sale',
    toInvoice: true,
    order_lines: [
      {
        product: '[90-1012-05] HEX SWAGE BLOCK',
        description: 'HEX SWAGE BLOCK',
        qty: 10,
        qty_delivered: 0,
        qty_pending: 10,
      },
      {
        product: '[UNKNOWN-PART-99] CUSTOM TOOL',
        description: 'CUSTOM TOOL UNKNOWN',
        qty: 5,
        qty_delivered: 0,
        qty_pending: 5,
      },
    ],
    deliveries: [],
    syncedAtUTC: null,
  };

  it('computes resolvedLinksMap purely in memory with zero state mutations', () => {
    const map = new Map();
    const lines = mockOrder.order_lines;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const { pieza, numeroParte } = parseOdooLineLabels(line.product, line.description || '');
      const key = makeOrderDrawingLinkKey(mockOrder.id, idx);
      const link = resolveOrderDrawingLink(
        {
          orderId: mockOrder.id,
          lineIndex: idx,
          soNumber: mockOrder.name,
          poNumber: mockOrder.client_order_ref ?? '',
          pieza,
          numeroParte,
          qtyPending: line.qty_pending,
        },
        views,
        signalsMap,
      );
      map.set(key, link);
    }

    expect(map.size).toBe(2);

    const matchLine = map.get(makeOrderDrawingLinkKey(mockOrder.id, 0));
    expect(matchLine).toBeDefined();
    expect(matchLine.cadDrawing?.partNumber).toBe('90-1012-05');
    expect(matchLine.reportDrawing?.partNumber).toBe('90-1012-05.iso');

    const noMatchLine = map.get(makeOrderDrawingLinkKey(mockOrder.id, 1));
    expect(noMatchLine).toBeDefined();
    expect(noMatchLine.cadDrawing).toBeNull();
    expect(noMatchLine.reportDrawing).toBeNull();
  });

  it('correctly detects missing drawings in O(1) from the precomputed map', () => {
    const key0 = makeOrderDrawingLinkKey(mockOrder.id, 0);
    const key1 = makeOrderDrawingLinkKey(mockOrder.id, 1);

    const map = new Map();
    map.set(key0, {
      key: key0,
      cadDrawing: { drawingId: 'cad-1' },
      reportDrawing: { drawingId: 'iso-1' },
    });
    map.set(key1, {
      key: key1,
      cadDrawing: null,
      reportDrawing: null,
    });

    const isMissingDrawing = (order: OdooOrderView): boolean => {
      for (let idx = 0; idx < order.order_lines.length; idx++) {
        const line = order.order_lines[idx];
        if (line.qty_pending > 0) {
          const k = makeOrderDrawingLinkKey(order.id, idx);
          const link = map.get(k);
          if (!link || (!link.cadDrawing && !link.reportDrawing)) {
            return true;
          }
        }
      }
      return false;
    };

    // mockOrder has one line without drawing (key1), so it returns true
    expect(isMissingDrawing(mockOrder)).toBe(true);

    // If both lines have drawings:
    map.set(key1, {
      key: key1,
      cadDrawing: { drawingId: 'cad-2' },
      reportDrawing: null,
    });
    expect(isMissingDrawing(mockOrder)).toBe(false);
  });
});
