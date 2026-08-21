/**
 * Lógica pura del puente orden↔plano (sesión).
 * El hook `useOrderDrawingBridge` solo guarda estado; el resolve vive aquí
 * para poder unit-testearlo sin React.
 */

import {
  extractLibrarySignals,
  extractOrderSignals,
  MIN_BLUEPRINT_MATCH_SCORE,
  selectCadDrawingForPrint,
  selectLibraryDrawingMatch,
  type PieceMatchSignals,
} from './matching';
import { normalizeAliasKey } from './aliasKey';
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
      const aliasView = library.find(
        (v) =>
          (matchedAlias.drawingId && v.drawingId === matchedAlias.drawingId) ||
          v.partNumber.toUpperCase() === matchedAlias.partNumber.toUpperCase(),
      );
      if (aliasView) {
        const snap = snapshotFromView(aliasView);
        return {
          key,
          orderId: input.orderId,
          lineIndex: input.lineIndex,
          soNumber: input.soNumber,
          poNumber: input.poNumber,
          pieza: input.pieza,
          numeroParte: input.numeroParte,
          qtyPending: input.qtyPending,
          cadDrawing: snap,
          reportDrawing: snap,
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
  const isIso =
    view.partNumber.toLowerCase().includes('.iso') ||
    (view.sourcePath ?? '').toLowerCase().includes('.iso');

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
