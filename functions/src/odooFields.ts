/**
 * functions/src/odooFields.ts
 *
 * Lógica pura para interpretar campos de `sale.order` de Odoo 15: de dónde
 * sale la Orden de Compra (PO) del cliente y quién es el ingeniero/requisitor.
 * Sin dependencias de Firebase para poder probarla con Vitest desde la raíz
 * (`src/lib/__tests__/odooFields.test.ts`).
 *
 * Contexto: en el Odoo de SMV la PO se captura en el campo estándar `origin`
 * (la vista lo reetiqueta "Orden de compra"), no en `client_order_ref`
 * ("Referencia del cliente"). A veces también viene escrita en la nota
 * ("Orden de compra: 00089314"), igual que el nombre del ingeniero.
 */

export type PoSource = "custom_field" | "origin" | "client_order_ref" | "note";
export type EngineerSource = "field" | "note" | "line_note";

export interface OdooFieldMeta {
  string?: string;
  type?: string;
}

export interface ResolvedPo {
  /** PO resuelta, o null si ninguna fuente trae una válida. */
  value: string | null;
  source: PoSource | null;
  /**
   * PO escrita en la nota cuando NO coincide con la del campo — casi siempre
   * un error de captura. Null si no hay nota con PO o si coinciden.
   */
  conflict: string | null;
}

export interface ResolvedEngineer {
  value: string | null;
  source: EngineerSource | null;
}

/** Valores que la gente captura en el campo de PO cuando todavía no la tiene. */
const PLACEHOLDER_PO = new Set([
  "PENDIENTE",
  "FALTA OC",
  "FALTA PO",
  "SIN OC",
  "SIN PO",
  "S/N",
  "SN",
  "N/A",
  "NA",
  "NO",
  "0",
]);

/** Texto de un valor de Odoo: string, número o many2one `[id, "Nombre"]`. `false` → "". */
export function odooText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (Array.isArray(v) && v.length >= 2 && typeof v[1] === "string") return v[1].trim();
  return "";
}

/** Convierte el HTML de un campo `Html` de Odoo (p. ej. `note`) a texto plano por líneas. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&(#39|apos);/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    // &amp; al final para no decodificar dos veces ("&amp;lt;" → "&lt;").
    .replace(/&amp;/gi, "&")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Normaliza una etiqueta de campo para compararla: minúsculas y sin acentos. */
