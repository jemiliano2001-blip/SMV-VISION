/**
 * Utilidades puras para el flujo eDrawings → ISO Tool Crib.
 *
 * Convenciones:
 * - Archivos fuente: eDrawings (`.eprt` / `.easm`) y SolidWorks
 *   (`.sldprt` / `.sldasm`).
 * - Parte ISO en catálogo: `{BASE}.ISO` para que `isIsoDrawingView` la detecte.
 * - Revisión canónica del export: `EDRW`.
 */

export const EDRAWINGS_EXTENSIONS = ['.eprt', '.easm'] as const;
export const SOLIDWORKS_EXTENSIONS = ['.sldprt', '.sldasm'] as const;
export const CAD_SOURCE_EXTENSIONS = [...EDRAWINGS_EXTENSIONS, ...SOLIDWORKS_EXTENSIONS] as const;
export const ISO_PART_SUFFIX = '.ISO';
export const EDRAWINGS_ISO_REVISION = 'EDRW';

export type EDrawingsExtension = (typeof EDRAWINGS_EXTENSIONS)[number];
export type SolidWorksExtension = (typeof SOLIDWORKS_EXTENSIONS)[number];
export type CadSourceExtension = (typeof CAD_SOURCE_EXTENSIONS)[number];
export type CadSourceKind = 'edrawings' | 'solidworks';

export interface ParsedEDrawingName {
  /** Número de parte base (sin .ISO), mayúsculas. */
  basePartNumber: string;
  /** Extensión normalizada (`.eprt` | `.easm`). */
  extension: EDrawingsExtension;
  /** Revisión embebida en el nombre, si existía (ej. REVA → A). */
  embeddedRevision: string | null;
}

/** Nombre de una fuente CAD que puede producir una isométrica. */
export interface ParsedCadSourceFileName {
  /** Número de parte base (sin revisión embebida), mayúsculas. */
  basePartNumber: string;
  /** Extensión normalizada de la fuente CAD. */
  extension: CadSourceExtension;
  /** Origen que determina el exportador a utilizar. */
  sourceKind: CadSourceKind;
  /** Revisión terminal `-REVx` o `_REVx`, si existía. */
  embeddedRevision: string | null;
}

/** Metadatos mínimos para seleccionar una fuente por número de parte. */
export interface CadSourceCandidate {
  sourceKind: CadSourceKind;
  modifiedAtMs: number;
  relativePath: string;
}

export function isEDrawingsExtension(ext: string): ext is EDrawingsExtension {
  const normalized = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return (EDRAWINGS_EXTENSIONS as readonly string[]).includes(normalized);
}

export function isCadSourceExtension(ext: string): ext is CadSourceExtension {
  const normalized = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return (CAD_SOURCE_EXTENSIONS as readonly string[]).includes(normalized);
}

function sourceKindForExtension(extension: CadSourceExtension): CadSourceKind {
  return isEDrawingsExtension(extension) ? 'edrawings' : 'solidworks';
}

/**
 * Parsea un basename de fuente CAD soportada.
 *
 * Solo una revisión terminal con separador es significativa: `PART-REVA`
 * y `PART_REV1` se separan, mientras que `PARTREVISION` permanece intacto.
 */
export function parseCadSourceFileName(fileName: string): ParsedCadSourceFileName | null {
  const trimmed = fileName.trim();
  const match = trimmed.match(/^(.+?)(?:[-_]REV([A-Z0-9]+))?(\.eprt|\.easm|\.sldprt|\.sldasm)$/i);
  if (!match) {
    return null;
  }

  const basePartNumber = match[1].trim().toUpperCase();
  if (!basePartNumber) {
    return null;
  }

  const extension = match[3].toLowerCase() as CadSourceExtension;
  return {
    basePartNumber,
    extension,
    sourceKind: sourceKindForExtension(extension),
    embeddedRevision: match[2] ? match[2].toUpperCase() : null,
  };
}

/**
 * Parsea un basename de eDrawing.
 * Formatos: PART.eprt | PART_REVA.easm | PART-REV1.eprt
 */
export function parseEDrawingFileName(fileName: string): ParsedEDrawingName | null {
  const parsed = parseCadSourceFileName(fileName);
  if (!parsed || parsed.sourceKind !== 'edrawings') {
    return null;
  }
  return {
    basePartNumber: parsed.basePartNumber,
    extension: parsed.extension as EDrawingsExtension,
    embeddedRevision: parsed.embeddedRevision,
  };
}

/**
 * Excluye rutas históricas y artefactos de export. Los nombres se comparan por
 * segmento, no por subcadena: `OLDIES` no es el directorio histórico `OLD`.
 */
export function isExcludedCadSourceRelativePath(relativePath: string): boolean {
  const segments = relativePath
    .trim()
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.some((segment) => {
    const normalized = segment.toUpperCase();
    return normalized === 'OLD'
      || normalized === 'VERSION ANTERIOR'
      || normalized === 'ORIGINAL NO TOCAR'
      || normalized === 'EXPORT'
      || segment.startsWith('.')
      || normalized.startsWith('_ISO_EXPORT');
  });
}

