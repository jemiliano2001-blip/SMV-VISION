/**
 * functions/src/index.ts
 *
 * Cloud Functions de sincronización Odoo → Firestore. Reconstruido como
 * fuente TypeScript a partir del `lib/index.js` desplegado (el fuente
 * original no estaba en control de versiones). Comportamiento idéntico.
 *
 * Exports:
 *  - `syncSuprajitOrders`: programada cada 30 min (legado — la spec
 *    2026-06-11 movió el sync programado a la tarea de Windows
 *    "SMV Odoo Sync"; se conserva aquí por paridad con lo desplegado).
 *  - `triggerOdooSync`: callable (onCall) que dispara el sync bajo demanda
 *    desde el botón REFRESCAR de OdooOrdersPanel. Requiere usuario
 *    autenticado (request.auth) aunque el invoker sea público.
 *  - `analyzeGemini`: callable (onCall) que hace de proxy autenticado hacia
 *    Gemini — ver functions/src/gemini.ts. La API key vive solo en Secret
 *    Manager; el cliente ya no la trae en el bundle.
 *
 * Pipeline:
 *   1. search_read en sale.order (invoice_status in to invoice / upselling).
 *   2. Trae líneas (sale.order.line), remisiones (stock.picking) y sus
 *      movimientos (stock.move) en llamadas masivas.
 *   3. Calcula la cantidad pendiente por línea desde los traslados.
 *   4. Upsert de encabezados → colección `odooSaleOrders` (vista "Órdenes").
 *   5. Upsert de órdenes de trabajo → colección `workOrders` (badge de
 *      producción), deduplicadas por `SO::parte`, archivando las que ya
 *      no aplican.
 *   6. Escribe heartbeat + catálogo `partners` en `syncMeta/odoo`.
 *
 * Credenciales: ODOO_URL/ODOO_DB/ODOO_USER vienen de functions/.env;
 * ODOO_API_KEY es un secreto de Secret Manager (defineSecret).
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import Odoo = require("odoo-xmlrpc");
import {
  detectFieldsByLabel,
  htmlToText,
  odooText,
  resolveEngineer,
  resolvePo,
  type EngineerSource,
  type OdooFieldMeta,
  type PoSource,
} from "./odooFields";

if (getApps().length === 0) {
  initializeApp();
}

// La API Key de Odoo se guarda en Google Secret Manager, NO en .env.
const ODOO_API_KEY = defineSecret("ODOO_API_KEY");

const ODOO_COLLECTION = "odooSaleOrders";
const WORK_ORDERS_COLLECTION = "workOrders";
const SYNC_META_COLLECTION = "syncMeta";
const SYNC_META_DOC = "odoo";
const SYNC_SOURCE_UID = "syncSuprajitOrders-fn";
const BATCH_SIZE = 450;

/** Código de producto genérico de Odoo ("Servicio de maquinados"). */
const GENERIC_SERVICE_CODE = "73181000";

// ─────────────────────────────────────────────────────────────────────────────
//  Tipos
// ─────────────────────────────────────────────────────────────────────────────

interface OdooClient {
  connect(callback: (err: unknown) => void): void;
  execute_kw(
    model: string,
    method: string,
    params: unknown[],
    callback: (err: unknown, value: unknown) => void,
  ): void;
}

type OdooRow = Record<string, unknown>;

interface StockMoveLine {
  product: string;
  qty_demand: number;
  qty_done: number;
  state: string;
  sale_line_id: number | null;
}

interface Picking {
  id: number;
  origin: string;
  name: string;
  state: string;
  date_done: string | false;
  lines: StockMoveLine[];
}

interface OrderLine {
  id: number;
  product: string;
  description: string;
  qty: number;
  qty_delivered: number;
  qty_pending_from_pickings: number;
  /** "Nota de línea" (campo custom detectado por etiqueta); "" si no hay. */
  note: string;
}

interface SaleOrder {
  id: number;
  name: string;
  date_order: string | false;
  partner: string;
  /** PO resuelta (ver resolvePo). Conserva el nombre por compatibilidad con la app. */
  client_order_ref: string | null;
  po_source: PoSource | null;
  po_conflict: string | null;
  requisitor: string | null;
  /** Requisitor, o el ingeniero sacado de las notas si el campo viene vacío. */
  engineer: string | null;
  engineer_source: EngineerSource | null;
  supervisor: string | null;
  descripcion: string | null;
  partida: string | null;
  /** Fecha de entrega prometida al cliente (`commitment_date`). */
  commitment_date: string | null;
  /** `note` (Términos y condiciones) convertido de HTML a texto. */
  notes_text: string;
  invoice_status: string;
  state: string;
  order_lines: OrderLine[];
  deliveries: Picking[];
}

