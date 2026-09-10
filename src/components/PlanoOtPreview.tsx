import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { stampPlanoOt, type PlanoOtMask, type PlanoOtStamp } from '../lib/planoOt';

interface Props {
  dataUrl: string;
  stamp: PlanoOtStamp;
  mask: PlanoOtMask | null;
  onMaskChange: (mask: PlanoOtMask | null) => void;
  onReady: (ready: boolean) => void;
}

export function PlanoOtPreview({ dataUrl, stamp, mask, onMaskChange, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [result, setResult] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [pageCount, setPageCount] = useState(1);
  const [draft, setDraft] = useState<PlanoOtMask | null>(null);
  // La selección no cambia el canvas fuente: solo su cubierta. El resultado
  // usa exactamente stampPlanoOt, igual que el botón de impresión.
  const maskKey = result ? JSON.stringify(mask) : '';
  useEffect(() => {
    let cancelled = false;
    let loading: { destroy: () => Promise<void> } | undefined;
    let render: { cancel: () => void } | undefined;
    setReady(false);
    onReady(false);
    setError('');
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const bytes = result ? await stampPlanoOt(dataUrl, { ...stamp, quantityMask: mask }) : null;
        if (cancelled) return;
        const task = pdfjs.getDocument({ ...(bytes ? { data: bytes } : { url: dataUrl }), wasmUrl: '/pdfjs-wasm/' });
        loading = task;
        const pdf = await task.promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const page = await pdf.getPage(1);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2400 / base.width, 3200 / base.height) });
        // Render aislado: StrictMode/cambios rápidos nunca comparten canvas.
        const buffer = document.createElement('canvas');
        buffer.width = Math.ceil(viewport.width);
        buffer.height = Math.ceil(viewport.height);
        const context = buffer.getContext('2d');
        if (!context) throw new Error('No fue posible dibujar el plano.');
        const rendering = page.render({ canvas: buffer, canvasContext: context, viewport });
        render = rendering;
        await rendering.promise;
        if (cancelled) return;
        const canvas = canvasRef.current;
        const output = canvas?.getContext('2d');
        if (!canvas || !output) throw new Error('No fue posible mostrar el plano.');
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        output.drawImage(buffer, 0, 0);
        setReady(true);
        onReady(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No fue posible preparar la vista previa.');
      } finally {
        if (loading) void loading.destroy().catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
      if (loading) void loading.destroy().catch(() => {});
    };
  }, [dataUrl, result, maskKey, stamp.soNumber, stamp.cantidad, stamp.fecha, stamp.notas, onReady]);

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const rectangle = (event: PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || event.pointerId !== start.pointerId) return null;
    const end = point(event);
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  };
  const shownMask = draft ?? mask;
  return (
    <section className="space-y-3 min-w-0" aria-label="Vista previa de la OT">
      <p id="ot-selection-help" className="text-sm text-ink">
        {result ? 'Así saldrá la primera página al imprimir.' : 'Arrastra un recuadro sobre el número de Quantity que quieres ocultar. Se cubrirá de blanco; deja fuera las cotas y la etiqueta.'}
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <Button type="button" variant="outline" onClick={() => { onReady(false); setResult(!result); }} disabled={!ready}>
          {result ? 'Editar recuadro' : 'Ver resultado'}
        </Button>
        <Button type="button" variant="outline" disabled={!mask || result} onClick={() => onMaskChange(null)}>Quitar recuadro</Button>
        <label className="flex gap-2 items-center text-sm">Zoom
          <select aria-label="Zoom del plano" value={zoom} onChange={e => setZoom(Number(e.target.value))} className="bg-surface-2 text-ink border border-line p-2">
            {[100, 150, 200, 300].map(value => <option key={value} value={value}>{value}%</option>)}
          </select>
        </label>
        <span className="text-xs text-ink-dim">Página 1 de {pageCount}</span>
      </div>
      {pageCount > 1 && <p className="text-sm text-ink-dim">El encabezado y el recuadro se aplican solo a la página 1. Las demás se imprimen sin cambios.</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {!ready && !error && <p role="status">Preparando vista previa…</p>}
      <div className="overflow-auto max-h-[52vh] border-2 border-line bg-surface-2">
        <div style={{ width: `${zoom}%`, display: ready ? 'block' : 'none' }}>
          <div className={`relative ${result ? '' : 'touch-none cursor-crosshair'}`}
            aria-describedby="ot-selection-help"
            onPointerDown={event => {
              if (result || !ready || event.button !== 0 || startRef.current) return;
              event.preventDefault();
              startRef.current = { ...point(event), pointerId: event.pointerId };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => { if (startRef.current) setDraft(rectangle(event)); }}
            onPointerUp={event => {
              const next = rectangle(event);
              if (!next) return;
              startRef.current = null;
              setDraft(null);
              if (next.width > 0.001 && next.height > 0.001) onMaskChange(next);
            }}
            onLostPointerCapture={() => { startRef.current = null; setDraft(null); }}
            onPointerCancel={() => { startRef.current = null; setDraft(null); }}>
            <canvas ref={canvasRef} className="block w-full h-auto bg-white" aria-label="Primera página del plano" role="img" />
            {!result && shownMask && <div className="absolute bg-white outline-2 outline-dashed outline-orange-600 pointer-events-none" style={{
              left: `${shownMask.x * 100}%`, top: `${shownMask.y * 100}%`,
              width: `${shownMask.width * 100}%`, height: `${shownMask.height * 100}%`,
            }} />}
          </div>
        </div>
      </div>
      {!result && <details className="text-sm">
        <summary className="cursor-pointer py-2">Ajustar recuadro con teclado (porcentajes del plano)</summary>
        {!mask && <Button type="button" variant="outline" onClick={() => onMaskChange({ x: 0.4, y: 0.8, width: 0.05, height: 0.03 })}>Crear recuadro</Button>}
        {mask && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(['x', 'y', 'width', 'height'] as const).map((key, index) => <label key={key}>
            {['Desde izquierda', 'Desde arriba', 'Ancho', 'Alto'][index]} (%)
            <Input type="number" min={0} max={100} step="any"
              value={Number((mask[key] * 100).toFixed(2))}
              onChange={event => {
                const value = event.target.valueAsNumber / 100;
                if (!Number.isFinite(value)) return;
                const next = { ...mask, [key]: Math.max(0, Math.min(1, value)) };
                if (next.width > 0 && next.height > 0 && next.x + next.width <= 1 && next.y + next.height <= 1) onMaskChange(next);
              }} />
          </label>)}
        </div>}
      </details>}
      <p role="status" className="text-xs text-ink-dim">{mask ? 'Recuadro aplicado únicamente a esta copia de impresión.' : 'No hay ninguna zona oculta.'}</p>
    </section>
  );
}
