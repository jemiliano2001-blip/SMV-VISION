/**
 * Lógica pura del puente orden↔plano (sesión).
 * El hook `useOrderDrawingBridge` solo guarda estado; el resolve vive aquí
 * para poder unit-testearlo sin React.
 */

import {
  extractLibrarySignals,
  extractOrderSignals,
  isIsoDrawingView,
  MIN_BLUEPRINT_MATCH_SCORE,
  selectCadDrawingForPrint,
  selectLibraryDrawingMatch,
  type PieceMatchSignals,
} from './matching';
import { normalizeAliasKey } from './aliasKey';
import { canonicalPartNumber, pickPreferredDrawing } from './toolcribCatalog';
import type {
  OrderDrawingLink,
  OrderDrawingSnapshot,
  ToolcribActiveDrawingView,
} from '../types';

export function makeOrderDrawingLinkKey(orderId: string, lineIndex: number): string {
  return `${orderId}:${lineIndex}`;
}

export function snapshotFromView(view: ToolcribActiveDrawingView): OrderDrawingSnapshot {
  return {
    drawingId: view.drawingId,
    partId: view.partId,
    partNumber: view.partNumber,
    revision: view.revision,
    pdfUrl: view.pdfUrl,
    stlUrl: view.stlUrl,
    sourcePath: view.sourcePath,
    customer: view.customer,
    description: view.description,
    sourceType: view.sourceType,
    effectiveFromUTC: view.effectiveFromUTC,
  };
}

export function viewFromSnapshot(snapshot: OrderDrawingSnapshot): ToolcribActiveDrawingView {
  return {
    drawingId: snapshot.drawingId,
    partId: snapshot.partId,
    partNumber: snapshot.partNumber,
    revision: snapshot.revision,
    pdfUrl: snapshot.pdfUrl,
    stlUrl: snapshot.stlUrl,
    sourcePath: snapshot.sourcePath,
    customer: snapshot.customer,
    description: snapshot.description,
    sourceType: snapshot.sourceType,
    effectiveFromUTC: snapshot.effectiveFromUTC,
  };
}

/** Entrada mínima para resolver un vínculo desde una línea Odoo. */
export interface ResolveOrderDrawingInput {
  orderId: string;
  lineIndex: number;
  soNumber: string;
  poNumber: string;
  pieza: string;
  numeroParte: string;
  qtyPending: number;
}

/**
 * Localiza en el catálogo el dibujo al que apunta un alias, por prioridad estricta:
 *
 * 1. `drawingId` exacto — el alias nombra un dibujo concreto, gana sobre todo.
 * 2. Número de parte exacto.
 * 3. Número de parte canónico (ignorando el sufijo `.ISO`).
 *
 * La prioridad importa: si los tres criterios se evalúan dentro de un mismo
 * `find`, gana el que aparezca primero en el array del catálogo, no el más
 * específico — un CAD hermano listado antes le robaba el lugar al ISO que el
 * alias nombraba por id. Dentro de cada nivel se usa `pickPreferredDrawing`
 * para que con varias revisiones activas gane la misma que elige la Biblioteca.
 */
export function findAliasDrawingView(
  library: readonly ToolcribActiveDrawingView[],
  alias: { partNumber: string; drawingId: string },
): ToolcribActiveDrawingView | null {
  if (alias.drawingId) {
    const byId = library.find((v) => v.drawingId === alias.drawingId);
    if (byId) return byId;
  }

  const exact = alias.partNumber.toUpperCase();
  const byPartNumber = library.filter((v) => v.partNumber.toUpperCase() === exact);
  if (byPartNumber.length > 0) return pickPreferredDrawing(byPartNumber);

  const canonical = canonicalPartNumber(alias.partNumber).toUpperCase();
  return pickPreferredDrawing(
    library.filter((v) => canonicalPartNumber(v.partNumber).toUpperCase() === canonical),
  );
}