interface OdooConfig {
  url: string;
  db: string;
  username: string;
  password: string;
}

interface SyncPartnerSummary {
  key: string;
  name: string;
  toInvoiceCount: number;
}

interface SyncResult {
  ordersProcessed: number;
  headersWritten: number;
  created: number;
  updated: number;
  archived: number;
  partners: SyncPartnerSummary[];
}

/** Llave indexable del cliente (partner) para filtros en Firestore. */
function normalizePartnerKey(partner: string): string {
  return partner.trim().toUpperCase();
}

/** Toda orden pendiente de facturar en Odoo es activa para facturación (`toInvoice`). */
function isActiveToInvoiceOrder(order: SaleOrder): boolean {
  return (
    (order.invoice_status === "to invoice" ||
      order.invoice_status === "upselling") &&
    order.state !== "cancel"
  );
}

function buildPartnerSummaries(orders: SaleOrder[]): SyncPartnerSummary[] {
  const byKey = new Map<string, SyncPartnerSummary>();
  for (const order of orders) {
    if (!isActiveToInvoiceOrder(order)) continue;
    const key = normalizePartnerKey(order.partner);
    const existing = byKey.get(key);
    if (existing) {
      existing.toInvoiceCount += 1;
    } else {
      byKey.set(key, {
        key,
        name: order.partner.trim() || "Sin cliente",
        toInvoiceCount: 1,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Lógica pura de dedup (copiada de src/lib — la función es un paquete aparte)
// ─────────────────────────────────────────────────────────────────────────────

/** Normaliza una etiqueta de pieza (igual que src/lib/matching.ts). */
function normalizePieceLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\-/. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstLine(value: string | null | undefined): string {
  return (
    (value ?? "")
      .split(/[\r\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? ""
  );
}

/** Llave de dedup `SO::parte` (igual que src/lib/workOrders/dedupe.ts). */
function buildDedupeKey(input: {
  soNumber: string;
  poNumber: string;
  numeroParte: string;
  pieza: string;
}): string {
  const so = normalizePieceLabel(firstLine(input.soNumber));
  const po = normalizePieceLabel(firstLine(input.poNumber));
  const parte = normalizePieceLabel(input.numeroParte);
  const pieza = normalizePieceLabel(input.pieza);
  const orderKey = so || po || "SIN-ORDEN";
  const pieceKey = parte || pieza || "SIN-PIEZA";
  return `${orderKey}::${pieceKey}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers de parsing de respuestas Odoo
// ─────────────────────────────────────────────────────────────────────────────

/** Nombre de un campo many2one que Odoo devuelve como [id, "Nombre"] o false. */
function many2oneName(v: unknown): string {
  return Array.isArray(v) && v.length >= 2 ? String(v[1]) : "";
}

/** Id de un campo many2one que Odoo devuelve como [id, "Nombre"] o false. */
function many2oneId(v: unknown): number | null {
  return Array.isArray(v) && v.length >= 1 && typeof v[0] === "number" ?
    v[0] :
    null;
}

function numOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function strOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Devuelve true si la línea es un servicio genérico (no una pieza real). */
function isServiceLine(product: string): boolean {
  return /servicio/i.test(product);
}

/**
 * Extrae código de parte y nombre de pieza de un product name de Odoo.
 * "[CODE] Description" → { numeroParte: "CODE", pieza: "Description" }.
 */
function parseOdooProduct(product: string): { numeroParte: string; pieza: string } {
  const match = /^\[([^\]]+)\]\s*(.*)/.exec(product.trim());
  if (match) {
    return {
      numeroParte: match[1].trim(),
      pieza: match[2].trim() || product.trim(),
    };
  }
  return { numeroParte: "", pieza: product.trim() };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cliente Odoo (promisificado sobre la librería odoo-xmlrpc)
// ─────────────────────────────────────────────────────────────────────────────

function connectOdoo(odoo: OdooClient): Promise<void> {
  return new Promise((resolve, reject) => {
    odoo.connect((err) => {
      if (err) return reject(toError(err));
      resolve();
    });
  });
}

/**
 * Envuelve execute_kw en una promesa. Para search_read, `params` debe ser
 * `[[domain], {fields, limit, order}]`: la librería antepone
 * [db, uid, password, model, method] y hace spread de `params`.
 */
function executeKw<T>(
  odoo: OdooClient,
  model: string,
  method: string,
  params: unknown[],
): Promise<T> {
  return new Promise((resolve, reject) => {
    odoo.execute_kw(model, method, params, (err, value) => {
      if (err) return reject(toError(err));
      resolve(value as T);
    });
  });
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Consultas a Odoo
// ─────────────────────────────────────────────────────────────────────────────

/** Lee `fields_get` de un modelo; {} si falla (el sync sigue con campos por defecto). */
async function fetchFieldsMeta(
  odoo: OdooClient,
  model: string,
): Promise<Record<string, OdooFieldMeta>> {
  try {
    return await executeKw<Record<string, OdooFieldMeta>>(
      odoo,
      model,
      "fields_get",
      [[], { attributes: ["string", "type"] }],
    );
  } catch (e) {
    logger.warn(`[sync] fields_get en ${model} falló, usando campos por defecto`, e);
    return {};
  }
}

/**
 * Campos de sale.order que leemos. Nombres confirmados en el Odoo de SMV con
 * modo debug (2026-09-24):
 *   origin          → "Orden de compra" (la PO del cliente vive AQUÍ;
 *                     client_order_ref = "Referencia del cliente", casi siempre vacío)
 *   requisitor, supervisor, descripcion, partida → char custom
 *   commitment_date → "Fecha de entrega"
 *   note            → "Términos y condiciones" (html; ahí escriben ingeniero / OC)
 */
const SALE_ORDER_FIELDS = [
  "name",
  "date_order",
  "partner_id",
  "invoice_status",
  "state",
  "origin",
  "client_order_ref",
  "note",
  "commitment_date",
  "requisitor",
  "supervisor",
  "descripcion",
  "partida",
];

/** Tope de la nota guardada en Firestore (evita documentos gigantes). */
const NOTES_MAX_CHARS = 2000;

function datetimeOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

async function fetchSaleOrders(odoo: OdooClient): Promise<SaleOrder[]> {
  const meta = await fetchFieldsMeta(odoo, "sale.order");
  const hasMeta = Object.keys(meta).length > 0;

  // Si algún día crean en Studio un campo etiquetado "Orden de compra", tiene
  // prioridad sobre origin. origin/client_order_ref se leen explícitamente.
  const customPoFields = hasMeta ?
    detectFieldsByLabel(meta, [
      "orden de compra",
      "orden compra",
      "purchase order",
      "orden de trabajo cliente",
    ]).filter((f) => f !== "origin" && f !== "client_order_ref") :
    [];

  if (hasMeta) {
    const missing = SALE_ORDER_FIELDS.filter((f) => !(f in meta));
    if (missing.length > 0) {
      logger.warn(`[sync] sale.order no tiene los campos: ${missing.join(", ")}`);
    }
  }
  // Un campo inexistente tumba el search_read completo: con metadatos pedimos
  // solo los que existen; sin ellos, la lista confirmada.
  const fields = hasMeta ?
    [...SALE_ORDER_FIELDS.filter((f) => f in meta), ...customPoFields] :
    SALE_ORDER_FIELDS;

  const domain = [
    ["invoice_status", "in", ["to invoice", "upselling"]],
  ];

  const rows = await executeKw<OdooRow[]>(
    odoo,
    "sale.order",
    "search_read",
    [[domain], { fields, limit: 0, order: "date_order desc" }],
  );

  let poFromNote = 0;
  let poConflicts = 0;
  const orders = rows.map((row): SaleOrder => {
    const name = strOf(row["name"]);
    const notesText = htmlToText(odooText(row["note"])).slice(0, NOTES_MAX_CHARS);
    const requisitor = odooText(row["requisitor"]) || null;
    const po = resolvePo({
      orderName: name,
      customFieldValues: customPoFields.map((f) => odooText(row[f])),
      origin: odooText(row["origin"]),
      clientOrderRef: odooText(row["client_order_ref"]),
      noteText: notesText,
    });
    if (po.source === "note") poFromNote++;
    if (po.conflict) poConflicts++;
    // Las notas de línea todavía no se leen aquí: runSync completa el
    // ingeniero con ellas si el encabezado no trae nada.
    const engineer = resolveEngineer({
      fieldValues: requisitor ? [requisitor] : [],
      noteText: notesText,
    });
    return {
      id: numOf(row["id"]),
      name,
      date_order: typeof row["date_order"] === "string" ?
        row["date_order"] :
        false,
      partner: many2oneName(row["partner_id"]) || "Sin cliente",
      client_order_ref: po.value,
      po_source: po.source,
      po_conflict: po.conflict,
      requisitor,
      engineer: engineer.value,
      engineer_source: engineer.source,
      supervisor: odooText(row["supervisor"]) || null,
      descripcion: odooText(row["descripcion"]) || null,
      partida: odooText(row["partida"]) || null,
      commitment_date: datetimeOrNull(row["commitment_date"]),
      notes_text: notesText,
      invoice_status: strOf(row["invoice_status"]) || "no",
      state: strOf(row["state"]) || "unknown",
      order_lines: [],
      deliveries: [],
    };
  });

  const withPo = orders.filter((o) => o.client_order_ref).length;
  logger.info(
    `[sync] PO resuelta en ${withPo}/${orders.length} órdenes ` +
    `(desde nota: ${poFromNote}, nota≠campo: ${poConflicts})`,
  );
  return orders;
}

async function fetchOrderLines(
  odoo: OdooClient,
  orderIds: number[],
): Promise<Map<number, OrderLine[]>> {
  const map = new Map<number, OrderLine[]>();
  if (orderIds.length === 0) return map;

  // "Nota de línea" es un campo custom cuyo nombre técnico aún no confirmamos:
  // se detecta por etiqueta. Si no aparece, las líneas quedan con note "".
  const lineMeta = await fetchFieldsMeta(odoo, "sale.order.line");
  const noteFields = detectFieldsByLabel(lineMeta, ["nota de linea", "nota linea"]);
  logger.info(
    `[sync] notas de línea: ${noteFields.length > 0 ? noteFields.join(", ") : "ningún campo detectado"}`,
  );

  const CHUNK = 100;
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const domain = [["order_id", "in", chunk]];
    const fields = [
      "order_id",
      "product_id",
      "name",
      "product_uom_qty",
      "qty_delivered",
      ...noteFields,
    ];
    const rows = await executeKw<OdooRow[]>(
      odoo,
      "sale.order.line",
      "search_read",
      [[domain], { fields, limit: 0, order: "order_id asc, id asc" }],
    );
    for (const row of rows) {
      const orderId = many2oneId(row["order_id"]);
      if (orderId === null) continue;
      const line: OrderLine = {
        id: numOf(row["id"]),
        product: many2oneName(row["product_id"]) || "Sin producto",
        description: strOf(row["name"]),
        qty: numOf(row["product_uom_qty"]),
        qty_delivered: numOf(row["qty_delivered"]),
        qty_pending_from_pickings: 0,
        note: noteFields
          .map((f) => {
            const text = odooText(row[f]);
            return lineMeta[f]?.type === "html" ? htmlToText(text) : text;
          })
          .filter(Boolean)
          .join("\n"),
      };
      const arr = map.get(orderId);
      if (arr) arr.push(line);
      else map.set(orderId, [line]);
    }
  }
  return map;
}

async function fetchPickings(
  odoo: OdooClient,
  orderNames: string[],
): Promise<Map<string, Picking[]>> {
  const map = new Map<string, Picking[]>();
  if (orderNames.length === 0) return map;

  const CHUNK = 100;
  for (let i = 0; i < orderNames.length; i += CHUNK) {
    const chunk = orderNames.slice(i, i + CHUNK);
    const domain = [["origin", "in", chunk]];
    const fields = ["id", "name", "origin", "state", "date_done"];
    const rows = await executeKw<OdooRow[]>(
      odoo,
      "stock.picking",
      "search_read",
      [[domain], { fields, limit: 0, order: "id asc" }],
    );
    for (const row of rows) {
      const origin = strOf(row["origin"]);
      if (!origin) continue;
      const picking: Picking = {
        id: numOf(row["id"]),
        origin,
        name: strOf(row["name"]),
        state: strOf(row["state"]) || "unknown",
        date_done: typeof row["date_done"] === "string" ?
          row["date_done"] :
          false,
        lines: [],
      };
      const arr = map.get(origin);
      if (arr) arr.push(picking);
      else map.set(origin, [picking]);
    }
  }
  return map;
}

async function fetchStockMoves(
  odoo: OdooClient,
  pickingIds: number[],
): Promise<Map<number, StockMoveLine[]>> {
  const map = new Map<number, StockMoveLine[]>();
  if (pickingIds.length === 0) return map;

  const CHUNK = 100;
  for (let i = 0; i < pickingIds.length; i += CHUNK) {
    const chunk = pickingIds.slice(i, i + CHUNK);
    const domain = [["picking_id", "in", chunk]];
    const fields = [
      "id",
      "picking_id",
      "product_id",
      "product_uom_qty",
      "quantity_done",
      "state",
      "sale_line_id",
    ];
    const rows = await executeKw<OdooRow[]>(
      odoo,
      "stock.move",
      "search_read",
      [[domain], { fields, limit: 0, order: "picking_id asc, id asc" }],
    );
    for (const row of rows) {
      const pickingId = many2oneId(row["picking_id"]);
      if (pickingId === null) continue;
      const move: StockMoveLine = {
        product: many2oneName(row["product_id"]) || "Sin producto",
        qty_demand: numOf(row["product_uom_qty"]),
        qty_done: numOf(row["quantity_done"]),
        state: strOf(row["state"]) || "unknown",
        sale_line_id: many2oneId(row["sale_line_id"]),
      };
      const arr = map.get(pickingId);
      if (arr) arr.push(move);
      else map.set(pickingId, [move]);
    }
  }
  return map;
}

/**
 * Calcula `qty_pending_from_pickings` por línea (misma lógica que el script):
 * sin remisiones → toda la cantidad está pendiente; con remisiones → suma la
 * cantidad demandada de los traslados que NO estén 'done' ni 'cancel'.
 */
function computePendingQuantities(order: SaleOrder): void {
  for (const line of order.order_lines) {
    if (order.deliveries.length === 0) {
      line.qty_pending_from_pickings = line.qty;
      continue;
    }
    let pending = 0;
    for (const delivery of order.deliveries) {
      for (const move of delivery.lines) {
        if (
          move.sale_line_id === line.id &&
          move.state !== "done" &&
          move.state !== "cancel"
        ) {
          pending += move.qty_demand;
        }
      }
    }
    line.qty_pending_from_pickings = pending;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Upsert → odooSaleOrders (encabezados; vista "Órdenes")
// ─────────────────────────────────────────────────────────────────────────────

async function upsertSaleOrders(db: Firestore, orders: SaleOrder[]): Promise<number> {
  const activeDocIds = new Set(orders.map((o) => o.name.replace(/\//g, "_")));

  // 1. Desactivar en Firestore órdenes que ya fueron facturadas o canceladas en Odoo
  const existingActiveDocs = await db
    .collection(ODOO_COLLECTION)
    .where("toInvoice", "==", true)
    .get();

  const toDeactivate = existingActiveDocs.docs.filter((d) => !activeDocIds.has(d.id));
  for (let i = 0; i < toDeactivate.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of toDeactivate.slice(i, i + BATCH_SIZE)) {
      batch.update(doc.ref, {
        toInvoice: false,
        updatedAtUTC: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  // 2. Guardar o actualizar las órdenes activas
  let written = 0;
  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const order of orders.slice(i, i + BATCH_SIZE)) {
      // Firestore no permite '/' en IDs → "2026/S00288" se vuelve "2026_S00288".
      const docId = order.name.replace(/\//g, "_");

      const isActiveOrder = isActiveToInvoiceOrder(order);

      const payload = {
        name: order.name,
        date_order: order.date_order !== false ? order.date_order : null,
        partner: order.partner,
        partnerKey: normalizePartnerKey(order.partner),
        client_order_ref: order.client_order_ref,
        poSource: order.po_source,
        poConflict: order.po_conflict,
        requisitor: order.requisitor,
        engineer: order.engineer,
        engineerSource: order.engineer_source,
        supervisor: order.supervisor,
        descripcion: order.descripcion,
        partida: order.partida,
        commitment_date: order.commitment_date,
        notes_text: order.notes_text,
        invoice_status: order.invoice_status,
        state: order.state,
        toInvoice: isActiveOrder,
        order_lines: order.order_lines.map((l) => {
          const productDisplay = isServiceLine(l.product) ?
            l.description || l.product :
            l.product;
          return {
            id: l.id,
            product: productDisplay,
            description: l.description !== productDisplay ? l.description : "",
            qty: l.qty,
            qty_delivered: l.qty_delivered,
            qty_pending_from_pickings: l.qty_pending_from_pickings,
            note: l.note,
          };
        }),
        deliveries: order.deliveries.map((d) => ({
          name: d.name,
          state: d.state,
          date_done: d.date_done,
          lines: d.lines.map((l) => ({
            product: l.product,
            qty_demand: l.qty_demand,
            qty_done: l.qty_done,
            state: l.state,
            sale_line_id: l.sale_line_id,
          })),
        })),
        syncedAtUTC: FieldValue.serverTimestamp(),
        syncedBy: SYNC_SOURCE_UID,
        // No exponemos precios: limpia amount_total de documentos anteriores.
        amount_total: FieldValue.delete(),
      };

      batch.set(db.collection(ODOO_COLLECTION).doc(docId), payload, {
        merge: true,
      });
      written++;
    }
    await batch.commit();
  }
  return written;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Upsert → workOrders (badge de producción; dedup `SO::parte`)
// ─────────────────────────────────────────────────────────────────────────────

async function upsertWorkOrders(
  db: Firestore,
  orders: SaleOrder[],
): Promise<{ created: number; updated: number; archived: number }> {
  // Solo las órdenes que Odoo marca como 'A facturar'.
  const pendingOrders = orders.filter(
    (o) => o.invoice_status === "to invoice" || o.invoice_status === "upselling",
  );
  if (pendingOrders.length === 0) {
    return { created: 0, updated: 0, archived: 0 };
  }

  const toInvoiceSoSet = new Set(pendingOrders.map((o) => o.name));

  // 1. Llaves de dedup válidas (líneas con cantidad pendiente > 0).
  const validDedupeKeys = new Set<string>();
  for (const order of pendingOrders) {
    for (const line of order.order_lines) {
      if (line.qty_pending_from_pickings <= 0) continue;
      const effectiveProduct = isServiceLine(line.product) ?
        line.description || line.product :
        line.product;
      if (!effectiveProduct.trim()) continue;
      const { numeroParte, pieza } = parseOdooProduct(effectiveProduct);
      validDedupeKeys.add(
        buildDedupeKey({
          soNumber: order.name,
          poNumber: order.client_order_ref || "",
          numeroParte,
          pieza,
        }),
      );
    }
  }

  // 2. Archivar OTs de Odoo que ya no aplican (SO facturado, genérico, o
  //    línea ya entregada al 100%).
  const odooOts = await db
    .collection(WORK_ORDERS_COLLECTION)
    .where("odooSource", "==", true)
    .where("archived", "==", false)
    .get();

  const toArchive = odooOts.docs.filter((d) => {
    const raw = d.data();
    const so = typeof raw["soNumber"] === "string" ? raw["soNumber"] : "";
    const numeroParte = typeof raw["numeroParte"] === "string" ? raw["numeroParte"] : "";
    const pieza = typeof raw["pieza"] === "string" ? raw["pieza"] : "";
    const poNumber = typeof raw["poNumber"] === "string" ? raw["poNumber"] : "";
    if (so && !toInvoiceSoSet.has(so)) return true;
    if (numeroParte === GENERIC_SERVICE_CODE) return true;
    const key = buildDedupeKey({ soNumber: so, poNumber, numeroParte, pieza });
    return !validDedupeKeys.has(key);
  });

  let archived = 0;
  for (let i = 0; i < toArchive.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of toArchive.slice(i, i + BATCH_SIZE)) {
      batch.update(doc.ref, {
        archived: true,
        updatedAtUTC: FieldValue.serverTimestamp(),
      });
      archived++;
    }
    await batch.commit();
  }

  // 3. Buscar OTs existentes (no archivadas) por soNumber (chunks de 30).
  const soNumbers = [...toInvoiceSoSet];
  const existingByKey = new Map<string, string>(); // dedupeKey → docId
  const CHUNK = 30;
  for (let i = 0; i < soNumbers.length; i += CHUNK) {
    const chunk = soNumbers.slice(i, i + CHUNK);
    const snap = await db
      .collection(WORK_ORDERS_COLLECTION)
      .where("soNumber", "in", chunk)
      .where("archived", "==", false)
      .get();
    for (const d of snap.docs) {
      const raw = d.data();
      const key = buildDedupeKey({
        soNumber: typeof raw["soNumber"] === "string" ? raw["soNumber"] : "",
        poNumber: typeof raw["poNumber"] === "string" ? raw["poNumber"] : "",
        numeroParte: typeof raw["numeroParte"] === "string" ? raw["numeroParte"] : "",
        pieza: typeof raw["pieza"] === "string" ? raw["pieza"] : "",
      });
      existingByKey.set(key, d.id);
    }
  }

  // 4. Construir create/update por cada línea pendiente.
  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: { id: string; payload: Record<string, unknown> }[] = [];
  const seenKeys = new Set<string>();

  for (const order of pendingOrders) {
    const odooOrderId = order.name.replace(/\//g, "_");
    const otDate = order.date_order !== false ? order.date_order.split(" ")[0] : "";
    for (const line of order.order_lines) {
      if (line.qty_pending_from_pickings <= 0) continue;
      const effectiveProduct = isServiceLine(line.product) ?
        line.description || line.product :
        line.product;
      if (!effectiveProduct.trim()) continue;
      const { numeroParte, pieza } = parseOdooProduct(effectiveProduct);
      const key = buildDedupeKey({
        soNumber: order.name,
        poNumber: order.client_order_ref || "",
        numeroParte,
        pieza,
      });
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const existingId = existingByKey.get(key);
      if (existingId) {
        toUpdate.push({
          id: existingId,
          payload: {
            cantidad: String(line.qty_pending_from_pickings),
            // Corrige OTs creadas cuando la PO se leía del campo equivocado.
            // Solo si Odoo trae PO: nunca borramos una que ya estaba.
            ...(order.client_order_ref ? { poNumber: order.client_order_ref } : {}),
            odooSource: true,
            odooOrderId,
            updatedAtUTC: FieldValue.serverTimestamp(),
          },
        });
      } else {
        toCreate.push({
          poNumber: order.client_order_ref ?? "",
          soNumber: order.name,
          otDate,
          customer: order.partner,
          pieza,
          numeroParte,
          cantidad: String(line.qty_pending_from_pickings),
          prioridad: "Normal",
          status: "pendiente",
          matchedPartId: null,
          matchedDrawingId: null,
          matchScore: null,
          deliveredToTornero: null,
          deliveredAtUTC: null,
          deliveredByUid: null,
          dueDate: null,
          assignedToTornero: null,
          assignedAtUTC: null,
          finishedAtUTC: null,
          notes: "",
          sourcePdfName: "odoo-sync",
          archived: false,
          odooSource: true,
          odooOrderId,
          createdAtUTC: FieldValue.serverTimestamp(),
          updatedAtUTC: FieldValue.serverTimestamp(),
        });
      }
    }
  }

  // 5. Ejecutar create/update en lotes.
  type BatchOp =
    | { type: "create"; payload: Record<string, unknown> }
    | { type: "update"; op: { id: string; payload: Record<string, unknown> } };
  const allOps: BatchOp[] = [
    ...toCreate.map((payload): BatchOp => ({ type: "create", payload })),
    ...toUpdate.map((op): BatchOp => ({ type: "update", op })),
  ];

  let created = 0;
  let updated = 0;
  for (let i = 0; i < allOps.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const item of allOps.slice(i, i + BATCH_SIZE)) {
      if (item.type === "create") {
        batch.set(db.collection(WORK_ORDERS_COLLECTION).doc(), item.payload);
        created++;
      } else {
        batch.update(
          db.collection(WORK_ORDERS_COLLECTION).doc(item.op.id),
          item.op.payload,
        );
        updated++;
      }
    }
    await batch.commit();
  }

  return { created, updated, archived };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Heartbeat → syncMeta/odoo
// ─────────────────────────────────────────────────────────────────────────────

async function writeSyncMeta(
  db: Firestore,
  data: Record<string, unknown>,
): Promise<void> {
  const docRef = db.collection(SYNC_META_COLLECTION).doc(SYNC_META_DOC);
  const now = FieldValue.serverTimestamp();

  if (data.status === "ok") {
    await docRef
      .set(
        {
          lastSyncAt: now,
          lastSuccessfulSyncAt: now,
          ...data,
        },
        { merge: true },
      )
      .catch(() => {
        /* nunca tronar dentro del manejador de estado */
      });
  } else {
    // Protección contra pérdida de datos: ante fallas de conexión o errores transitorios,
    // NO vaciamos partners ni ordersProcessed previamente sincronizados.
    const { partners: _p, ordersProcessed: _o, ...safeData } = data;
    await docRef
      .set(
        {
          lastSyncAt: now,
          ...safeData,
        },
        { merge: true },
      )
      .catch(() => {
        /* nunca tronar dentro del manejador de estado */
      });
  }
}

/**
 * Ejecuta el ciclo completo: conecta a Odoo, trae órdenes/líneas/remisiones,
 * calcula pendientes y escribe `odooSaleOrders` + `workOrders`. No toca
 * `syncMeta` (eso lo maneja quien la invoca) ni captura errores: los propaga.
 */
export async function runSync(db: Firestore, cfg: OdooConfig): Promise<SyncResult> {
  const odoo: OdooClient = new Odoo({
    url: cfg.url.replace(/\/$/, ""),
    db: cfg.db,
    username: cfg.username,
    password: cfg.password,
  });

  await connectOdoo(odoo);
  logger.info("✅ Conexión a Odoo exitosa.");

  // 1. Encabezados de órdenes pendientes de factura (todas las compañías).
  const orders = await fetchSaleOrders(odoo);
  logger.info(`🔍 ${orders.length} órdenes pendientes de factura encontradas.`);
  if (orders.length === 0) {
    return {
      ordersProcessed: 0,
      headersWritten: 0,
      created: 0,
      updated: 0,
      archived: 0,
      partners: [],
    };
  }

  // 2. Líneas, remisiones y movimientos en llamadas masivas fragmentadas.
  const linesMap = await fetchOrderLines(odoo, orders.map((o) => o.id));
  const pickingsMap = await fetchPickings(odoo, orders.map((o) => o.name));
  const allPickingIds: number[] = [];
  for (const pickings of pickingsMap.values()) {
    for (const p of pickings) allPickingIds.push(p.id);
  }
  const movesMap = await fetchStockMoves(odoo, allPickingIds);

  // 3. Ensamblar y calcular cantidades pendientes.
  for (const pickings of pickingsMap.values()) {
    for (const p of pickings) p.lines = movesMap.get(p.id) ?? [];
  }
  for (const order of orders) {
    order.order_lines = linesMap.get(order.id) ?? [];
    order.deliveries = pickingsMap.get(order.name) ?? [];
    computePendingQuantities(order);
    if (!order.engineer) {
      const fromLines = resolveEngineer({ lineNotes: order.order_lines.map((l) => l.note) });
      order.engineer = fromLines.value;
      order.engineer_source = fromLines.source;
    }
  }

  // 4 + 5. Escribir encabezados y órdenes de trabajo.
  const headersWritten = await upsertSaleOrders(db, orders);
  const wo = await upsertWorkOrders(db, orders);
  const partners = buildPartnerSummaries(orders);

  logger.info(
    `🚀 Sync OK — odooSaleOrders: ${headersWritten} | ` +
    `compañías con pendientes: ${partners.length} | ` +
    `OTs creadas: ${wo.created}, actualizadas: ${wo.updated}, ` +
    `archivadas: ${wo.archived}`,
  );

  return { ordersProcessed: orders.length, headersWritten, partners, ...wo };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Función programada
// ─────────────────────────────────────────────────────────────────────────────

export const syncSuprajitOrders = onSchedule(
  {
    schedule: "every 30 minutes",
    timeoutSeconds: 300,
    retryCount: 0,
    memory: "512MiB",
    secrets: [ODOO_API_KEY],
  },
  async () => {
    const db = getFirestore();
    try {
      const url = process.env.ODOO_URL ? process.env.ODOO_URL.trim() : "";
      const database = process.env.ODOO_DB ? process.env.ODOO_DB.trim() : "";
      const username = process.env.ODOO_USER ? process.env.ODOO_USER.trim() : "";
      const password = ODOO_API_KEY.value() ? ODOO_API_KEY.value().trim() : "";
      if (!url || !database || !username || !password) {
        throw new Error("Faltan variables de entorno de Odoo (.env / secret).");
      }

      const r = await runSync(db, { url, db: database, username, password });
      await writeSyncMeta(db, {
        ordersProcessed: r.ordersProcessed,
        status: "ok",
        otsCreated: r.created,
        otsUpdated: r.updated,
        otsArchived: r.archived,
        partners: r.partners,
      });
    } catch (error) {
      logger.error("❌ Error crítico sincronizando con Odoo:", error);
      await writeSyncMeta(db, {
        status: "error",
        errorMessage: String(error),
      });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
//  Función callable (botón REFRESCAR de OdooOrdersPanel)
// ─────────────────────────────────────────────────────────────────────────────

export const triggerOdooSync = onCall(
  {
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [ODOO_API_KEY],
    invoker: "public",
  },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Debe estar autenticado para sincronizar Odoo.",
      );
    }

    const db = getFirestore();
    try {
      const url = process.env.ODOO_URL ? process.env.ODOO_URL.trim() : "";
      const database = process.env.ODOO_DB ? process.env.ODOO_DB.trim() : "";
      const username = process.env.ODOO_USER ? process.env.ODOO_USER.trim() : "";
      const password = ODOO_API_KEY.value() ? ODOO_API_KEY.value().trim() : "";
      if (!url || !database || !username || !password) {
        throw new Error("Faltan variables de entorno de Odoo (.env / secret).");
      }

      const r = await runSync(db, { url, db: database, username, password });
      await writeSyncMeta(db, {
        ordersProcessed: r.ordersProcessed,
        status: "ok",
        otsCreated: r.created,
        otsUpdated: r.updated,
        otsArchived: r.archived,
        partners: r.partners,
      });

      return { ok: true, ...r };
    } catch (error) {
      logger.error("❌ Error en triggerOdooSync:", error);
      await writeSyncMeta(db, {
        status: "error",
        errorMessage: String(error),
      });
      return { ok: false, error: String(error) };
    }
  },
);

// Proxy autenticado hacia Gemini — ver functions/src/gemini.ts.
export { analyzeGemini } from "./gemini";
