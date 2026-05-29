/**
 * Cálculo y formato de antigüedad de órdenes de taller.
 *
 * Las fechas vienen del PDF de Google Sheets en formatos mezclados — el
 * extractor de IA no los normaliza. Soportamos DD/MM/YYYY, DD-MM-YYYY y
 * el ISO YYYY-MM-DD. Cualquier otro formato devuelve `null` y se trata
 * como "fecha no parseable" en la UI.
 */

/**
 * Devuelve la antigüedad en días calendario de una fecha (>= 0), o `null` si
 * el string no coincide con ningún formato conocido. Acepta solo una fecha
 * individual — para celdas multi-línea agregadas, el caller debe pasar
 * `fecha.split('\n')[0]`.
 */
export function getOrderAgeDays(fecha: string): number | null {
  let d: number, m: number, y: number;

  // DD/MM/YYYY or D/M/YYYY
  let match = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    [, d, m, y] = match.map(Number) as [string, number, number, number];
    const date = new Date(y, m - 1, d);
    if (!isNaN(date.getTime())) {
      return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
    }
  }
  // DD-MM-YYYY
  match = fecha.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    [, d, m, y] = match.map(Number) as [string, number, number, number];
    const date = new Date(y, m - 1, d);
    if (!isNaN(date.getTime())) {
      return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
    }
  }
  // YYYY-MM-DD (ISO)
  match = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    [, y, m, d] = match.map(Number) as [string, number, number, number];
    const date = new Date(y, m - 1, d);
    if (!isNaN(date.getTime())) {
      return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
    }
  }
  return null;
}

/** Renderiza una cantidad de días en español compacto ("Hoy", "3 días", "5 sem", "2 meses"). */
export function formatAgeDays(days: number): string {
  if (days === 0) return 'Hoy';
  if (days === 1) return '1 día';
  if (days < 14) return `${days} días`;
  if (days < 60) return `${Math.floor(days / 7)} sem`;
  return `${Math.floor(days / 30)} meses`;
}
