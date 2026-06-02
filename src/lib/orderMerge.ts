/**
 * Parsing y consolidación de órdenes extraídas del PDF de Google Sheets.
 *
 * `parseOrdersResponse` toma el JSON crudo que Gemini devuelve y lo normaliza
 * a `ExtractedOrder[]`. `mergeGroupedOrders` consolida sub-líneas que comparten
 * el mismo `numero_parte` (sumando cantidades, juntando SO y fechas), y descarta
 * duplicados exactos que el extractor a veces produce para sub-líneas de un
 * mismo SO.
 *
 * La unidad de cantidad ("Pieza" / "Set") se preserva del primer renglón que
 * la traiga — los renglones agregados nunca quedan como "10" pelado.
 */

import type { ExtractedOrder } from '../types';
import { normalizePieceLabel } from './matching';

/** Nombre exacto esperado del PDF de pedidos (validación de upload). */
export const SUGGESTED_ORDER_REPORT_NAME = 'Suprajit reporte de tool crib - Google Sheets.pdf';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePriority(value: unknown): 'URGENTE' | 'Normal' {
  return value === 'URGENTE' ? 'URGENTE' : 'Normal';
}

function isOrderSummaryRow(pieceLabel: string): boolean {
  const normalized = normalizePieceLabel(pieceLabel);
  return (
    normalized.includes('PIEZAS REQUERIDAS')
    || normalized.includes('PIEZAS TERMINADAS')
    || normalized.includes('RESTANTES A CREAR')
  );
}

/** Devuelve null si el filename es el esperado, o un mensaje de warning de lo contrario. */
export function validateOrderPdfName(fileName: string): string | null {
  if (fileName.trim() === SUGGESTED_ORDER_REPORT_NAME) {
    return null;
  }
  return `El archivo "${fileName}" no coincide con el nombre esperado del reporte de órdenes. Debe llamarse exactamente "${SUGGESTED_ORDER_REPORT_NAME}".`;
}

// Extracts unit label ("Pieza" / "Set" / "Pza" …) from a quantity string like
// "2.00\nPieza" or "10 Set". Returns empty string if no unit suffix is present.
export function extractCantidadUnit(value: string): string {
  if (!value) return '';
  const tokens = value.split(/[\s\n\r]+/).map((t) => t.trim()).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(tokens[i])) {
      return tokens[i];
    }
  }
  return '';
}

export function parseCantidadNumber(value: string): number | null {
  const match = value.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Identifiers must contain a digit and have at least 4 alphanumeric chars to be
// considered a reliable grouping key. Prevents lone tokens like "WESCON" from
// merging unrelated pieces.
function isReliablePartNumber(value: string): boolean {
  const compact = value.replace(/[^A-Z0-9]/gi, '');
  if (compact.length < 4) return false;
  if (!/\d/.test(compact)) return false;
  return true;
}

// Build a stable signature for exact-duplicate detection. Two rows with the
// same normalized pieza, partNumber, orden, fecha and quantity are treated as
// the same physical line item.
function buildOrderSignature(order: ExtractedOrder): string {
  const pieza = normalizePieceLabel(order.pieza);
  const parte = normalizePieceLabel(order.numero_parte ?? '');
  const orden = (order.orden ?? '').trim().toUpperCase();
  const fecha = (order.fecha ?? '').trim();
  const cant = (order.cantidad ?? '').trim();
  return `${pieza}||${parte}||${orden}||${fecha}||${cant}`;
}

function dedupeExactOrders(orders: ExtractedOrder[]): ExtractedOrder[] {
  const seen = new Set<string>();
  const result: ExtractedOrder[] = [];
  for (const order of orders) {
    const sig = buildOrderSignature(order);
    if (seen.has(sig)) continue;
    seen.add(sig);
    result.push(order);
  }
  return result;
}

/**
 * Consolida sub-líneas del mismo `numero_parte` en una sola entrada,
 * sumando cantidades, juntando SO y fechas. Mantiene los renglones sin
 * un part-number confiable como entradas individuales.
 */
export function mergeGroupedOrders(orders: ExtractedOrder[]): ExtractedOrder[] {
  const deduped = dedupeExactOrders(orders);

  const groups = new Map<string, ExtractedOrder[]>();
  const ungrouped: ExtractedOrder[] = [];
  for (const order of deduped) {
    const normalizedParte = order.numero_parte ? normalizePieceLabel(order.numero_parte) : '';
    if (!normalizedParte || !isReliablePartNumber(normalizedParte)) {
      ungrouped.push(order);
      continue;
    }
    if (!groups.has(normalizedParte)) groups.set(normalizedParte, []);
    groups.get(normalizedParte)!.push(order);
  }

  const result: ExtractedOrder[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) {
      result.push(group[0]);
      continue;
    }

    let totalQty = 0;
    let hasNumeric = false;
    for (const o of group) {
      const n = parseCantidadNumber(o.cantidad);
      if (n !== null) { totalQty += n; hasNumeric = true; }
    }

    let unit = '';
    for (const o of group) {
      const u = extractCantidadUnit(o.cantidad);
      if (u) { unit = u; break; }
    }
    const totalStr = hasNumeric
      ? (Number.isInteger(totalQty) ? String(totalQty) : totalQty.toFixed(2))
      : group[0].cantidad;
    const cantidad = hasNumeric && unit ? `${totalStr}\n${unit}` : totalStr;

    const ordenes = [...new Set(group.map((o) => o.orden).filter((o) => o !== 'N/A'))];
    const orden = ordenes.length > 0 ? ordenes.join('\n') : 'N/A';

    const fechas = [...new Set(group.map((o) => o.fecha).filter((f) => f !== 'N/A'))];
    const fecha = fechas.length > 0 ? fechas.join('\n') : 'N/A';

    const prioridad: 'URGENTE' | 'Normal' = group.some((o) => o.prioridad === 'URGENTE') ? 'URGENTE' : 'Normal';

    const poNumber = group.find((o) => o.poNumber)?.poNumber ?? group[0].poNumber ?? '';
    result.push({ pieza: group[0].pieza, numero_parte: group[0].numero_parte, cantidad, orden, fecha, prioridad, poNumber });
  }

  return [...result, ...ungrouped];
}

/** Parsea el JSON crudo del extractor de IA. Filtra filas de totales y descripciones vacías. */
export function parseOrdersResponse(text: string): ExtractedOrder[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(isRecord)
    .map((item) => ({
      pieza: asString(item.pieza),
      numero_parte: asString(item.numero_parte),
      cantidad: asString(item.cantidad) || 'N/A',
      orden: asString(item.orden) || 'N/A',
      fecha: asString(item.fecha) || 'N/A',
      prioridad: parsePriority(item.prioridad),
      poNumber: asString(item.poNumber),
    }))
    .filter((item) => item.pieza.length > 0 && !isOrderSummaryRow(item.pieza));
}
