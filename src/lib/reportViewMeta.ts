/**
 * Helpers de presentación para el Audit Dashboard / CSV:
 * provenance de la cara isométrica y clave de sesión para COMPRAR.
 */

import type { Order } from '../types';
import { isRealIsoPdfLabel } from './generateIsometricImage';

/** Etiqueta de la columna "Tipo de Vista 3D" en CSV y badges. */
export function describeIsometricView(
  order: Pick<Order, 'isometricSource' | 'isometricView' | 'sourcePdfName'>,
): 'ISO eDrawings' | 'Recorte CAD' | 'IA Generado' | 'Sin vista' {
  if (order.isometricSource === 'ai-generated') return 'IA Generado';
  if (!order.isometricView) return 'Sin vista';
  if (isRealIsoPdfLabel(order.sourcePdfName)) return 'ISO eDrawings';
  return 'Recorte CAD';
}

/** Clave de sesión para marcar filas ya requisitadas en Compras. */
export function purchaseRowKey(
  order: Pick<Order, 'orden' | 'numero_parte' | 'pieza'>,
): string {
  const so = order.orden.split('\n')[0]?.trim() ?? '';
  return `${so}|${order.numero_parte ?? ''}|${order.pieza}`;
}

export function formatCajetinLine(
  order: Pick<Order, 'material' | 'dureza' | 'tratamiento' | 'acabado'>,
): string | null {
  const parts: string[] = [];
  if (order.material) parts.push(`Mat: ${order.material}`);
  if (order.dureza) parts.push(`Dur: ${order.dureza}`);
  if (order.tratamiento) parts.push(`Trat: ${order.tratamiento}`);
  if (order.acabado) parts.push(`Acab: ${order.acabado}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
