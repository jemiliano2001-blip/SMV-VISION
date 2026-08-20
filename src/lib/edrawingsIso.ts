/**
 * Utilidades puras para el flujo eDrawings → ISO Tool Crib.
 *
 * Convenciones:
 * - Archivos fuente: `.eprt` / `.easm` (partes / ensambles).
 * - Parte ISO en catálogo: `{BASE}.ISO` para que `isIsoDrawingView` la detecte.
 * - Revisión canónica del export: `EDRW`.
 */

export const EDRAWINGS_EXTENSIONS = ['.eprt', '.easm'] as const;
export const ISO_PART_SUFFIX = '.ISO';
export const EDRAWINGS_ISO_REVISION = 'EDRW';

export type EDrawingsExtension = (typeof EDRAWINGS_EXTENSIONS)[number];

export interface ParsedEDrawingName {
  /** Número de parte base (sin .ISO), mayúsculas. */
  basePartNumber: string;
  /** Extensión normalizada (`.eprt` | `.easm`). */
  extension: EDrawingsExtension;
  /** Revisión embebida en el nombre, si existía (ej. REVA → A). */
  embeddedRevision: string | null;
}

export function isEDrawingsExtension(ext: string): ext is EDrawingsExtension {
  const normalized = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return (EDRAWINGS_EXTENSIONS as readonly string[]).includes(normalized);
}

/**
 * Parsea un basename de eDrawing.
 * Formatos: PART.eprt | PART_REVA.easm | PART-REV1.eprt
 */
export function parseEDrawingFileName(fileName: string): ParsedEDrawingName | null {
  const trimmed = fileName.trim();
  const match = trimmed.match(/^(.+?)(?:[-_]REV([A-Z0-9]+))?(\.eprt|\.easm)$/i);
  if (!match) {
    return null;
  }
  const basePartNumber = match[1].trim().toUpperCase();
  if (!basePartNumber) {
    return null;
  }
  const embeddedRevision = match[2] ? match[2].toUpperCase() : null;
  const extension = match[3].toLowerCase() as EDrawingsExtension;
  return { basePartNumber, extension, embeddedRevision };
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
