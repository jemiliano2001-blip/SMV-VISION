import { describe, it, expect } from 'vitest';
import {
  applyManualDrawingToLink,
  getCadDrawingSnapshot,
  getReportDrawingSnapshot,
  makeOrderDrawingLinkKey,
  parseOdooLineLabels,
  resolveOrderDrawingLink,
  snapshotFromView,
} from '../orderDrawingBridge';
import type { ToolcribActiveDrawingView } from '../../types';

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

describe('makeOrderDrawingLinkKey', () => {
  it('joins orderId and lineIndex', () => {
    expect(makeOrderDrawingLinkKey('2026_S00781', 2)).toBe('2026_S00781:2');
  });
});

describe('parseOdooLineLabels', () => {
  it('extracts bracket part number and combines description', () => {
    const r = parseOdooLineLabels('[90-1012-05] HEX BLOCK', 'HEX SWAGE BLOCK');
    expect(r.numeroParte).toBe('90-1012-05');
    expect(r.pieza).toContain('HEX');
  });
});

describe('resolveOrderDrawingLink', () => {
  const cad = makeView({
    drawingId: 'cad-1',
    partNumber: '90-1012-05',
    description: 'HEX SWAGE BLOCK',
  });
  const iso = makeView({
    drawingId: 'iso-1',
    partNumber: '90-1012-05.iso',
    description: 'HEX SWAGE BLOCK ISO',
    sourcePath: '90-1012-05.iso.pdf',
  });

  it('links CAD for print and ISO for report when both match', () => {
    const link = resolveOrderDrawingLink(
      {
        orderId: 'o1',
        lineIndex: 0,
        soNumber: '2026/S00001',
        poNumber: 'PO-1',
        pieza: 'HEX SWAGE BLOCK',
        numeroParte: '90-1012-05',
        qtyPending: 3,
      },
      [cad, iso],
    );

    expect(link.key).toBe('o1:0');
    expect(link.status).toBe('linked');
    expect(link.cadDrawing?.drawingId).toBe('cad-1');
    expect(link.reportDrawing?.drawingId).toBe('iso-1');
    expect(link.matchScore).toBeGreaterThanOrEqual(80);
  });

  it('returns no_match when library has unrelated parts', () => {
    const other = makeView({
      drawingId: 'other',
      partNumber: 'AA-9999-99',
      description: 'TOTALLY DIFFERENT WIDGET',
    });
    const link = resolveOrderDrawingLink(
      {
        orderId: 'o2',
        lineIndex: 1,
        soNumber: '2026/S00002',
        poNumber: '',
        pieza: 'HEX SWAGE BLOCK',
        numeroParte: '90-1012-05',
        qtyPending: 1,
      },
      [other],
    );
    expect(link.status).toBe('no_match');
    expect(link.cadDrawing).toBeNull();
    expect(link.reportDrawing).toBeNull();
  });

  it('idempotent key for same order line', () => {
    const a = resolveOrderDrawingLink(
      {
        orderId: 'o1',
        lineIndex: 0,
        soNumber: 'SO',
        poNumber: '',
        pieza: 'HEX SWAGE BLOCK',
        numeroParte: '90-1012-05',
        qtyPending: 1,
      },
      [cad],
    );
    const b = resolveOrderDrawingLink(
      {
        orderId: 'o1',
        lineIndex: 0,
        soNumber: 'SO',
        poNumber: '',
        pieza: 'HEX SWAGE BLOCK',
        numeroParte: '90-1012-05',
        qtyPending: 1,
      },
      [cad],
    );
    expect(a.key).toBe(b.key);
  });

  it('separates CAD and ISO when alias points to an ISO drawing and CAD exists', () => {
    const link = resolveOrderDrawingLink(
      {
        orderId: 'o1',
        lineIndex: 0,
        soNumber: 'SO',
        poNumber: '',
        pieza: 'CUSTOM PIECE',
        numeroParte: '',
        qtyPending: 1,
      },
      [cad, iso],
      undefined,
      undefined,
      [
        {
          pattern: 'CUSTOM PIECE',
          partNumber: '90-1012-05.ISO',
          drawingId: 'iso-1',
        },
      ],
    );

    expect(link.status).toBe('manual');
    expect(link.matchScore).toBe(100);
    expect(link.cadDrawing?.drawingId).toBe('cad-1');
    expect(link.reportDrawing?.drawingId).toBe('iso-1');
    expect(getCadDrawingSnapshot(link)?.drawingId).toBe('cad-1');
    expect(getReportDrawingSnapshot(link)?.drawingId).toBe('iso-1');
  });

  it('sets cadDrawing to null when alias points to an ISO drawing but no CAD exists', () => {
    const link = resolveOrderDrawingLink(
      {
        orderId: 'o1',
        lineIndex: 0,
        soNumber: 'SO',
        poNumber: '',
        pieza: 'ISO ONLY PIECE',
        numeroParte: '',
        qtyPending: 1,
      },
      [iso],
      undefined,
      undefined,
      [
        {
          pattern: 'ISO ONLY PIECE',
          partNumber: '90-1012-05.ISO',
          drawingId: 'iso-1',
        },
      ],
    );

    expect(link.status).toBe('manual');
    expect(link.cadDrawing).toBeNull();
    expect(link.reportDrawing?.drawingId).toBe('iso-1');
    expect(getCadDrawingSnapshot(link)).toBeNull();
    expect(getReportDrawingSnapshot(link)?.drawingId).toBe('iso-1');
  });

  it('adopts ISO for report when alias points to a CAD drawing and ISO exists', () => {
    const link = resolveOrderDrawingLink(
      {
        orderId: 'o1',
        lineIndex: 0,
        soNumber: 'SO',
        poNumber: '',
        pieza: 'CAD FIRST PIECE',
        numeroParte: '',
        qtyPending: 1,
      },
      [cad, iso],
      undefined,
      undefined,
      [
        {
          pattern: 'CAD FIRST PIECE',
          partNumber: '90-1012-05',
          drawingId: 'cad-1',
        },
      ],
    );

    expect(link.status).toBe('manual');
    expect(link.cadDrawing?.drawingId).toBe('cad-1');
    expect(link.reportDrawing?.drawingId).toBe('iso-1');
  });
});

