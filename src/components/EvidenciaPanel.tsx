import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Camera, FileDown, ImagePlus, Loader2, AlertCircle, Trash2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { listOrdersToInvoice, REPORT_PARTNER_KEY_PREFIX, type OdooOrderView } from '../lib/firebase/odooOrders';
import {
  EVIDENCE_MAX_PHOTOS,
  compressPhotoFile,
  evidenceFileName,
  generateEvidencePdf,
  type EvidencePhoto,
} from '../lib/evidencePdf';

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function EvidenciaPanel() {
  const [orders, setOrders] = useState<OdooOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<EvidencePhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listOrdersToInvoice({ partnerKeyPrefix: REPORT_PARTNER_KEY_PREFIX });
      if (cancelled) return;
      if (result.ok) setOrders(result.value);
      else setError('No se pudieron leer las órdenes de Odoo.');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const order = useMemo(() => orders.find((o) => o.id === selectedId) ?? null, [orders, selectedId]);

  const handleFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (files.length === 0) return;
      setBusy(true);
      const added: EvidencePhoto[] = [];
      for (const file of files) {
        if (photos.length + added.length >= EVIDENCE_MAX_PHOTOS) {
          toast.warning(`Máximo ${EVIDENCE_MAX_PHOTOS} fotos por PDF.`);
          break;
        }
        const res = await compressPhotoFile(file);
        if (res.ok === false) toast.error(`${file.name}: ${res.reason}`);
        else added.push({ ...res.value, id: crypto.randomUUID(), caption: '' });
      }
      setPhotos((prev) => [...prev, ...added]);
      setBusy(false);
    },
    [photos.length],
  );

  const handleGenerate = useCallback(async () => {
    if (!order) return;
    setBusy(true);
    const result = await generateEvidencePdf({
      orderName: order.name,
      clientPo: order.client_order_ref,
      partner: order.partner,
      equipmentDescription: description || order.descripcion || '',
      lines: order.order_lines.map((l) => ({ product: l.product, qty: l.qty })),
      photos,
    });
    setBusy(false);
    if (result.ok === false) {
      toast.error(result.reason);
      return;
    }
    downloadBlob(result.value, evidenceFileName(order.name));
    toast.success('PDF de evidencia generado.');
  }, [order, description, photos]);

  const canGenerate = Boolean(order) && photos.length > 0 && !busy;

  return (
    <div className="h-full flex flex-col bg-bg">
      <header className="shrink-0 border-b border-line bg-surface/95 px-4 sm:px-6 lg:px-9 py-4 flex items-center gap-3">
        <div className="size-11 rounded-xl bg-accent/12 text-accent flex items-center justify-center shrink-0">
          <Camera size={20} strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-[-0.04em] leading-none">
            Evidencia fotográfica
          </h1>
          <p className="text-xs text-ink-dim mt-1">
            Fotos de la maquinaria/herramental construido para la factura de Suprajit
          </p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-3.5 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-5">
          <div className="flex items-start gap-2 border border-line bg-surface-2/50 px-3 py-2.5 text-xs text-ink-dim">
            <Info size={15} className="shrink-0 mt-0.5 text-accent" />
            <p>
              Suprajit (desde el 13/10/2026) pide <strong>fotografía impresa</strong> de la máquina o herramienta
              construida al entregar la factura en contra-recibos, y el <strong>PDF</strong> junto con la factura
              electrónica a matamoros.invices@suprajit.com. Usa fotos reales, no el plano.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          <section className="space-y-2">
            <label htmlFor="evidencia-orden" className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink-dim">
              1. Orden
            </label>
            <select
              id="evidencia-orden"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={loading}
              className="w-full h-11 px-3 border border-line bg-surface text-sm text-ink"
            >
              <option value="">{loading ? 'Cargando órdenes…' : 'Selecciona una orden a facturar'}</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · OC {o.client_order_ref ?? 'pendiente'} · {o.partner}
                </option>
              ))}
            </select>
            {order && (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={order.descripcion ?? 'Descripción del equipo construido o la mejora (opcional)'}
                rows={2}
                maxLength={400}
                className="w-full px-3 py-2 border border-line bg-surface text-sm text-ink"
              />
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink-dim">
                2. Fotos ({photos.length}/{EVIDENCE_MAX_PHOTOS})
              </span>
              <Button
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || photos.length >= EVIDENCE_MAX_PHOTOS}
                className="flex items-center gap-2 px-4 h-10 border border-line bg-surface-2 text-[11px] font-semibold text-ink"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                Agregar fotos
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handleFiles(e)}
              />
            </div>

            {photos.length === 0 ? (
              <div className="border-2 border-dashed border-line bg-surface-2/30 p-10 text-center text-ink-dim text-xs font-mono uppercase tracking-widest">
                Aún no hay fotos. En celular puedes tomarlas directo con la cámara.
              </div>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {photos.map((p) => (
                  <li key={p.id} className="border border-line bg-surface p-2 space-y-2">
                    <img src={p.dataUrl} alt={p.caption || 'Foto de evidencia'} className="w-full h-32 object-contain bg-surface-2" />
                    <input
                      value={p.caption}
                      maxLength={80}
                      onChange={(e) =>
                        setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, caption: e.target.value } : x)))
                      }
                      placeholder="Pie de foto (opcional)"
                      className="w-full h-8 px-2 border border-line bg-bg text-xs text-ink"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                      className="flex items-center gap-1 text-[10px] font-mono uppercase text-ink-dim hover:text-danger"
                    >
                      <Trash2 size={12} /> Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Button
            onClick={() => void handleGenerate()}
            disabled={!canGenerate}
            className="flex items-center gap-2 h-11 px-6 font-semibold disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
            Generar PDF de evidencia
          </Button>
        </div>
      </main>
    </div>
  );
}
