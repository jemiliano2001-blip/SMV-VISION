/**
 * Familias, agrupado CAD+ISO y filtros de archivo del catálogo Tool Crib.
 * Puro: sin React ni Firebase. La unidad mental del taller es la pieza, no el archivo.
 */

import { isIsoDrawingView } from './matching';
import type { ToolcribActiveDrawingView } from '../types';

export type PartFamily =
  | 'all'
  | 'punzones'
  | 'matrices'
  | 'bujes'
  | 'placas'
  | 'cuchillas'
  | 'ensambles'
  | 'otros';

export const FAMILIES: { id: PartFamily; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'punzones', label: 'Punzones / Marcas' },
  { id: 'matrices', label: 'Matrices / Dados' },
  { id: 'bujes', label: 'Bujes' },
  { id: 'placas', label: 'Placas / Calces' },
  { id: 'cuchillas', label: 'Gavilanes / Cuchillas' },
  { id: 'ensambles', label: 'Ensambles / Nidos' },
  { id: 'otros', label: 'Otros' },
];

export type AssetFilter = 'all' | 'cad' | 'iso' | 'stl' | 'missing-pdf';

export const ASSET_FILTERS: { id: AssetFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'cad', label: 'Con CAD' },
  { id: 'iso', label: 'Con ISO' },
  { id: 'stl', label: 'Con 3D' },
  { id: 'missing-pdf', label: 'Sin PDF' },
];

const PUNZON_RE = /PUNZON|HOT\s*STAMP|PUNCH|MARCA|ESTAMP/i;
const MATRIZ_RE = /MATRIZ|DIE|INSERT|CAVIDAD|DADO/i;
const BUJE_RE = /BUJE|BUSHING|CASQUILLO/i;
const PLACA_RE = /PLACA|PLATE|CALCE|SHIM|BASE/i;
const CUCHILLA_RE = /GAVILAN|CUCHILLA|BLADE|CORTE|SHEAR/i;
const ENSAMBLE_RE = /ENSAMBLE|NIDO|FIXTURE|JIG|ASSEMBLY|DISPOSITIVO/i;
const OTROS_RE =
  /PUNZON|HOT\s*STAMP|PUNCH|MARCA|ESTAMP|MATRIZ|DIE|INSERT|CAVIDAD|DADO|BUJE|BUSHING|CASQUILLO|PLACA|PLATE|CALCE|SHIM|BASE|GAVILAN|CUCHILLA|BLADE|CORTE|SHEAR|ENSAMBLE|NIDO|FIXTURE|JIG|ASSEMBLY|DISPOSITIVO/i;

function familyHaystack(view: ToolcribActiveDrawingView): string {
  return `${view.partNumber} ${view.description} ${view.sourcePath}`.toUpperCase();
}

export function matchesFamily(view: ToolcribActiveDrawingView, family: PartFamily): boolean {
  if (family === 'all') return true;
  const text = familyHaystack(view);

  switch (family) {
    case 'punzones':
      return PUNZON_RE.test(text);
    case 'matrices':
      return MATRIZ_RE.test(text);
    case 'bujes':
      return BUJE_RE.test(text);
    case 'placas':
      return PLACA_RE.test(text);
    case 'cuchillas':
      return CUCHILLA_RE.test(text);
    case 'ensambles':
      return ENSAMBLE_RE.test(text);
    case 'otros':
      return !OTROS_RE.test(text);
  }
}

/** Número de parte canónico: quita el sufijo `.ISO` de catálogo. */
export function canonicalPartNumber(partNumber: string): string {
  return partNumber.trim().toUpperCase().replace(/\.ISO$/i, '');
}

export interface ToolcribPartGroup {
  key: string;
  partNumber: string;
  customer: string;
  description: string;
  members: ToolcribActiveDrawingView[];
  cad: ToolcribActiveDrawingView | null;
  iso: ToolcribActiveDrawingView | null;
  extras: ToolcribActiveDrawingView[];
  stlView: ToolcribActiveDrawingView | null;
  searchText: string;
}

