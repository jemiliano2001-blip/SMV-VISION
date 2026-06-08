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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Valida que (y, m, d) sea una fecha-calendario real (rechaza overflow como
 * 31/02) y devuelve los componentes. `m` es 1-12. Devuelve null si inválida.
 */
function validDateParts(y: number, m: number, d: number): { y: number; m: number; d: number } | null {
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  // Detectar overflow (ej. 31/02 → 03/03): los componentes deben coincidir.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return { y, m, d };
}

/**
 * Parsea una fecha en los formatos que puede traer el PDF (DD/MM/YYYY,
 * DD-MM-YYYY, YYYY-MM-DD) y devuelve un string de solo fecha `YYYY-MM-DD`,
 * o `null` si el formato no es reconocido.
 *
 * Construye el string directamente desde los componentes (sin `toISOString`)
 * para no introducir desfases por zona horaria: la fecha-calendario que se
 * leyó del PDF es la misma que se persiste.
 */
export function parseDateToISO(fecha: string): string | null {
  const s = fecha.trim();
  let parts: { y: number; m: number; d: number } | null = null;

  let match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) parts = validDateParts(Number(match[3]), Number(match[2]), Number(match[1]));

  if (!parts && (match = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) {
    parts = validDateParts(Number(match[3]), Number(match[2]), Number(match[1]));
  }
  if (!parts && (match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    parts = validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  return parts ? `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}` : null;
}

/**
 * Suma `days` días-calendario a una fecha `YYYY-MM-DD` y devuelve otra fecha
 * `YYYY-MM-DD`. Toda la aritmética se hace en UTC para que el resultado sea
 * determinista e independiente de la zona horaria del navegador.
 */
export function addDaysToISODate(isoDate: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split('T')[0];
}

/**
 * Días-calendario desde HOY (local) hasta `isoDate` (`YYYY-MM-DD`).
 *  > 0  faltan N días   · 0 vence hoy   · < 0 venció hace N días.
 * Compara medianoche local contra medianoche local (no instantes UTC), así
 * "vence hoy" significa hoy en el huso del usuario, sin desfases de ±1 día.
 * Devuelve `null` si el formato no es válido.
 */
export function daysUntilISODate(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Math.round absorbe los saltos de DST (días de 23/25h) sin desfasar.
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** Renderiza una cantidad de días en español compacto ("Hoy", "3 días", "5 sem", "2 meses"). */
export function formatAgeDays(days: number): string {
  if (days === 0) return 'Hoy';
  if (days === 1) return '1 día';
  return `${days} días`;
}

/**
 * Returns a short Spanish relative time string for a past date.
 * e.g. "hace 5 min", "hace 3h", "hace 2d"
 * Handles slight clock skew (future dates treated as "hace un momento").
 */
export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMin < 1) return 'hace un momento';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `hace ${diffD}d`;
}