/** Rechaza archivos vacíos y temporales/bloqueados que crea SolidWorks. */
export function isUsableCadSourceFile(fileName: string, sizeBytes: number): boolean {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return false;
  }
  const basename = fileName.trim().split(/[\\/]/).pop() ?? '';
  return !basename.startsWith('~$');
}

/** Combina la validación de fuente soportada con las reglas de archivo seguro. */
export function isCadSourceCandidateFile(fileName: string, sizeBytes: number): boolean {
  return parseCadSourceFileName(fileName) !== null && isUsableCadSourceFile(fileName, sizeBytes);
}

/**
 * Orden de preferencia estable: eDrawings, modificación más reciente y ruta
 * léxica ascendente. No usa localeCompare para que el resultado no dependa de
 * la configuración regional de la máquina que ejecuta el inventario.
 */
export function compareCadSourceCandidates(
  left: CadSourceCandidate,
  right: CadSourceCandidate,
): number {
  const sourceKindOrder = (sourceKind: CadSourceKind): number => sourceKind === 'edrawings' ? 0 : 1;
  const bySourceKind = sourceKindOrder(left.sourceKind) - sourceKindOrder(right.sourceKind);
  if (bySourceKind !== 0) return bySourceKind;

  const byModifiedAt = right.modifiedAtMs - left.modifiedAtMs;
  if (byModifiedAt !== 0) return byModifiedAt;

  if (left.relativePath < right.relativePath) return -1;
  if (left.relativePath > right.relativePath) return 1;
  return 0;
}

export function rankCadSourceCandidates<T extends CadSourceCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort(compareCadSourceCandidates);
}

/** partNumber de catálogo que marca la entrada como ISO. */
export function buildIsoPartNumber(basePartNumber: string): string {
  const base = basePartNumber.trim().toUpperCase().replace(/\.ISO$/i, '');
  return `${base}${ISO_PART_SUFFIX}`;
}

export function buildIsoPdfFileName(basePartNumber: string): string {
  return `${buildIsoPartNumber(basePartNumber)}.pdf`;
}

export function buildIsoStlFileName(basePartNumber: string): string {
  return `${buildIsoPartNumber(basePartNumber)}.stl`;
}

/** Nombre de archivo del PDF acotado (CAD, sin sufijo `.ISO`). */
export function buildCadPdfFileName(basePartNumber: string): string {
  return `${basePartNumber.trim().toUpperCase().replace(/\.ISO$/i, '')}.pdf`;
}

export interface ParsedCadDrawingFileName {
  /** Número de parte base (sin revisión embebida), mayúsculas. */
  basePartNumber: string;
  /** Revisión terminal `-REVx` o `_REVx`, si existía. */
  embeddedRevision: string | null;
}

/**
 * Parsea un basename de plano acotado SolidWorks (`.slddrw`).
 * Es la fuente del PDF con cotas — distinta del modelo 3D (`.sldprt`/`.easm`)
 * del que sale la isométrica.
 */
export function parseCadDrawingFileName(fileName: string): ParsedCadDrawingFileName | null {
  const trimmed = fileName.trim();
  const match = trimmed.match(/^(.+?)(?:[-_]REV([A-Z0-9]+))?\.slddrw$/i);
  if (!match) {
    return null;
  }
  const basePartNumber = match[1].trim().toUpperCase();
  if (!basePartNumber) {
    return null;
  }
  return {
    basePartNumber,
    embeddedRevision: match[2] ? match[2].toUpperCase() : null,
  };
}

/**
 * Busca un companion raster junto al eDrawing (mismo stem).
 * Acepta `.jpg`, `.jpeg`, `.png`.
 */
export function resolveCompanionImagePath(
  eDrawingPath: string,
  existsSync: (path: string) => boolean,
  dirname: (path: string) => string,
  basename: (path: string, ext?: string) => string,
  join: (...parts: string[]) => string,
  extname: (path: string) => string,
): string | null {
  const dir = dirname(eDrawingPath);
  const stem = basename(eDrawingPath, extname(eDrawingPath));
  const candidates = [`${stem}.jpg`, `${stem}.jpeg`, `${stem}.png`, `${stem}.JPG`, `${stem}.PNG`];
  for (const name of candidates) {
    const full = join(dir, name);
    if (existsSync(full)) {
      return full;
    }
  }
  return null;
}

/**
 * Companion STL (export previo o del mismo batch).
 */
export function resolveCompanionStlPath(
  eDrawingPath: string,
  existsSync: (path: string) => boolean,
  dirname: (path: string) => string,
  basename: (path: string, ext?: string) => string,
  join: (...parts: string[]) => string,
  extname: (path: string) => string,
): string | null {
  const dir = dirname(eDrawingPath);
  const stem = basename(eDrawingPath, extname(eDrawingPath));
  for (const name of [`${stem}.stl`, `${stem}.STL`]) {
    const full = join(dir, name);
    if (existsSync(full)) {
      return full;
    }
  }
  return null;
}
