/**
 * Evidencia fotográfica de maquinaria/herramental (requisito Suprajit,
 * vigente 2026-10-13): al facturar una OC de construcción o mejora de
 * maquinaria/herramientas se exige evidencia fotográfica impresa y un PDF de la
 * máquina construida junto con la factura electrónica.
 *
 * Este módulo solo arma el PDF a partir de fotos reales elegidas por el
 * operador. No usa el isométrico del plano: eso es diseño, no evidencia.
 */

export const EVIDENCE_MAX_PHOTOS = 12;
/** Lado mayor máximo tras comprimir (px): PDF liviano para mandar por correo. */
export const EVIDENCE_MAX_SIDE_PX = 1600;
const EVIDENCE_JPEG_QUALITY = 0.82;

export interface EvidencePhoto {
  id: string;
  /** data URL JPEG ya comprimido. */
  dataUrl: string;
  width: number;
  height: number;
  caption: string;
}

export interface EvidencePdfInput {
  /** Orden de venta Odoo (ej. "2026/S00781"). */
  orderName: string;
  /** PO del cliente, si existe. */
  clientPo: string | null;
  partner: string;
  /** Descripción del equipo/herramental construido. */
  equipmentDescription: string;
  /** Líneas de la orden (producto + cantidad) para dar contexto. */
  lines: { product: string; qty: number }[];
  photos: EvidencePhoto[];
  generatedAt?: Date;
}

export type EvidenceResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Calcula el tamaño destino respetando proporción; nunca agranda. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Lee una imagen del operador y la devuelve como JPEG comprimido. */
export async function compressPhotoFile(file: File): Promise<EvidenceResult<Omit<EvidencePhoto, 'id' | 'caption'>>> {
  if (!file.type.startsWith('image/')) return { ok: false, reason: 'No es una imagen.' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: 'No se pudo leer la imagen (formato no soportado).' };
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, EVIDENCE_MAX_SIDE_PX);
    if (size.width === 0) return { ok: false, reason: 'Imagen vacía.' };
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'Canvas no disponible.' };
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    return {
      ok: true,
      value: {
        dataUrl: canvas.toDataURL('image/jpeg', EVIDENCE_JPEG_QUALITY),
        width: size.width,
        height: size.height,
      },
    };
  } finally {
    bitmap.close();
  }
}

/** Nombre de archivo seguro: "Evidencia_2026-S00781.pdf". */
export function evidenceFileName(orderName: string): string {
  const safe = orderName.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `Evidencia_${safe || 'orden'}.pdf`;
}

export async function generateEvidencePdf(input: EvidencePdfInput): Promise<EvidenceResult<Blob>> {
  if (input.photos.length === 0) return { ok: false, reason: 'Agrega al menos una foto.' };
  try {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;
    const contentW = pageW - margin * 2;
    const generatedAt = input.generatedAt ?? new Date();

    // ── Encabezado ──
    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, pageW, 48, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text('SMV // VISION', margin, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text('EVIDENCIA FOTOGRAFICA DE MAQUINARIA / HERRAMENTAL', margin, 34);
    doc.setTextColor(255, 255, 255);
    doc.text(generatedAt.toLocaleDateString('es-MX'), pageW - margin, 27, { align: 'right' });

    // ── Datos de la orden ──
    let y = 76;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(input.orderName, margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Cliente: ${input.partner}`, margin, y);
    y += 14;
    doc.text(`Orden de compra: ${input.clientPo ?? 'Pendiente'}`, margin, y);
    y += 18;

    if (input.equipmentDescription.trim()) {
      doc.setFont('helvetica', 'bold');
      doc.text('Equipo construido / mejora:', margin, y);
      y += 13;
      doc.setFont('helvetica', 'normal');
      const descLines = doc.splitTextToSize(input.equipmentDescription.trim(), contentW) as string[];
      doc.text(descLines, margin, y);
      y += descLines.length * 12 + 6;
    }

    if (input.lines.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Partidas de la orden:', margin, y);
      y += 13;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      for (const line of input.lines.slice(0, 8)) {
        const text = doc.splitTextToSize(`${line.qty} x ${line.product}`, contentW)[0] as string;
        doc.text(text, margin, y);
        y += 11;
      }
      y += 6;
    }

    // ── Fotos: rejilla de 2 columnas ──
    const gap = 14;
    const cellW = (contentW - gap) / 2;
    const cellH = 210;
    const captionH = 14;
    let col = 0;
    let rowTop = y + 4;

    for (const photo of input.photos) {
      if (rowTop + cellH + captionH > pageH - margin) {
        doc.addPage();
        rowTop = margin;
        col = 0;
      }
      const x = margin + col * (cellW + gap);
      const ratio = Math.min(cellW / photo.width, cellH / photo.height);
      const w = photo.width * ratio;
      const h = photo.height * ratio;
      doc.setDrawColor(200, 200, 200);
      doc.rect(x, rowTop, cellW, cellH);
      doc.addImage(photo.dataUrl, 'JPEG', x + (cellW - w) / 2, rowTop + (cellH - h) / 2, w, h);
      if (photo.caption.trim()) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(60, 60, 60);
        const cap = doc.splitTextToSize(photo.caption.trim(), cellW)[0] as string;
        doc.text(cap, x, rowTop + cellH + 10);
      }
      col += 1;
      if (col === 2) {
        col = 0;
        rowTop += cellH + captionH + 10;
      }
    }

    return { ok: true, value: doc.output('blob') };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Error al generar el PDF.' };
  }
}
