/** Normalización pura y compartida para claves de alias orden ↔ plano. */
export function normalizeAliasKey(pattern: string): string {
  return pattern
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\-/. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