/**
 * Resuelve CAD (print) + reportDrawing (ISO-first) contra el catálogo.
 * Soporta memoria persistente de alias aprendidos (`aliases`).
 * No muta estado — el caller decide si upsert al Map de sesión.
 */
export function resolveOrderDrawingLink(
  input: ResolveOrderDrawingInput,
  library: readonly ToolcribActiveDrawingView[],
  signalsByDrawingId?: ReadonlyMap<string, PieceMatchSignals>,
  matchedAt: string = new Date().toISOString(),
  aliases?: readonly { pattern: string; partNumber: string; drawingId: string }[],
): OrderDrawingLink {
  const key = makeOrderDrawingLinkKey(input.orderId, input.lineIndex);

  // 1. Verificar primero si coincide con algún alias aprendido
  if (aliases && aliases.length > 0) {
    // Un alias es una decisión explícita del operador: solo debe aplicar a la
    // misma pieza o número de parte, nunca a una subcadena genérica (p. ej.
    // "PUNZON" no puede reclamar todos los punzones futuros).
    const aliasCandidates = new Set(
      [input.numeroParte, input.pieza]
        .map(normalizeAliasKey)
        .filter((value) => value.length > 0),
    );
    const matchedAlias = aliases.find((a) => aliasCandidates.has(normalizeAliasKey(a.pattern)));

    if (matchedAlias) {
      const aliasView = findAliasDrawingView(library, matchedAlias);

      if (aliasView) {
        const canonical = canonicalPartNumber(aliasView.partNumber).toUpperCase();
        // Separar CAD e ISO: cadDrawing NUNCA debe ser un ISO (el ISO no se imprime como OT).
        // Al buscar el complemento se usa `pickPreferredDrawing` —no el primero que
        // aparezca— para que con varias revisiones activas gane la misma que elige
        // la Biblioteca, y no una revisión vieja por accidente de orden.
        const siblings = library.filter(
          (v) => canonicalPartNumber(v.partNumber).toUpperCase() === canonical,
        );
        const cadView = !isIsoDrawingView(aliasView)
          ? aliasView
          : pickPreferredDrawing(siblings.filter((v) => !isIsoDrawingView(v)));
        const isoView = isIsoDrawingView(aliasView)
          ? aliasView
          : pickPreferredDrawing(siblings.filter((v) => isIsoDrawingView(v)));

        const cadSnap = cadView ? snapshotFromView(cadView) : null;
        const reportSnap = isoView ? snapshotFromView(isoView) : cadSnap;

        return {
          key,
          orderId: input.orderId,
          lineIndex: input.lineIndex,
          soNumber: input.soNumber,
          poNumber: input.poNumber,
          pieza: input.pieza,
          numeroParte: input.numeroParte,
          qtyPending: input.qtyPending,
          cadDrawing: cadSnap,
          reportDrawing: reportSnap,
          matchScore: 100,
          matchedAt,
          status: 'manual',
        };
      }
    }
  }

  // 2. Evaluador heurístico estándar
  const orderSignals = extractOrderSignals(input.pieza, input.numeroParte || undefined);

  const cadMatch = selectCadDrawingForPrint(orderSignals, library, signalsByDrawingId);
  const reportMatch = selectLibraryDrawingMatch(orderSignals, library, signalsByDrawingId);

  const cadOk =
    cadMatch.view !== null && cadMatch.score >= MIN_BLUEPRINT_MATCH_SCORE;
  const reportOk =
    reportMatch.view !== null && reportMatch.score >= MIN_BLUEPRINT_MATCH_SCORE;

  const matchScore = Math.max(
    cadOk ? cadMatch.score : 0,
    reportOk ? reportMatch.score : 0,
  );

  return {
    key,
    orderId: input.orderId,
    lineIndex: input.lineIndex,
    soNumber: input.soNumber,
    poNumber: input.poNumber,
    pieza: input.pieza,
    numeroParte: input.numeroParte,
    qtyPending: input.qtyPending,
    cadDrawing: cadOk && cadMatch.view ? snapshotFromView(cadMatch.view) : null,
    reportDrawing: reportOk && reportMatch.view ? snapshotFromView(reportMatch.view) : null,
    matchScore,
    matchedAt,
    status: cadOk || reportOk ? 'linked' : 'no_match',
  };
}

