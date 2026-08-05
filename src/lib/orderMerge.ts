/**
 * Utilidades de parseo de cantidades para órdenes y sellos de marca.
 */

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
