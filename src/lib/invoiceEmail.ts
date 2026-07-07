/**
 * src/lib/invoiceEmail.ts
 *
 * Lógica pura para generar solicitudes de Factura / Remisión por correo.
 * Sin dependencias de React ni Firebase.
 *
 * Formato del correo basado en los correos reales que se envían a
 * ams@maquinadosvazquez.com para solicitar facturación.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Tipos
// ─────────────────────────────────────────────────────────────────────────────

/** Tipo de documento a solicitar por orden. */
export type InvoiceType = 'factura' | 'remision';

/** Una orden seleccionada para la solicitud. */
export interface InvoiceOrderEntry {
  /** Número de orden Odoo (ej. "2026/S00781"). */
  orderName: string;
  /** Tipo de documento. */
  type: InvoiceType;
  /** Nombre del cliente (partner). */
  partner: string;
  /** Referencia de cliente o PO. */
  client_order_ref?: string;
  /**
   * Detalle de la remisión (solo cuando type === 'remision').
   * Ej: "4 sets de 4150-06"
   */
  remisionDetail?: string;
}

export interface EmailContent {
  to: string;
  subject: string;
  body: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Constantes
// ─────────────────────────────────────────────────────────────────────────────

/** Destinatario fijo para las solicitudes de facturación. */
export const INVOICE_RECIPIENT = 'ams@maquinadosvazquez.com';

/** Cliente fijo (Suprajit). */
export const DEFAULT_CUSTOMER = 'Suprajit';

// ─────────────────────────────────────────────────────────────────────────────
//  Generación del correo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera el asunto del correo según los tipos de documentos solicitados.
 *
 *  - Solo facturas  → "Factura"
 *  - Solo remisiones → "Remision"
 *  - Mezcla          → "Factura y Remision"
 */
export function buildSubject(entries: InvoiceOrderEntry[]): string {
  const hasFactura = entries.some((e) => e.type === 'factura');
  const hasRemision = entries.some((e) => e.type === 'remision');

  if (hasFactura && hasRemision) return 'Factura y Remision';
  if (hasRemision) return 'Remision';
  return 'Factura';
}

/**
 * Genera el cuerpo del correo con el formato exacto de los correos reales.
 *
 * Ejemplo de salida (solo facturas):
 * ```
 * Buen día,
 *
 * Me podría hacer una factura para Suprajit
 *
 * La orden es 2026/S01111, 2026/S00659, 2026/S00662
 *
 * Saludos cordiales
 * ```
 *
 * Ejemplo de salida (mezcla factura + remisión):
 * ```
 * Buen día,
 *
 * Me podría hacer una factura para Suprajit
 *
 * La orden es 2026/S01085
 *
 * Y una remisión para 2026/S0113 de 4 sets de 4150-06
 *
 * Saludos cordiales
 * ```
 */
export function buildBody(
  entries: InvoiceOrderEntry[]
): string {
  const lines: string[] = ['Buen día,'];

  // Agrupar por partner
  const byPartner = new Map<string, InvoiceOrderEntry[]>();
  for (const e of entries) {
    const p = e.partner || DEFAULT_CUSTOMER;
    if (!byPartner.has(p)) byPartner.set(p, []);
    byPartner.get(p)!.push(e);
  }

  for (const [partner, partnerEntries] of byPartner.entries()) {
    const facturas = partnerEntries.filter((e) => e.type === 'factura');
    const remisiones = partnerEntries.filter((e) => e.type === 'remision');

    const formatOrder = (e: InvoiceOrderEntry) => {
      return e.client_order_ref ? `${e.orderName} (PO: ${e.client_order_ref})` : e.orderName;
    };

    lines.push('');

    // ── Sección de facturas ──
    if (facturas.length > 0) {
      lines.push(`Me podría hacer una factura para ${partner}`);
      lines.push('');
      const orderList = facturas.map(formatOrder).join(', ');
      if (facturas.length === 1) {
        lines.push(`La orden es ${orderList}`);
      } else {
        lines.push(`Las órdenes son ${orderList}`);
      }
    }

    // ── Sección de remisiones ──
    if (remisiones.length > 0) {
      if (facturas.length > 0) {
        // Ya hay facturas, las remisiones van como continuación
        lines.push('');
        for (const r of remisiones) {
          const detail = r.remisionDetail ? ` de ${r.remisionDetail}` : '';
          lines.push(`Y una remisión para ${formatOrder(r)}${detail}`);
        }
      } else {
        // Solo remisiones
        lines.push(`Me podría hacer una remisión para ${partner}`);
        lines.push('');
        for (const r of remisiones) {
          const detail = r.remisionDetail ? ` de ${r.remisionDetail}` : '';
          if (remisiones.length === 1) {
            lines.push(`La orden es ${formatOrder(r)}${detail}`);
          } else {
            lines.push(`${formatOrder(r)}${detail}`);
          }
        }
      }
    }
  }

  lines.push('');
  lines.push('Saludos cordiales');

  return lines.join('\n');
}

/**
 * Genera el objeto completo del correo (destinatario, asunto, cuerpo).
 */
export function buildEmailContent(
  entries: InvoiceOrderEntry[]
): EmailContent {
  return {
    to: INVOICE_RECIPIENT,
    subject: buildSubject(entries),
    body: buildBody(entries),
  };
}

/**
 * Construye un URI `mailto:` listo para abrir en el navegador.
 * Abrirá Outlook (o el cliente de correo predeterminado) con todo pre-llenado.
 */
export function buildMailtoUri(email: EmailContent): string {
  const params = new URLSearchParams();
  params.set('subject', email.subject);
  params.set('body', email.body);
  // URLSearchParams codifica espacios como '+', pero mailto necesita '%20'
  const paramString = params.toString().replace(/\+/g, '%20');
  return `mailto:${encodeURIComponent(email.to)}?${paramString}`;
}

/**
 * Copia texto al portapapeles. Devuelve true si tuvo éxito.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback para navegadores que no soportan clipboard API
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}
