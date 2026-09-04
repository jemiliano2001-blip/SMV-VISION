/**
 * Buscador del catálogo Tool Crib.
 *
 * Puro: sin React ni Firebase, para poder probarlo en Node.
 *
 * Por qué no es sólo `new Fuse(...)`:
 *
 *  1. **Acentos.** El panel normalizaba la CONSULTA (quitaba acentos) pero no
 *     el ÍNDICE, así que teclear "punzon" no encontraba "PUNZÓN". Aquí se
 *     normalizan los dos lados.
 *  2. **Varias palabras.** Fuse trata "punzon letra m" como un solo patrón
 *     difuso y devuelve ruido. Aquí cada token debe aparecer (AND).
 *  3. **Lo exacto gana.** Teclear "90-1012-06" tiene que poner esa pieza
 *     primero, no perderla entre vecinos que comparten prefijo. El difuso
 *     queda de último recurso, sólo para errores de dedo.
 *  4. **Número compacto.** En el taller se teclea "101206" o "1012 06" para
 *     "90-1012-06"; comparar también la forma sin separadores lo resuelve.
 *  5. **El índice se construye una vez** por catálogo, no en cada tecla.
 */

import Fuse from 'fuse.js';

/** Minúsculas, sin acentos, espacios colapsados. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sólo alfanuméricos: "90-1012-06" → "90101206". */
export function compactText(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

/** Tokens de búsqueda; ignora separadores pero conserva los tramos alfanuméricos. */
export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Niveles de coincidencia, de mejor a peor. Son escalones separados a
 * propósito: dentro de un escalón desempata el catálogo (ISO, orden
 * alfabético), nunca un puntaje difuso.
 */
export const SCORE_EXACT_PART = 1000;
export const SCORE_PART_PREFIX = 900;
export const SCORE_PART_CONTAINS = 800;
export const SCORE_ALL_TOKENS_PREFIX = 700;
export const SCORE_ALL_TOKENS_CONTAINS = 600;
/** Techo del difuso: siempre por debajo de cualquier coincidencia literal. */
export const SCORE_FUZZY_MAX = 500;

export interface SearchableItem {
  /** Número de parte canónico, tal como se muestra. */
  partNumber: string;
  /** Descripción visible de la pieza. */
  description: string;
  /** Todo lo demás indexable (rutas de archivo, revisiones, alias). */
  searchText: string;
}

interface IndexEntry<T> {
  item: T;
  partNumber: string;
  partCompact: string;
  haystack: string;
  haystackTokens: string[];
}

export interface SearchIndex<T> {
  readonly entries: readonly IndexEntry<T>[];
  readonly fuse: Fuse<IndexEntry<T>>;
}

export interface SearchHit<T> {
  item: T;
  score: number;
}

/**
 * Construye el índice normalizado. Llamar una vez por catálogo y memoizarlo:
 * reconstruirlo en cada tecla es lo que hacía lento el panel.
 */
export function buildSearchIndex<T extends SearchableItem>(items: readonly T[]): SearchIndex<T> {
  const entries: IndexEntry<T>[] = items.map((item) => {
    const partNumber = normalizeText(item.partNumber);
    const haystack = normalizeText(`${item.partNumber} ${item.description} ${item.searchText}`);
    return {
      item,
      partNumber,
      partCompact: compactText(item.partNumber),
      haystack,
      haystackTokens: tokenize(haystack),
    };
  });

  const fuse = new Fuse(entries, {
    keys: [
      { name: 'partNumber', weight: 2 },
      { name: 'haystack', weight: 1 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  });

  return { entries, fuse };
}

/** Puntaje literal de una entrada, o null si no coincide de forma literal. */
function literalScore<T>(entry: IndexEntry<T>, query: string, tokens: readonly string[]): number | null {
  const compactQuery = compactText(query);

  if (entry.partNumber === query || (compactQuery.length > 0 && entry.partCompact === compactQuery)) {
    return SCORE_EXACT_PART;
  }
  if (entry.partNumber.startsWith(query) || (compactQuery.length > 0 && entry.partCompact.startsWith(compactQuery))) {
    return SCORE_PART_PREFIX;
  }
  if (entry.partNumber.includes(query) || (compactQuery.length > 0 && entry.partCompact.includes(compactQuery))) {
    return SCORE_PART_CONTAINS;
  }

  if (tokens.length === 0) return null;

  // AND sobre tokens: "punzon letra m" exige las tres piezas.
  const everyTokenIsWordPrefix = tokens.every((token) =>
    entry.haystackTokens.some((candidate) => candidate.startsWith(token)),
  );
  if (everyTokenIsWordPrefix) return SCORE_ALL_TOKENS_PREFIX;

  const everyTokenAppears = tokens.every((token) => entry.haystack.includes(token));
  if (everyTokenAppears) return SCORE_ALL_TOKENS_CONTAINS;

  return null;
}

export interface SearchOptions<T> {
  /** Desempate dentro de un mismo escalón (mayor gana). Ej.: preferir ISO. */
  tieBreak?: (item: T) => number;
}

/**
 * Busca en el índice. Devuelve los aciertos ya ordenados: escalón, desempate
 * del catálogo y, al final, número de parte alfabético para que el orden sea
 * estable entre teclas.
 */
export function searchIndex<T extends SearchableItem>(
  index: SearchIndex<T>,
  rawQuery: string,
  options: SearchOptions<T> = {},
): SearchHit<T>[] {
  const query = normalizeText(rawQuery);
  if (query.length === 0) {
    return index.entries.map((entry) => ({ item: entry.item, score: SCORE_EXACT_PART }));
  }

  const tokens = tokenize(query);
  const scored = new Map<T, number>();

  for (const entry of index.entries) {
    const score = literalScore(entry, query, tokens);
    if (score !== null) scored.set(entry.item, score);
  }

  // El difuso sólo rellena: atrapa errores de dedo ("puznon") sin desplazar
  // nunca a una coincidencia literal, porque su techo queda por debajo.
  if (scored.size === 0) {
    for (const result of index.fuse.search(query)) {
      const fuseScore = result.score ?? 1;
      scored.set(result.item.item, Math.round((1 - fuseScore) * SCORE_FUZZY_MAX));
    }
  }

  const tieBreak = options.tieBreak ?? (() => 0);
  return [...scored.entries()]
    .map(([item, score]) => ({ item, score }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const tie = tieBreak(b.item) - tieBreak(a.item);
      if (tie !== 0) return tie;
      return a.item.partNumber.localeCompare(b.item.partNumber, 'es');
    });
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Parte un texto en tramos resaltados y normales, comparando sobre la forma
 * normalizada pero cortando sobre el ORIGINAL — así "PUNZÓN" se resalta
 * completo aunque el usuario haya tecleado "punzon".
 *
 * Sólo funciona mientras normalizar no cambie la longitud, que es el caso de
 * NFD + quitar diacríticos sobre el español. Si cambiara, devuelve el texto
 * sin resaltar en vez de recortar en el lugar equivocado.
 */
export function highlightSegments(text: string, rawQuery: string): HighlightSegment[] {
  const normalized = normalizeText(text);
  const tokens = tokenize(rawQuery);
  if (tokens.length === 0 || normalized.length !== text.length) {
    return [{ text, match: false }];
  }

  const covered = new Array<boolean>(text.length).fill(false);
  for (const token of tokens) {
    let from = normalized.indexOf(token);
    while (from !== -1) {
      for (let i = from; i < from + token.length; i += 1) covered[i] = true;
      from = normalized.indexOf(token, from + 1);
    }
  }

  const segments: HighlightSegment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || covered[i] !== covered[start]) {
      segments.push({ text: text.slice(start, i), match: covered[start] });
      start = i;
    }
  }
  return segments.length > 0 ? segments : [{ text, match: false }];
}

/** Forma mínima de un alias de taller que el buscador necesita conocer. */
export interface AliasLite {
  pattern: string;
  /** Número de parte al que apunta el alias, tal como está en Firestore (sin canonicalizar). */
  partNumber: string;
}

/**
 * Enriquece el `searchText` de cada ítem con los alias de taller que apunten
 * a su número de parte ("el punzón de la M" → PUNZONES DE MARCA...-001).
 *
 * Puro y agnóstico de cómo se canonicaliza un número de parte: el caller
 * inyecta `canonicalize` (en Biblioteca es `canonicalPartNumber`, que vive en
 * `toolcribCatalog.ts`) para no acoplar este módulo a esa capa.
 *
 * Los ítems sin alias se devuelven tal cual (mismo objeto, sin copiar) — con
 * catálogos grandes y pocos alias, evita clonar todo el catálogo por nada.
 */
export function withAliasSearchText<T extends SearchableItem & { partNumber: string }>(
  items: readonly T[],
  aliases: readonly AliasLite[],
  canonicalize: (partNumber: string) => string,
): T[] {
  if (aliases.length === 0) return items.slice();

  const patternsByCanonicalPart = new Map<string, string[]>();
  for (const alias of aliases) {
    const pattern = alias.pattern.trim();
    if (!pattern) continue;
    const key = canonicalize(alias.partNumber);
    const existing = patternsByCanonicalPart.get(key);
    if (existing) {
      existing.push(pattern);
    } else {
      patternsByCanonicalPart.set(key, [pattern]);
    }
  }

  return items.map((item) => {
    const patterns = patternsByCanonicalPart.get(canonicalize(item.partNumber));
    if (!patterns || patterns.length === 0) return item;
    return { ...item, searchText: `${item.searchText} ${patterns.join(' ')}` };
  });
}