function normalizeLabel(label: string): string {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Nombres de campos cuya etiqueta (`string` de fields_get) contiene alguna de
 * las palabras clave. Sirve para campos de Studio (`x_studio_*`), cuya
 * etiqueta es la que se tecleó al crearlos.
 */
export function detectFieldsByLabel(
  meta: Record<string, OdooFieldMeta>,
  keywords: string[],
  types: string[] = ["char", "text", "html"],
): string[] {
  const wanted = keywords.map(normalizeLabel);
  return Object.entries(meta)
    .filter(([, m]) => !m.type || types.includes(m.type))
    .filter(([, m]) => {
      const label = normalizeLabel(m.string ?? "");
      return wanted.some((k) => label.includes(k));
    })
    .map(([name]) => name);
}

export function isPlaceholderPo(value: string): boolean {
  const v = value.trim().toUpperCase().replace(/[.\s]+$/, "");
  return v === "" || PLACEHOLDER_PO.has(v) || !/[A-Z0-9]/.test(v);
}

/**
 * `origin` también lo llena Odoo solo (p. ej. al duplicar/derivar documentos):
 * descartamos lo que parezca referencia interna y no PO del cliente.
 */
function looksLikeInternalRef(value: string, orderName: string): boolean {
  const v = value.trim().toUpperCase();
  return (
    v === orderName.trim().toUpperCase() ||
    /^\d{4}\/S\d+$/.test(v) ||
    /^S\d{4,}$/.test(v) ||
    /\bWH\//.test(v)
  );
}

/** Quita un prefijo tipo "OC:", "PO #", "Orden de compra -" de un valor de PO. */
function stripPoLabel(value: string): string {
  return value
    .trim()
    .replace(/^(?:orden\s+de\s+compra|o\.?\s*c\.?|p\.?\s*o\.?)(?:\s*[:#-]\s*|\s+)(?=\S*\d)/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Llave de comparación: "00089314" y "89314" son la misma PO. */
function poCompareKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
}

/**
 * Busca una PO escrita en texto libre ("Orden de compra: 00089314",
 * "OC 4500123", "P.O. #778-1"). El valor debe traer al menos un dígito.
 */
export function extractPoFromText(text: string): string | null {
  const re =
    /(?:^|[^A-Za-z0-9])(?:orden\s+de\s+compra|o\.\s?c\.?|oc|p\.\s?o\.?|po)(?![A-Za-z])\s*(?:#|no\.|n[°º]\.?)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]*)/gi;
  for (const m of text.matchAll(re)) {
    const candidate = m[1].replace(/[-/]+$/, "");
    if (candidate.length >= 3 && /\d/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Resuelve la PO con prioridad fija:
 *   campo custom etiquetado "orden de compra" → `origin` → `client_order_ref` → nota.
 */
export function resolvePo(input: {
  orderName: string;
  customFieldValues?: string[];
  origin?: string;
  clientOrderRef?: string;
  noteText?: string;
}): ResolvedPo {
  const candidates: { value: string; source: PoSource }[] = [
    ...(input.customFieldValues ?? []).map((value) => ({ value, source: "custom_field" as const })),
    { value: input.origin ?? "", source: "origin" },
    { value: input.clientOrderRef ?? "", source: "client_order_ref" },
  ];

  let value: string | null = null;
  let source: PoSource | null = null;
  for (const c of candidates) {
    const cleaned = stripPoLabel(c.value);
    if (isPlaceholderPo(cleaned)) continue;
    if (c.source === "origin" && looksLikeInternalRef(cleaned, input.orderName)) continue;
    value = cleaned;
    source = c.source;
    break;
  }

  const fromNote = input.noteText ? extractPoFromText(input.noteText) : null;
  if (!value && fromNote) {
    return { value: fromNote, source: "note", conflict: null };
  }
  const conflict =
    value && fromNote && poCompareKey(value) !== poCompareKey(fromNote) ? fromNote : null;
  return { value, source, conflict };
}

const NAME_WORD = /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü'.-]*$/;
const NAME_CONNECTORS = new Set(["de", "del", "la", "las", "los", "y"]);
const ENGINEER_LABEL =
  /(?:^|[^A-Za-zÁÉÍÓÚÑáéíóúñ])(ingeniero|ing\.|ing(?=\s)|requisitor|solicitante|solicitado\s+por|atn\.?|atenci[oó]n(?:\s+a)?)\s*[:-]?\s*(.+)$/i;

function titleCase(word: string): string {
  const lower = word.toLocaleLowerCase("es");
  return NAME_CONNECTORS.has(lower) ? lower : lower.charAt(0).toLocaleUpperCase("es") + lower.slice(1);
}

/** Toma hasta 4 palabras de nombre al inicio de `rest` y las normaliza a "Nombre Apellido". */
function takeName(rest: string): string | null {
  const words: string[] = [];
  const tokens = rest.replace(/^(?:ing\.?|ingeniero)\s+/i, "").split(/\s+/);
  for (const token of tokens) {
    // Un separador pegado al final ("Pérez,") cierra el nombre.
    const closes = /[,;|()]$/.test(token);
    const word = token.replace(/[,;|()]+$/, "").replace(/\.$/, "");
    if (!NAME_WORD.test(word)) break;
    words.push(word);
    if (closes || words.length === 4) break;
  }
  while (words.length > 0 && NAME_CONNECTORS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  if (words.length === 0 || words.join("").length < 3) return null;
  return words.map(titleCase).join(" ");
}

/** Palabras de taller que nunca forman parte de un nombre ("TOOL CRIB", "Pendiente"). */
const NOT_NAME_WORDS = new Set([
  "pendiente", "urgente", "tool", "crib", "servicio", "servicios", "maquinado",
  "maquinados", "entrega", "orden", "compra", "cotizacion", "cotización",
  "suprajit", "material", "plano", "planos", "pieza", "piezas", "falta",
  "oc", "po", "req", "nota", "notas", "reparacion", "reparación", "tooling",
]);

/**
 * Línea que es SOLO un nombre de persona ("Miguel Santillan", "MARIA DE LA LUZ"):
 * 2–4 palabras capitalizadas (conectores de/la/del en minúscula), sin dígitos
 * ni palabras de taller. Así escriben en SMV al ingeniero en la nota.
 */
function bareNameLine(line: string): string | null {
  const words = line.trim().replace(/[.,;]+$/, "").split(/\s+/);
  const nameWords = words.filter((w) => !NAME_CONNECTORS.has(w.toLowerCase()));
  if (nameWords.length < 2 || words.length > 5) return null;
  for (const w of words) {
    if (!NAME_WORD.test(w)) return null;
    if (NOT_NAME_WORDS.has(w.toLocaleLowerCase("es"))) return null;
  }
  if (!nameWords.every((w) => /^[A-ZÁÉÍÓÚÑÜ]/.test(w))) return null;
  return words.map(titleCase).join(" ");
}

/**
 * Primer nombre de ingeniero/requisitor escrito en texto libre, o null.
 * Primero busca etiquetas ("Ing.", "Requisitor:"); si no hay, acepta una
 * línea que sea solo un nombre.
 */
export function extractEngineerFromText(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = ENGINEER_LABEL.exec(line);
    if (!m) continue;
    const name = takeName(m[2]);
    if (name) return name;
  }
  for (const line of lines) {
    const name = bareNameLine(line);
    if (name) return name;
  }
  return null;
}

/**
 * Ingeniero de la orden: campo dedicado → nota del encabezado → notas de línea.
 * El `requisitor` de Odoo se conserva aparte; esto solo cubre cuando viene vacío.
 */
export function resolveEngineer(input: {
  fieldValues?: string[];
  noteText?: string;
  lineNotes?: string[];
}): ResolvedEngineer {
  for (const v of input.fieldValues ?? []) {
    const name = takeName(v.trim()) ?? (v.trim() || null);
    if (name) return { value: name, source: "field" };
  }
  const fromNote = input.noteText ? extractEngineerFromText(input.noteText) : null;
  if (fromNote) return { value: fromNote, source: "note" };
  for (const note of input.lineNotes ?? []) {
    const fromLine = extractEngineerFromText(note);
    if (fromLine) return { value: fromLine, source: "line_note" };
  }
  return { value: null, source: null };
}