function preferDrawing(
  left: ToolcribActiveDrawingView,
  right: ToolcribActiveDrawingView,
): ToolcribActiveDrawingView {
  const leftPdf = left.pdfUrl ? 1 : 0;
  const rightPdf = right.pdfUrl ? 1 : 0;
  if (leftPdf !== rightPdf) {
    return rightPdf > leftPdf ? right : left;
  }
  const leftStl = left.stlUrl ? 1 : 0;
  const rightStl = right.stlUrl ? 1 : 0;
  if (leftStl !== rightStl) {
    return rightStl > leftStl ? right : left;
  }
  const leftFrom = left.effectiveFromUTC ?? '';
  const rightFrom = right.effectiveFromUTC ?? '';
  return rightFrom > leftFrom ? right : left;
}

export function pickPreferredDrawing(
  views: readonly ToolcribActiveDrawingView[],
): ToolcribActiveDrawingView | null {
  if (views.length === 0) {
    return null;
  }
  return views.reduce((best, current) => preferDrawing(best, current));
}

function buildSearchText(
  partNumber: string,
  members: readonly ToolcribActiveDrawingView[],
): string {
  const bits = [partNumber];
  for (const member of members) {
    bits.push(member.partNumber, member.description, member.sourcePath, member.revision);
  }
  return bits.filter((bit) => bit.trim().length > 0).join(' ');
}

export function groupDrawingViews(
  views: readonly ToolcribActiveDrawingView[],
): ToolcribPartGroup[] {
  const buckets = new Map<string, ToolcribActiveDrawingView[]>();
  for (const view of views) {
    const key = canonicalPartNumber(view.partNumber);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(view);
    } else {
      buckets.set(key, [view]);
    }
  }

  const groups: ToolcribPartGroup[] = [];
  for (const [key, members] of buckets) {
    const cadMembers = members.filter((view) => !isIsoDrawingView(view));
    const isoMembers = members.filter((view) => isIsoDrawingView(view));
    const cad = pickPreferredDrawing(cadMembers);
    const iso = pickPreferredDrawing(isoMembers);
    const usedIds = new Set<string>();
    if (cad) usedIds.add(cad.drawingId);
    if (iso) usedIds.add(iso.drawingId);
    const extras = members.filter((view) => !usedIds.has(view.drawingId));
    const stlView = pickPreferredDrawing(members.filter((view) => Boolean(view.stlUrl)));
    const primary = cad ?? iso ?? members[0];
    if (!primary) {
      continue;
    }

    groups.push({
      key,
      partNumber: key,
      customer: primary.customer,
      description: (cad?.description || iso?.description || primary.description).trim(),
      members,
      cad,
      iso,
      extras,
      stlView,
      searchText: buildSearchText(key, members),
    });
  }

  groups.sort((a, b) => a.partNumber.localeCompare(b.partNumber, 'es'));
  return groups;
}

export function matchesFamilyGroup(group: ToolcribPartGroup, family: PartFamily): boolean {
  if (family === 'all') return true;
  if (family === 'otros') {
    return group.members.every((member) => matchesFamily(member, 'otros'));
  }
  return group.members.some((member) => matchesFamily(member, family));
}

export function matchesAssetFilter(group: ToolcribPartGroup, filter: AssetFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'cad':
      return group.cad !== null;
    case 'iso':
      return group.iso !== null;
    case 'stl':
      return group.stlView !== null;
    case 'missing-pdf':
      return !group.cad?.pdfUrl && !group.iso?.pdfUrl;
  }
}

export function previewDrawingForGroup(group: ToolcribPartGroup): ToolcribActiveDrawingView | null {
  if (group.cad?.pdfUrl) return group.cad;
  if (group.iso?.pdfUrl) return group.iso;
  return group.cad ?? group.iso;
}

export function printDrawingForGroup(group: ToolcribPartGroup): ToolcribActiveDrawingView | null {
  return group.cad;
}

export function attachDrawingForGroup(group: ToolcribPartGroup): ToolcribActiveDrawingView | null {
  if (group.iso?.pdfUrl) return group.iso;
  if (group.cad?.pdfUrl) return group.cad;
  return group.iso ?? group.cad;
}