/**
 * Override manual desde Biblioteca: fija el dibujo elegido.
 * Si es ISO → reportDrawing; si es CAD → cadDrawing + reportDrawing (fallback).
 */
export function applyManualDrawingToLink(
  base: OrderDrawingLink,
  view: ToolcribActiveDrawingView,
  matchedAt: string = new Date().toISOString(),
): OrderDrawingLink {
  const snap = snapshotFromView(view);
  const isIso = isIsoDrawingView(view);

  if (isIso) {
    return {
      ...base,
      reportDrawing: snap,
      matchScore: 100,
      matchedAt,
      status: 'manual',
    };
  }

  return {
    ...base,
    cadDrawing: snap,
    reportDrawing: base.reportDrawing ?? snap,
    matchScore: 100,
    matchedAt,
    status: 'manual',
  };
}

/**
 * Decide qué `drawingId` debe recordar un alias tras un override manual.
 *
 * Se prefiere el CAD (es el que se imprime como OT), pero SOLO si pertenece a la
 * misma pieza que el operador acaba de elegir. Cuando el usuario adjunta un ISO
 * para corregir un auto-match equivocado, `link.cadDrawing` sigue siendo el CAD
 * viejo —de otra pieza—, y guardarlo dejaría el error congelado: al reproducir el
 * alias, `resolveOrderDrawingLink` busca por `drawingId` antes que por número de
 * parte, así que el plano equivocado ganaría para siempre.
 */
export function selectAliasDrawingId(
  link: OrderDrawingLink,
  chosen: ToolcribActiveDrawingView,
): string {
  const cadSnap = link.cadDrawing;
  if (!cadSnap) return chosen.drawingId;

  const chosenCanonical = canonicalPartNumber(chosen.partNumber).toUpperCase();
  const cadCanonical = canonicalPartNumber(cadSnap.partNumber).toUpperCase();

  return cadCanonical === chosenCanonical ? cadSnap.drawingId : chosen.drawingId;
}

/** Plano a adjuntar al workspace de reporte (ISO preferido, CAD como fallback). */
export function getReportDrawingSnapshot(
  link: OrderDrawingLink,
): OrderDrawingSnapshot | null {
  return link.reportDrawing ?? link.cadDrawing;
}

/** Plano CAD para ToolcribPrintModal. */
export function getCadDrawingSnapshot(
  link: OrderDrawingLink,
): OrderDrawingSnapshot | null {
  return link.cadDrawing;
}

/**
 * Precomputa señales de catálogo una vez (mismo patrón que extractInfo).
 */
export function buildLibrarySignalsMap(
  library: readonly ToolcribActiveDrawingView[],
): Map<string, PieceMatchSignals> {
  return new Map(library.map((view) => [view.drawingId, extractLibrarySignals(view)]));
}

/**
 * Extrae etiqueta de pieza / número de parte desde una línea Odoo
 * (misma heurística que OdooOrdersPanel / extractInfo).
 */
export function parseOdooLineLabels(product: string, description: string): {
  pieza: string;
  numeroParte: string;
  productLabel: string;
} {
  const productLabel = product.includes('] ')
    ? product.split('] ').slice(1).join('] ')
    : product;

  let numeroParte = '';
  let piezaName = product;
  const bracketMatch = product.match(/^\[(.*?)\]\s*(.*)$/);
  if (bracketMatch) {
    numeroParte = bracketMatch[1];
    piezaName = bracketMatch[2];
  }

  const fullPieza =
    description && description !== piezaName
      ? `${piezaName} - ${description}`
      : description || piezaName || productLabel;

  return { pieza: fullPieza, numeroParte, productLabel };
}