describe('applyManualDrawingToLink', () => {
  it('sets CAD and report when user picks a CAD drawing', () => {
    const base = resolveOrderDrawingLink(
      {
        orderId: 'o1',
        lineIndex: 0,
        soNumber: 'SO',
        poNumber: '',
        pieza: 'X',
        numeroParte: '',
        qtyPending: 1,
      },
      [],
    );
    expect(base.status).toBe('no_match');

    const cad = makeView({ drawingId: 'manual-cad', partNumber: 'MANUAL-01' });
    const next = applyManualDrawingToLink(base, cad);
    expect(next.status).toBe('manual');
    expect(next.cadDrawing?.drawingId).toBe('manual-cad');
    expect(getCadDrawingSnapshot(next)?.drawingId).toBe('manual-cad');
    expect(getReportDrawingSnapshot(next)?.drawingId).toBe('manual-cad');
  });

  it('sets only reportDrawing when user picks an ISO', () => {
    const base = resolveOrderDrawingLink(
      {
        orderId: 'o1',
        lineIndex: 0,
        soNumber: 'SO',
        poNumber: '',
        pieza: 'X',
        numeroParte: '',
        qtyPending: 1,
      },
      [],
    );
    const iso = makeView({
      drawingId: 'manual-iso',
      partNumber: 'MANUAL-01.iso',
      sourcePath: 'MANUAL-01.iso.pdf',
    });
    const next = applyManualDrawingToLink(base, iso);
    expect(next.status).toBe('manual');
    expect(next.reportDrawing?.drawingId).toBe('manual-iso');
    expect(next.cadDrawing).toBeNull();
  });
});

describe('snapshotFromView', () => {
  it('round-trips drawingId', () => {
    const view = makeView({ drawingId: 'd1', partNumber: 'P1' });
    expect(snapshotFromView(view).drawingId).toBe('d1');
  });
});
