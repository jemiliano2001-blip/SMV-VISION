import { describe, it, expect } from 'vitest';
import {
  extractRevisionFromText,
  checkRevisionDiscrepancy,
} from '../matching';
import { normalizeAliasKey } from '../firebase/aliases';
import {
  resolveOrderDrawingLink,
  type ResolveOrderDrawingInput,
} from '../orderDrawingBridge';
import { createStampedPlanoOtBatch } from '../planoOt';
import { PDFDocument } from 'pdf-lib';
import type { ToolcribActiveDrawingView } from '../../types';

describe('extractRevisionFromText & checkRevisionDiscrepancy', () => {
  it('extracts revisions correctly from different text patterns', () => {
    expect(extractRevisionFromText('PUNZON REV B')).toBe('B');
    expect(extractRevisionFromText('MATRIZ DE CORTE REV. 02')).toBe('02');
    expect(extractRevisionFromText('PLACA BASE REVISION C')).toBe('C');
    expect(extractRevisionFromText('BUJE GUIA REV-3')).toBe('3');
    expect(extractRevisionFromText('GAVILAN SIN REVISION')).toBe(null);
  });

  it('detects revision mismatches between order and blueprint', () => {
    const check1 = checkRevisionDiscrepancy('PUNZON REV B', 'A');
    expect(check1.hasMismatch).toBe(true);
    expect(check1.orderRev).toBe('B');
    expect(check1.drawingRev).toBe('A');

    const check2 = checkRevisionDiscrepancy('PUNZON REV A', 'A');
    expect(check2.hasMismatch).toBe(false);

    const check3 = checkRevisionDiscrepancy('MATRIZ REV 01', '1');
    expect(check3.hasMismatch).toBe(false); // 01 vs 1 are considered equivalent

    const check4 = checkRevisionDiscrepancy('SIN MENCION', 'A');
    expect(check4.hasMismatch).toBe(false);
  });
});

describe('normalizeAliasKey & alias memory matching', () => {
  it('normalizes alias strings cleanly', () => {
    expect(normalizeAliasKey('  PUNZÓN ESPECIAL #12  ')).toBe('PUNZON ESPECIAL 12');
  });

  it('matches via learned aliases when standard heuristic would fail', () => {
    const input: ResolveOrderDrawingInput = {
      orderId: 'SO-100',
      lineIndex: 0,
      soNumber: '2026/S00100',
      poNumber: 'PO-999',
      pieza: 'PIEZA RARA SIN CODIGO',
      numeroParte: '',
      qtyPending: 5,
    };

    const libraryView: ToolcribActiveDrawingView = {
      partId: 'p_custom',
      partNumber: '90-CUSTOM-01',
      customer: 'SUPRAJIT',
      description: 'DIBUJO DE PUNZON',
      drawingId: 'dwg_custom_1',
      revision: 'B',
      sourceType: 'storage',
      sourcePath: 'toolcrib/uploads/90-CUSTOM-01.pdf',
      pdfUrl: 'https://example.com/custom.pdf',
      stlUrl: null,
      effectiveFromUTC: null,
    };

    const aliases = [
      {
        pattern: 'PIEZA RARA SIN CODIGO',
        partNumber: '90-CUSTOM-01',
        drawingId: 'dwg_custom_1',
      },
    ];

    const link = resolveOrderDrawingLink(
      input,
      [libraryView],
      undefined,
      undefined,
      aliases,
    );

    expect(link.status).toBe('manual');
    expect(link.matchScore).toBe(100);
    expect(link.cadDrawing?.partNumber).toBe('90-CUSTOM-01');
  });

  it('does not apply a generic alias as a substring match', () => {
    const input: ResolveOrderDrawingInput = {
      orderId: 'SO-101',
      lineIndex: 0,
      soNumber: '2026/S00101',
      poNumber: 'PO-1000',
      pieza: 'PUNZON DE CORTE 90-1012-06',
      numeroParte: '90-1012-06',
      qtyPending: 1,
    };
    const libraryView: ToolcribActiveDrawingView = {
      partId: 'p_other', partNumber: '90-1012-05', customer: 'SUPRAJIT',
      description: 'PUNZON DE CORTE', drawingId: 'dwg_other', revision: 'A',
      sourceType: 'storage', sourcePath: '90-1012-05.pdf', pdfUrl: null,
      stlUrl: null, effectiveFromUTC: null,
    };
    const correctView: ToolcribActiveDrawingView = {
      ...libraryView,
      partId: 'p_correct', partNumber: '90-1012-06', drawingId: 'dwg_correct',
      sourcePath: '90-1012-06.pdf',
    };

    const link = resolveOrderDrawingLink(input, [libraryView, correctView], undefined, undefined, [
      { pattern: 'PUNZON', partNumber: '90-1012-05', drawingId: 'dwg_other' },
    ]);

    expect(link.cadDrawing?.drawingId).toBe('dwg_correct');
  });
});

describe('createStampedPlanoOtBatch', () => {
  it('concatenates and stamps multiple PDFs into a single batch document', async () => {
    // Generate two minimal valid PDF dataUrls
    const doc1 = await PDFDocument.create();
    doc1.addPage([300, 300]);
    const pdf1Base64 = await doc1.saveAsBase64({ dataUri: true });

    const doc2 = await PDFDocument.create();
    doc2.addPage([300, 300]);
    const pdf2Base64 = await doc2.saveAsBase64({ dataUri: true });

    const batchBytes = await createStampedPlanoOtBatch([
      {
        pdfDataUrl: pdf1Base64,
        stamp: {
          soNumber: '2026/S001',
          cantidad: '5',
          fecha: '2026-08-20',
          notas: 'Urgente',
        },
      },
      {
        pdfDataUrl: pdf2Base64,
        stamp: {
          soNumber: '2026/S002',
          cantidad: '10',
          fecha: '2026-08-20',
        },
      },
    ]);

    expect(batchBytes).toBeInstanceOf(Uint8Array);
    const loaded = await PDFDocument.load(batchBytes);
    expect(loaded.getPageCount()).toBe(2);
  });
});
