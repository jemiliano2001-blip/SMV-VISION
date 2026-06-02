/**
 * Consolidación de órdenes de "hot stamp" (punzones de números/letras para
 * estampado) para el PDF de reporte.
 *
 * En el reporte de Suprajit, cada punzón de estampado llega como una orden
 * independiente con su propio número de parte, así que `mergeGroupedOrders`
 * no los une (cada uno tiene parte distinta). El resultado es un reporte con
 * decenas de renglones casi idénticos ("LETTER M, HOT STAMP", "LETTER X,
 * HOT STAMP", "NUMEROS P/ESTAMPADO # 2 HOT STAMP", "NUMEROS P/ESTAMPADO # 4"…).
 *
 * Este módulo los colapsa en UN solo renglón que lista los identificadores
 * (M, X, 2, 4 …) y resume la cantidad. Es puramente de presentación: solo se
 * usa al construir el PDF — no toca el modelo de datos ni el panel de control.
 */

import type { Order } from '../types';
import { extractCantidadUnit, parseCantidadNumber } from './orderMerge';

/**
 * Extrae el identificador que distingue al punzón (la letra o el número):
 *   "LETTER M, HOT STAMP"             -> "M"
 *   "NUMEROS P/ESTAMPADO # 2 HOT ..." -> "2"
 *   "NUMEROS P/ESTAMPADO # 4"         -> "4"
 * Devuelve `null` si no se reconoce un identificador claro.
 */
export function extractHotStampId(pieza: string): string | null {
  const s = pieza.toUpperCase();
  let m = s.match(/\bLETTER\s+([A-Z0-9]{1,3})\b/);
  if (m) return m[1];
  m = s.match(/#\s*([A-Z0-9]{1,3})\b/);
  if (m) return m[1];
  return null;
}

/**
 * True si la pieza es un punzón/número/letra para estampado.
 *
 * Detección CONSERVADORA para no barrer piezas de fabricación que solo
 * *mencionan* estampado (ej. "Fabricación de guarda para estampadora…" NO es
 * un punzón). Es hot stamp si:
 *   - contiene "HOT STAMP", o
 *   - menciona "ESTAMPAD…" **y** tiene un identificador extraíble (`# N` o
 *     `LETTER X`) — es decir, es un punzón numerado/letrado, no una oración
 *     descriptiva.
 */
export function isHotStampPiece(pieza: string): boolean {
  const s = pieza.toUpperCase();
  if (/HOT\s*STAMP/.test(s)) return true;
  if (/ESTAMPAD/.test(s) && extractHotStampId(pieza) !== null) return true;
  return false;
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * True si la entrada del catálogo corresponde a un juego de punzones/hot stamp.
 * Busca por keywords en partNumber, sourcePath y description.
 */
export function isHotStampCatalogEntry(view: {
  partNumber: string;
  sourcePath: string | null;
  description: string;
}): boolean {
  const text = [view.partNumber, view.sourcePath ?? '', view.description]
    .join(' ')
    .toUpperCase();
  return /PUNZON|HOT[\s-]?STAMP|ESTAMPAD/.test(text);
}

/**
 * Reemplaza todas las órdenes de hot stamp por un único renglón sintético que
 * lista sus identificadores y resume la cantidad. Si hay menos de 2 hot stamps,
 * devuelve la lista intacta (no vale la pena consolidar uno solo).
 *
 * Si se pasa `refImage` (imagen rasterizada del ISO de referencia), el renglón
 * sintético lleva `isometricView` y aparece en la tabla principal del PDF.
 * Sin `refImage`, cae en la sección de pendientes como antes.
 */
export function consolidateHotStamps(orders: Order[], refImage?: string): Order[] {
  const hot: Order[] = [];
  const rest: Order[] = [];
  for (const o of orders) {
    (isHotStampPiece(o.pieza) ? hot : rest).push(o);
  }
  if (hot.length < 2) return orders;

  // Agrupar por identificador, sumando cantidades. Mantiene el orden de
  // aparición. Si un punzón no tiene id reconocible, se usa el nombre completo
  // como fallback (raro tras la detección conservadora). Dos órdenes del mismo
  // identificador (ej. dos "M") se suman → "M×4" en vez de "M×2, M×2".
  const idsInOrder: string[] = [];
  const qtyById = new Map<string, number>();
  const unparsedIds = new Set<string>();
  for (const o of hot) {
    const id = extractHotStampId(o.pieza) ?? o.pieza.trim();
    if (!qtyById.has(id)) {
      qtyById.set(id, 0);
      idsInOrder.push(id);
    }
    const q = parseCantidadNumber(o.cantidad);
    if (q === null) unparsedIds.add(id);
    else qtyById.set(id, qtyById.get(id)! + q);
  }

  let unit = 'Pieza';
  for (const o of hot) {
    const u = extractCantidadUnit(o.cantidad);
    if (u) { unit = u; break; }
  }

  const allParsed = unparsedIds.size === 0;
  const totals = idsInOrder.map((id) => qtyById.get(id)!);
  const uniform = allParsed && totals.every((t) => t === totals[0]);
  const punchCount = idsInOrder.length;

  // Nombre de la pieza (multi-línea: el cajón de NOMBRE es ancho).
  let pieza: string;
  if (uniform) {
    const each = totals[0];
    const unitWord = unit.toLowerCase();
    pieza =
      `HOT STAMP / ESTAMPADO (${punchCount} punzones): ${idsInOrder.join(', ')}` +
      `\n${formatNum(each)} ${unitWord}${each === 1 ? '' : 's'} de cada una`;
  } else {
    // Cantidades distintas: detallar por identificador (M×4, X×2, 2×2 …).
    const detail = idsInOrder
      .map((id) => (unparsedIds.has(id) ? id : `${id}×${formatNum(qtyById.get(id)!)}`))
      .join(', ');
    pieza = `HOT STAMP / ESTAMPADO (${punchCount} punzones)\n${detail}`;
  }

  // Cantidad total (suma de todos los punzones) en la columna CANT.
  // Cuando no se pudo parsear alguna cantidad, se usa '—' (sin dígitos) para
  // que parseCantidadNumber devuelva null y summarizeOrders no cuente los
  // punzones como piezas fabricadas. El conteo de punzones ya aparece en pieza.
  let cantidad: string;
  if (allParsed) {
    const total = totals.reduce<number>((a, b) => a + b, 0);
    cantidad = `${formatNum(total)}\n${unit}`;
  } else {
    cantidad = `—\n${unit}`;
  }

  const ordenes = [...new Set(hot.map((o) => o.orden).filter((s) => s && s !== 'N/A'))];
  const orden = ordenes.length > 0 ? ordenes.join('\n') : 'N/A';

  const fechas = [...new Set(hot.map((o) => o.fecha).filter((f) => f && f !== 'N/A'))];
  const fecha = fechas.length > 0 ? fechas.join('\n') : 'N/A';

  const prioridad: Order['prioridad'] = hot.some((o) => o.prioridad === 'URGENTE')
    ? 'URGENTE'
    : 'Normal';
  const poNumber = hot.find((o) => o.poNumber)?.poNumber;

  const synthetic: Order = {
    pieza,
    cantidad,
    orden,
    fecha,
    prioridad,
    ...(poNumber ? { poNumber } : {}),
    ...(refImage ? { isometricView: refImage, haSidoAuditada: true } : {}),
  };

  return [...rest, synthetic];
}
