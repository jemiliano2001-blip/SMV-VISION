import { describe, expect, it, vi } from 'vitest';
import type { ToolcribActiveDrawingView } from '../../types';
import { attachFichaPhoto, chooseFichaPhotoKind, photoSourcesForPart, resolveFichaPhoto } from '../fichaOtPhoto';
import type { PlanoOtStamp } from '../planoOt';

function view(
  overrides: Partial<ToolcribActiveDrawingView> & Pick<ToolcribActiveDrawingView, 'drawingId' | 'partNumber'>,
): ToolcribActiveDrawingView {
  return {
    partId: `part-${overrides.drawingId}`,
    customer: 'SUPRAJIT',
    description: '',
    revision: 'A',
    sourceType: 'storage',
    sourcePath: `${overrides.partNumber}.pdf`,
    pdfUrl: `https://example.com/${overrides.drawingId}.pdf`,
    stlUrl: null,
    effectiveFromUTC: null,
    ...overrides,
  };
}

const stamp: PlanoOtStamp = {
  soNumber: 'SO-1',
  cantidad: '2',
  fecha: '2026-10-19',
  mode: 'both',
};

describe('chooseFichaPhotoKind', () => {
  it('prefiere ISO, luego STL, luego IA, y vacío si no hay plano', () => {
    expect(chooseFichaPhotoKind({
      isoPdfUrl: 'https://iso.pdf',
      stlUrl: 'https://part.stl',
      cadPdfAvailable: true,
    })).toBe('iso');
    expect(chooseFichaPhotoKind({
      isoPdfUrl: '  ',
      stlUrl: 'https://part.stl',
      cadPdfAvailable: true,
    })).toBe('stl');
    expect(chooseFichaPhotoKind({
      isoPdfUrl: null,
      stlUrl: null,
      cadPdfAvailable: true,
    })).toBe('ai');
    expect(chooseFichaPhotoKind({
      isoPdfUrl: null,
      stlUrl: null,
      cadPdfAvailable: false,
    })).toBe('none');
  });
});

describe('photoSourcesForPart', () => {
  it('toma el PDF ISO y el STL del mismo número de parte', () => {
    const sources = photoSourcesForPart('90-5492REV1', [
      view({ drawingId: 'cad', partNumber: '90-5492REV1', stlUrl: null }),
      view({
        drawingId: 'iso',
        partNumber: '90-5492REV1.ISO',
        pdfUrl: 'https://example.com/iso.pdf',
        stlUrl: 'https://example.com/part.stl',
      }),
    ]);
    expect(sources.isoPdfUrl).toBe('https://example.com/iso.pdf');
    expect(sources.stlUrl).toBe('https://example.com/part.stl');
  });
});

describe('resolveFichaPhoto', () => {
  it('no llama a la IA cuando el ISO descarga', async () => {
    const generateAi = vi.fn(async () => 'data:image/png;base64,qq');
    const photo = await resolveFichaPhoto({
      isoPdfUrl: 'https://iso.pdf',
      stlUrl: 'https://part.stl',
      cadPdfDataUrl: 'data:application/pdf;base64,cad',
    }, {
      fetchPdf: async () => 'data:application/pdf;base64,iso',
      renderStl: async () => 'data:image/png;base64,stl',
      generateAi,
    });
    expect(photo).toEqual({ kind: 'iso', pdfDataUrl: 'data:application/pdf;base64,iso' });
    expect(generateAi).not.toHaveBeenCalled();
  });

  it('cae al STL si el ISO falla', async () => {
    const photo = await resolveFichaPhoto({
      isoPdfUrl: 'https://iso.pdf',
      stlUrl: 'https://part.stl',
      cadPdfDataUrl: 'data:application/pdf;base64,cad',
    }, {
      fetchPdf: async () => {
        throw new Error('red');
      },
      renderStl: async () => 'data:image/png;base64,stl',
      generateAi: async () => 'data:image/png;base64,ai',
    });
    expect(photo).toEqual({ kind: 'stl', imageDataUrl: 'data:image/png;base64,stl' });
  });

  it('queda vacío si la IA no devuelve imagen', async () => {
    const photo = await resolveFichaPhoto({
      cadPdfDataUrl: 'data:application/pdf;base64,cad',
    }, {
      generateAi: async () => null,
    });
    expect(photo).toEqual({ kind: 'none' });
  });

  it('no resuelve foto en modo blueprint', async () => {
    const generateAi = vi.fn(async () => 'data:image/png;base64,ai');
    const next = await attachFichaPhoto(
      { ...stamp, mode: 'blueprint' },
      { cadPdfDataUrl: 'data:application/pdf;base64,cad' },
      { generateAi },
    );
    expect(next.fichaPhoto).toBeUndefined();
    expect(generateAi).not.toHaveBeenCalled();
  });
});
