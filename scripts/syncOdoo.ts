/**
 * scripts/syncOdoo.ts
 *
 * Sincronización Odoo 15 → Firestore (colección `odooSaleOrders`).
 *
 * Realiza un search_read en el modelo `sale.order` de Odoo vía JSON-RPC,
 * filtrando órdenes cuyo cliente (partner_id) contenga 'SUPRAJIT', y hace
 * upsert en Firestore usando el campo `name` (número de orden) como doc ID.
 *
 * Uso:
 *   npx tsx scripts/syncOdoo.ts
 *   npx tsx scripts/syncOdoo.ts --dry-run
 *
 * Variables de entorno requeridas (leer de .env.local):
 *   ODOO_URL            URL base de Odoo (ej. https://mi-empresa.odoo.com)
 *   ODOO_DB             Nombre de la base de datos Odoo
 *   ODOO_USER           Usuario / email de Odoo
 *   ODOO_API_KEY        API Key generada en Odoo (Configuración → Técnico → API Keys)
 *   FIREBASE_SERVICE_ACCOUNT_PATH  Ruta absoluta al JSON de service account de Firebase Admin
 *
 * Salida en Firestore:
 *   Colección: odooSaleOrders
 *   Doc ID:    name del sale.order (ej. "S00123")
 *   Campos:    name, date_order, amount_total, syncedAtUTC
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { argv, exit } from 'node:process';

import { buildDedupeKey } from '../src/lib/workOrders/dedupe';

// Carga .env.local antes de leer variables (tsx no lo carga automáticamente)
import { config as loadEnv } from 'dotenv';
loadEnv({ path: resolvePath(process.cwd(), '.env.local'), override: true });

import {
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// ─────────────────────────────────────────────
//  Tipos
// ─────────────────────────────────────────────

/** Orden de venta tal como llega desde la API de Odoo. */
interface OdooSaleOrder {
  id: number;
  name: string;
  date_order: string | false;
  partner: string;
  client_order_ref: string | null;
  /**
   * Estado de facturación de Odoo:
   *   'to invoice'  → A facturar (trabajos pendientes)
   *   'invoiced'    → Facturado por completo
   *   'upselling'   → Oportunidad de venta adicional
   *   'no'          → Nada que facturar
   */
  invoice_status: string;
  delivery_count?: number;
  picking_ids?: number[];
  order_lines: OdooOrderLine[];
  deliveries: {
    name: string;
    state: string;
    date_done: string | false;
    lines: {
      product: string;
      qty_demand: number;
      qty_done: number;
      state: string;
      sale_line_id: number | null;
    }[];
  }[];
}

/** Línea de un sale.order. */
interface OdooOrderLine {
  id: number;
  order_id: number;
  product: string;
  description: string;
  qty: number;
  qty_delivered: number;
}

/** Remisión de Odoo (stock.picking) */
interface OdooPicking {
  id: number;
  name: string;
  origin: string;
  state: string;
  date_done: string | false;
  lines: OdooStockMove[];
}

/** Línea de remisión (stock.move) */
interface OdooStockMove {
  id: number;
  picking_id: number;
  product: string;
  qty_demand: number;
  qty_done: number;
  state: string;
  sale_line_id: number | null;
}

/** Respuesta genérica de la API JSON-RPC de Odoo. */
interface OdooJsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: {
      name?: string;
      message?: string;
      debug?: string;
    };
  };
}

/**
 * Objeto XML-RPC: clave → valor. Separado como interface para romper
 * la referencia circular que TypeScript no tolera dentro de un `type` alias.
 */
interface XmlRpcObject {
  [key: string]: XmlRpcValue;
}

/**
 * Valor XML-RPC: primitivo, array recursivo u objeto struct.
 * Usa XmlRpcObject (interface) para el caso recursivo de objeto,
 * lo que evita el error "circularly references itself".
 */
type XmlRpcValue = string | number | boolean | null | XmlRpcValue[] | XmlRpcObject;

// ─────────────────────────────────────────────
//  Configuración
// ─────────────────────────────────────────────

const ODOO_COLLECTION = 'odooSaleOrders';
const WORK_ORDERS_COLLECTION = 'workOrders';
const SYNC_SOURCE_UID = 'syncOdoo-v1';

/** Devuelve el valor de una variable de entorno o lanza si no existe. */
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `Variable de entorno requerida no definida o vacía: ${key}\n` +
        `Añádela a .env.local o al entorno del proceso.`,
    );
  }
  return value.trim();
}

// ─────────────────────────────────────────────
//  Cliente XML-RPC de Odoo
//  (protocolo oficial que acepta API Keys)
// ─────────────────────────────────────────────

/**
 * Serializa un valor JavaScript al formato XML-RPC <value>.
 */
function xmlRpcValue(val: XmlRpcValue): string {
  if (val === null || val === undefined) {
    return '<value><boolean>0</boolean></value>';
  }
  if (typeof val === 'boolean') {
    return `<value><boolean>${val ? 1 : 0}</boolean></value>`;
  }
  if (typeof val === 'number') {
    return Number.isInteger(val)
      ? `<value><int>${val}</int></value>`
      : `<value><double>${val}</double></value>`;
  }
  if (typeof val === 'string') {
    // Escapar caracteres especiales XML
    const escaped = val
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<value><string>${escaped}</string></value>`;
  }
  if (Array.isArray(val)) {
    const items = val.map((v) => `<data>${xmlRpcValue(v as XmlRpcValue)}</data>`).join('');
    return `<value><array>${items}</array></value>`;
  }
  // Objeto → struct
  const members = Object.entries(val)
    .map(
      ([k, v]) =>
        `<member><name>${k}</name>${xmlRpcValue(v as XmlRpcValue)}</member>`,
    )
    .join('');
  return `<value><struct>${members}</struct></value>`;
}

/**
 * Construye el payload XML-RPC para una llamada de método.
 */
function buildXmlRpcCall(method: string, params: XmlRpcValue[]): string {
  const paramsXml = params.map((p) => `<param>${xmlRpcValue(p)}</param>`).join('');
  return (
    '<?xml version="1.0"?>' +
    `<methodCall><methodName>${method}</methodName>` +
    `<params>${paramsXml}</params></methodCall>`
  );
}

/**
 * Extrae el valor de resultado de la respuesta XML-RPC de Odoo.
 * Usa findClosingTag para manejar correctamente el <value> raíz anidado.
 */
function parseXmlRpcResponse(xml: string): XmlRpcValue {
  // Detectar faults
  if (xml.includes('<fault>')) {
    const msgMatch = /<name>faultString<\/name>\s*<value>(?:<string>)?([^<]*)/.exec(xml);
    throw new Error(`Odoo XML-RPC fault: ${msgMatch?.[1] ?? 'error desconocido'}`);
  }

  // Encontrar el <value> que es hijo directo de <param>
  const vStart = xml.indexOf('<value>');
  if (vStart === -1) {
    throw new Error('Respuesta XML-RPC malformada: no se encontró <value>');
  }
  const vEnd = findClosingTag(xml, vStart, 'value');
  if (vEnd === -1) {
    throw new Error('Respuesta XML-RPC malformada: <value> sin cierre');
  }

  return parseXmlRpcValue(xml.slice(vStart, vEnd));
}


/** Parser recursivo de un nodo <value>…</value>. */
function parseXmlRpcValue(xml: string): XmlRpcValue {
  // Quitar el wrapper <value>…</value> externo si lo tiene
  const inner = xml.replace(/^\s*<value>\s*/, '').replace(/\s*<\/value>\s*$/, '');

  // int / i4
  const intMatch = /^<(?:int|i4)>([^<]*)<\/(?:int|i4)>$/.exec(inner.trim());
  if (intMatch) return parseInt(intMatch[1], 10);

  // double
  const dblMatch = /^<double>([^<]*)<\/double>$/.exec(inner.trim());
  if (dblMatch) return parseFloat(dblMatch[1]);

  // boolean
  const boolMatch = /^<boolean>([^<]*)<\/boolean>$/.exec(inner.trim());
  if (boolMatch) return boolMatch[1].trim() === '1';

  // string con etiqueta
  const strMatch = /^<string>([\s\S]*)<\/string>$/.exec(inner.trim());
  if (strMatch) {
    return strMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  // array → extrae los <value> hijos directos de <data>
  const arrayMatch = /^<array>\s*<data>([\s\S]*)<\/data>\s*<\/array>$/.exec(inner.trim());
  if (arrayMatch) {
    return extractChildValues(arrayMatch[1]).map(parseXmlRpcValue);
  }

  // struct → extrae los <member> y sus <value>
  const structMatch = /^<struct>([\s\S]*)<\/struct>$/.exec(inner.trim());
  if (structMatch) {
    const result: Record<string, XmlRpcValue> = {};
    const memberBody = structMatch[1];
    const members = extractMembers(memberBody);
    for (const { name, valueXml } of members) {
      result[name] = parseXmlRpcValue(valueXml);
    }
    return result;
  }

  // <value> sin tipo = string implícito (solo texto)
  if (!inner.trim().startsWith('<')) return inner.trim();

  return null;
}

/**
 * Extrae los nodos <value>…</value> hijos directos de un string XML.
 * Usa un contador de profundidad para manejar anidamiento correcto.
 */
function extractChildValues(xml: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < xml.length) {
    const start = xml.indexOf('<value>', i);
    if (start === -1) break;
    const end = findClosingTag(xml, start, 'value');
    if (end === -1) break;
    results.push(xml.slice(start, end));
    i = end;
  }
  return results;
}

/**
 * Extrae los <member> con su <name> y <value> de un bloque <struct>.
 */
function extractMembers(xml: string): { name: string; valueXml: string }[] {
  const results: { name: string; valueXml: string }[] = [];
  let i = 0;
  while (i < xml.length) {
    const mStart = xml.indexOf('<member>', i);
    if (mStart === -1) break;
    const mEnd = findClosingTag(xml, mStart, 'member');
    if (mEnd === -1) break;
    const memberContent = xml.slice(mStart + '<member>'.length, mEnd - '</member>'.length);
    const nameMatch = /<name>([^<]*)<\/name>/.exec(memberContent);
    const vStart = memberContent.indexOf('<value>');
    if (nameMatch && vStart !== -1) {
      const vEnd = findClosingTag(memberContent, vStart, 'value');
      if (vEnd !== -1) {
        results.push({
          name: nameMatch[1],
          valueXml: memberContent.slice(vStart, vEnd),
        });
      }
    }
    i = mEnd;
  }
  return results;
}

/**
 * Encuentra la posición del cierre </tag> que corresponde al <tag>
 * que empieza en `startPos`, manejando anidamiento.
 * Devuelve la posición DESPUÉS del </tag> de cierre.
 */
function findClosingTag(xml: string, startPos: number, tag: string): number {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  let depth = 0;
  let i = startPos;
  while (i < xml.length) {
    if (xml.startsWith(openTag, i)) {
      depth++;
      i += openTag.length;
    } else if (xml.startsWith(closeTag, i)) {
      depth--;
      i += closeTag.length;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  return -1; // no se encontró cierre
}


/**
 * Ejecuta una llamada XML-RPC contra Odoo.
 * Endpoint /xmlrpc/2/common  → authenticate
 * Endpoint /xmlrpc/2/object  → execute_kw
 */
async function xmlRpcCall(
  url: string,
  endpoint: 'common' | 'object',
  method: string,
  params: XmlRpcValue[],
): Promise<XmlRpcValue> {
  const fullUrl = `${url}/xmlrpc/2/${endpoint}`;
  const body = buildXmlRpcCall(method, params);

  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} → ${fullUrl}`,
    );
  }

  const xml = await response.text();
  return parseXmlRpcResponse(xml);
}

// ─────────────────────────────────────────────
//  Autenticación en Odoo
// ─────────────────────────────────────────────

/**
 * Autentica contra Odoo vía XML-RPC /xmlrpc/2/common.
 * En Odoo 15+ la API Key se pasa directamente como contraseña.
 */
async function odooAuthenticate(
  url: string,
  db: string,
  user: string,
  apiKey: string,
): Promise<number> {
  const uid = await xmlRpcCall(url, 'common', 'authenticate', [
    db,
    user,
    apiKey,
    {},
  ]);

  if (typeof uid !== 'number' || uid === 0) {
    throw new Error(
      'Autenticación fallida: credenciales inválidas, usuario inactivo, o la cuenta no tiene permiso para acceder vía API.',
    );
  }

  return uid;
}

// ─────────────────────────────────────────────
//  Consulta search_read en sale.order
// ─────────────────────────────────────────────

/**
 * Realiza search_read en `sale.order` filtrando por partner_id que contenga
 * 'SUPRAJIT' (búsqueda ilike, insensible a mayúsculas).
 * Usa XML-RPC /xmlrpc/2/object — el único protocolo que acepta API Keys.
 */
async function fetchOdooSaleOrders(
  url: string,
  db: string,
  uid: number,
  apiKey: string,
): Promise<OdooSaleOrder[]> {
  const domain = [['partner_id.name', 'ilike', 'SUPRAJIT']];
  const fields = [
    'name',
    'date_order',
    'partner_id',
    'client_order_ref',
    'invoice_status',   // 'to invoice' | 'invoiced' | 'upselling' | 'no'
    'delivery_count',
    'picking_ids',
  ];

  const result = await xmlRpcCall(url, 'object', 'execute_kw', [
    db, uid, apiKey,
    'sale.order', 'search_read',
    [domain],
    { fields, limit: 0, order: 'date_order desc' },
  ]);

  if (!Array.isArray(result)) {
    throw new Error('Odoo devolvió un resultado inesperado (no es array).');
  }

  return (result as Record<string, XmlRpcValue>[]).map((row) => {
    // partner_id llega como [id, nombre] o false
    const partnerRaw = row['partner_id'];
    const partnerName =
      Array.isArray(partnerRaw) && partnerRaw.length >= 2
        ? String(partnerRaw[1])
        : 'Sin cliente';

    const ref = row['client_order_ref'];
    const clientOrderRef =
      typeof ref === 'string' && ref.trim() !== '' ? ref.trim() : null;

    return {
      id: row['id'] as number,
      name: row['name'] as string,
      date_order: typeof row['date_order'] === 'string' ? row['date_order'] : false,
      partner: partnerName,
      client_order_ref: clientOrderRef,
      invoice_status: typeof row['invoice_status'] === 'string' ? row['invoice_status'] : 'no',
      delivery_count: typeof row['delivery_count'] === 'number' ? row['delivery_count'] : 0,
      picking_ids: Array.isArray(row['picking_ids']) ? row['picking_ids'] as number[] : [],
      order_lines: [],
      deliveries: [],
    };
  });
}

/**
 * Obtiene TODAS las líneas de órdenes de SUPRAJIT en una sola llamada
 * y devuelve un Map de orderInternalId → líneas.
 */
async function fetchOdooOrderLines(
  url: string,
  db: string,
  uid: number,
  apiKey: string,
  orderIds: number[],
): Promise<Map<number, OdooOrderLine[]>> {
  if (orderIds.length === 0) return new Map();

  const domain = [['order_id', 'in', orderIds]];
  const fields = [
    'order_id',
    'product_id',
    'name',
    'product_uom_qty',
    'qty_delivered',
  ];

  console.info(`[syncOdoo] Obteniendo líneas de ${orderIds.length} órdenes…`);

  const result = await xmlRpcCall(url, 'object', 'execute_kw', [
    db, uid, apiKey,
    'sale.order.line', 'search_read',
    [domain],
    { fields, limit: 0, order: 'order_id asc, id asc' },
  ]);

  if (!Array.isArray(result)) {
    throw new Error('sale.order.line: resultado inesperado (no es array).');
  }

  const map = new Map<number, OdooOrderLine[]>();

  for (const rawLine of result as Record<string, XmlRpcValue>[]) {
    // order_id = [id, 'S00123']
    const orderIdRaw = rawLine['order_id'];
    const orderId =
      Array.isArray(orderIdRaw) && orderIdRaw.length >= 1
        ? (orderIdRaw[0] as number)
        : null;
    if (orderId === null) continue;

    // product_id = [id, '[CODE] Nombre'] o false
    const productRaw = rawLine['product_id'];
    const productName =
      Array.isArray(productRaw) && productRaw.length >= 2
        ? String(productRaw[1])
        : 'Sin producto';

    const line: OdooOrderLine = {
      id: rawLine['id'] as number,
      order_id: orderId,
      product: productName,
      description: typeof rawLine['name'] === 'string' ? rawLine['name'] : '',
      qty: typeof rawLine['product_uom_qty'] === 'number' ? rawLine['product_uom_qty'] : 0,
      qty_delivered: typeof rawLine['qty_delivered'] === 'number' ? rawLine['qty_delivered'] : 0,
    };

    if (!map.has(orderId)) map.set(orderId, []);
    map.get(orderId)!.push(line);
  }

  console.info(`[syncOdoo] Líneas cargadas: ${(result as unknown[]).length} en total.`);
  return map;
}

/**
 * Obtiene remisiones (stock.picking) para un listado de órdenes y
 * devuelve un Map de origin (order name) → remisiones.
 */
async function fetchOdooPickings(
  url: string,
  db: string,
  uid: number,
  apiKey: string,
  orderNames: string[],
): Promise<Map<string, OdooPicking[]>> {
  if (orderNames.length === 0) return new Map();

  const domain = [['origin', 'in', orderNames]];
  const fields = ['id', 'name', 'origin', 'state', 'date_done'];

  console.info(`[syncOdoo] Obteniendo remisiones de ${orderNames.length} órdenes…`);

  const result = await xmlRpcCall(url, 'object', 'execute_kw', [
    db, uid, apiKey,
    'stock.picking', 'search_read',
    [domain],
    { fields, limit: 0, order: 'id asc' },
  ]);

  const map = new Map<string, OdooPicking[]>();
  if (!Array.isArray(result)) return map;

  for (const row of result as Record<string, XmlRpcValue>[]) {
    const origin = typeof row['origin'] === 'string' ? row['origin'] : null;
    if (!origin) continue;

    const picking: OdooPicking = {
      id: row['id'] as number,
      name: row['name'] as string,
      origin,
      state: typeof row['state'] === 'string' ? row['state'] : 'unknown',
      date_done: typeof row['date_done'] === 'string' ? row['date_done'] : false,
      lines: [],
    };

    if (!map.has(origin)) map.set(origin, []);
    map.get(origin)!.push(picking);
  }

  return map;
}

/**
 * Obtiene líneas de remisiones (stock.move) para un listado de picking_ids.
 */
async function fetchOdooStockMoves(
  url: string,
  db: string,
  uid: number,
  apiKey: string,
  pickingIds: number[],
): Promise<Map<number, OdooStockMove[]>> {
  if (pickingIds.length === 0) return new Map();

  const domain = [['picking_id', 'in', pickingIds]];
  const fields = ['id', 'picking_id', 'product_id', 'product_uom_qty', 'quantity_done', 'state', 'sale_line_id'];

  console.info(`[syncOdoo] Obteniendo ${pickingIds.length} líneas de remisión (stock.move)…`);

  const result = await xmlRpcCall(url, 'object', 'execute_kw', [
    db, uid, apiKey,
    'stock.move', 'search_read',
    [domain],
    { fields, limit: 0, order: 'picking_id asc, id asc' },
  ]);

  const map = new Map<number, OdooStockMove[]>();
  if (!Array.isArray(result)) return map;

  for (const row of result as Record<string, XmlRpcValue>[]) {
    const pickingIdRaw = row['picking_id'];
    const pickingId = Array.isArray(pickingIdRaw) && pickingIdRaw.length >= 1 ? (pickingIdRaw[0] as number) : null;
    if (pickingId === null) continue;

    const productRaw = row['product_id'];
    const productName = Array.isArray(productRaw) && productRaw.length >= 2 ? String(productRaw[1]) : 'Sin producto';

    const saleLineRaw = row['sale_line_id'];
    const saleLineId = Array.isArray(saleLineRaw) && saleLineRaw.length >= 1 ? (saleLineRaw[0] as number) : null;

    const move: OdooStockMove = {
      id: row['id'] as number,
      picking_id: pickingId,
      product: productName,
      qty_demand: typeof row['product_uom_qty'] === 'number' ? row['product_uom_qty'] : 0,
      qty_done: typeof row['quantity_done'] === 'number' ? row['quantity_done'] : 0,
      state: typeof row['state'] === 'string' ? row['state'] : 'unknown',
      sale_line_id: saleLineId,
    };
    if (!map.has(pickingId)) map.set(pickingId, []);
    map.get(pickingId)!.push(move);
  }

  return map;
}

// ─────────────────────────────────────────────
//  Firebase Admin
// ─────────────────────────────────────────────

function initFirebaseAdmin(serviceAccountPath: string): void {
  if (getApps().length > 0) return; // Evitar doble inicialización

  const resolved = resolvePath(serviceAccountPath);
  const serviceAccount = JSON.parse(
    readFileSync(resolved, 'utf8'),
  ) as ServiceAccount;

  initializeApp({ credential: cert(serviceAccount) });
  console.info(`[syncOdoo] Firebase Admin inicializado (${resolved})`);
}

// ─────────────────────────────────────────────
//  Upsert en Firestore
// ─────────────────────────────────────────────

/**
 * Inserta o actualiza un sale.order en Firestore con su encabezado y líneas.
 * Doc ID = name con '/' reemplazado por '_' (ej. "2026_S00781").
 */
async function upsertSaleOrder(
  db: ReturnType<typeof getFirestore> | null,
  order: OdooSaleOrder,
  dryRun: boolean,
): Promise<void> {
  // Firestore no permite '/' en los IDs de documentos (los interpreta como
  // separadores colección/documento). Reemplazamos por '_' para conservar
  // la información del año en nombres como "2026/S00288" → "2026_S00288".
  const docId = order.name.replace(/\//g, '_');

  // LÓGICA BASADA EN TRASLADOS (Aprobada por el usuario):
  // 1. Consideramos órdenes que en Odoo están en la pestaña "A facturar" ('to invoice' o 'upselling').
  // 2. Si la orden tiene remisiones (stock.picking), verificamos si existe alguna pendiente.
  //    Si TODOS los traslados están 'done' (Hecho) o 'cancel' (Cancelado), significa que
  //    físicamente ya no hay trabajo pendiente, aunque no se haya facturado.
  const isPendingInvoice = order.invoice_status === 'to invoice' || order.invoice_status === 'upselling';
  
  let hasPendingPhysicalWork = true;
  if (order.deliveries.length > 0) {
    // Si hay algún traslado en 'draft', 'waiting', 'confirmed', 'assigned' (Listo), sigue viva.
    hasPendingPhysicalWork = order.deliveries.some(d => d.state !== 'done' && d.state !== 'cancel');
  }

  const isActiveOrder = isPendingInvoice && hasPendingPhysicalWork;

  const payload = {
    // ─ Encabezado ───────────────────────────────────────
    name: order.name,
    date_order: order.date_order !== false ? order.date_order : null,
    partner: order.partner,
    client_order_ref: order.client_order_ref,
    // Estado de facturación directo de Odoo — es ahora el criterio de visibilidad.
    invoice_status: order.invoice_status,
    toInvoice: isActiveOrder,
    // ─ Líneas de la orden ────────────────────────────────────────────────
    // Para servicios genéricos ([73181000] Servicio de maquinados), la pieza
    // real está en `description`. Se almacena description como nombre de pieza.
    order_lines: order.order_lines.map((l) => {
      const productDisplay = isServiceLine(l.product) ? (l.description || l.product) : l.product;
      
      let qty_pending_from_pickings = 0;
      
      if (order.deliveries.length === 0) {
        // Sin traslados generados aún: toda la cantidad está pendiente
        qty_pending_from_pickings = l.qty;
      } else {
        // Con traslados: sumar la cantidad demandada en traslados que NO estén cancelados ni hechos
        let pendingQty = 0;
        for (const delivery of order.deliveries) {
           for (const move of delivery.lines) {
              if (move.sale_line_id === l.id && move.state !== 'done' && move.state !== 'cancel') {
                 pendingQty += move.qty_demand;
              }
           }
        }
        qty_pending_from_pickings = pendingQty;
      }

      // Mutar el objeto original para que upsertWorkOrdersFromOdoo lo tenga disponible
      (l as any).qty_pending_from_pickings = qty_pending_from_pickings;

      return {
        id: l.id,
        product: productDisplay,
        // Omitir description si ya está capturado en product (evita duplicado en reporte)
        description: l.description !== productDisplay ? l.description : '',
        qty: l.qty,
        qty_delivered: l.qty_delivered,
        qty_pending_from_pickings,
      };
    }),
    // ─ Remisiones (entregas) ─────────────────────────
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
    // ─ Metadatos de sync ────────────────────────────
    syncedAtUTC: FieldValue.serverTimestamp(),
    syncedBy: SYNC_SOURCE_UID,
    // Elimina amount_total de documentos anteriores (no se exponen precios)
    amount_total: FieldValue.delete(),
  };

  if (dryRun) {
    console.info(
      `  [dryRun] upsert → ${ODOO_COLLECTION}/${docId}`,
      `| partner: ${order.partner}`,
      `| PO: ${order.client_order_ref ?? '—'}`,
      `| invoice: ${order.invoice_status}`,
      `| delivery_count: ${order.delivery_count}`,
      `| remisiones: ${order.deliveries.length}`,
      `| líneas: ${order.order_lines.length}`,
    );
    return;
  }

  const ref = db!.collection(ODOO_COLLECTION).doc(docId);
  await ref.set(payload, { merge: true });
}

// ─────────────────────────────────────────────
//  Upsert de WorkOrders desde Odoo
// ─────────────────────────────────────────────

/**
 * Devuelve true si la línea es un servicio genérico (no una pieza real).
 * Se filtra del almacenamiento en Firestore y de la creación de OTs.
 */
function isServiceLine(product: string): boolean {
  return /servicio/i.test(product);
}

/**
 * Extrae código de parte y nombre de pieza de un product name de Odoo.
 * Formato "[CODE] Description" → { numeroParte: "CODE", pieza: "Description" }
 * Sin bracket → { numeroParte: "", pieza: product }
 */
function parseOdooProduct(product: string): { numeroParte: string; pieza: string } {
  const match = /^\[([^\]]+)\]\s*(.*)/.exec(product.trim());
  if (match) {
    return { numeroParte: match[1].trim(), pieza: match[2].trim() || product.trim() };
  }
  return { numeroParte: '', pieza: product.trim() };
}

/**
 * Sincroniza las líneas de los sale.orders como WorkOrders en Firestore.
 *
 * Estrategia de merge:
 *   - Si ya existe una OT con el mismo dedup key (SO::parte): solo actualiza
 *     `cantidad`, `odooSource` y `odooOrderId`. NO toca status ni timestamps.
 *   - Si no existe: crea la OT con status 'pendiente'.
 */
async function upsertWorkOrdersFromOdoo(
  db: ReturnType<typeof getFirestore> | null,
  orders: OdooSaleOrder[],
  dryRun: boolean,
): Promise<{ created: number; updated: number; skipped: number; archived: number }> {
  // LÓGICA ESTRICTA: Solo las órdenes que Odoo marca como 'A facturar'.
  // Las facturadas ('invoiced') o sin factura ('no') ya no se muestran en el tablero.
  // Esto reduce las órdenes exactamente a las ~21 que salen en la captura de Odoo.
  const pendingOrders = orders.filter((o) =>
    o.invoice_status === 'to invoice' || o.invoice_status === 'upselling'
  );

  console.info(`  [syncOdoo] Órdenes con líneas pendientes: ${pendingOrders.length} / ${orders.length}`);

  if (pendingOrders.length === 0) return { created: 0, updated: 0, skipped: 0, archived: 0 };

  // En dry run sin Firebase, solo contamos líneas sin consultar Firestore
  if (dryRun && !db) {
    let total = 0;
    const seen = new Set<string>();
    for (const order of pendingOrders) {
      const odooOrderId = order.name.replace(/\//g, '_');
      const validLines = order.order_lines.filter((l) => (l as any).qty_pending_from_pickings > 0);
      for (const line of validLines) {
        const effectiveProduct = isServiceLine(line.product)
          ? (line.description || line.product)
          : line.product;
        if (!effectiveProduct.trim()) continue;
        const { numeroParte, pieza } = parseOdooProduct(effectiveProduct);
        const key = buildDedupeKey({
          soNumber: order.name,
          poNumber: order.client_order_ref ?? '',
          numeroParte,
          pieza,
        });
        if (seen.has(key)) continue;
        seen.add(key);
        total++;
        void odooOrderId; // referenciado para evitar warning
      }
    }
    console.info(`  [dryRun] workOrders → procesaría ~${total} OTs (sin consultar Firestore en dry run)`);
    return { created: 0, updated: 0, skipped: total, archived: 0 };
  }

  if (!db) throw new Error('Firestore no inicializado');

  const BATCH_SIZE = 450;
  
  let archived = 0;
  const toInvoiceSoSet = new Set(pendingOrders.map((o) => o.name));

  const validDedupeKeys = new Set<string>();
  for (const order of pendingOrders) {
    const validLines = order.order_lines.filter((l) => (l as any).qty_pending_from_pickings > 0);
    for (const line of validLines) {
      const effectiveProduct = isServiceLine(line.product)
        ? (line.description || line.product)
        : line.product;
      if (!effectiveProduct.trim()) continue;
      const { numeroParte, pieza } = parseOdooProduct(effectiveProduct);
      validDedupeKeys.add(buildDedupeKey({
        soNumber: order.name,
        poNumber: (order.client_order_ref as any) || '',
        numeroParte,
        pieza,
      }));
    }
  }

  const odooOtsSnap = await db
    .collection(WORK_ORDERS_COLLECTION)
    .where('odooSource', '==', true)
    .where('archived', '==', false)
    .get();

  const toArchive = odooOtsSnap.docs.filter((d) => {
    const raw = d.data();
    const so = raw['soNumber'] as string | undefined;
    const numeroParte = raw['numeroParte'] as string | undefined;
    const pieza = raw['pieza'] as string | undefined;
    const poNumber = raw['poNumber'] as string | undefined;
    
    // Archivar si: el SO ya no está pendiente de facturación o código genérico
    if (so && !toInvoiceSoSet.has(so)) return true;
    if (numeroParte === '73181000') return true;
    
    // O si la línea específica ya no está en validLines (ej. ya se entregó al 100%)
    const key = buildDedupeKey({
      soNumber: so ?? '',
      poNumber: poNumber ?? '',
      numeroParte: numeroParte ?? '',
      pieza: pieza ?? '',
    });
    
    if (so === '2026/S00662') {
      console.log(`Checking 662 key: ${key}`);
      console.log(`  in validDedupeKeys? ${validDedupeKeys.has(key)}`);
    }

    if (!validDedupeKeys.has(key)) return true;

    return false;
  });

  if (toArchive.length > 0) {
    console.info(`  [syncOdoo] Archivando ${toArchive.length} OTs stale/genéricas…`);
    for (let i = 0; i < toArchive.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const doc of toArchive.slice(i, i + BATCH_SIZE)) {
        batch.update(doc.ref, { archived: true, updatedAtUTC: FieldValue.serverTimestamp() });
        archived++;
      }
      await batch.commit();
    }
  }

  // 2. Recopilar todos los soNumbers para buscar OTs existentes
  const soNumbers = [...new Set(pendingOrders.map((o) => o.name))];

  // 3. Query existentes por soNumber — solo no archivadas (chunks de 30, límite del operador `in`)
  const CHUNK = 30;
  const existingByKey = new Map<string, string>(); // dedupeKey → docId

  for (let i = 0; i < soNumbers.length; i += CHUNK) {
    const chunk = soNumbers.slice(i, i + CHUNK);
    const snap = await db
      .collection(WORK_ORDERS_COLLECTION)
      .where('soNumber', 'in', chunk)
      .where('archived', '==', false)
      .get();

    for (const d of snap.docs) {
      const raw = d.data();
      const key = buildDedupeKey({
        soNumber: typeof raw['soNumber'] === 'string' ? raw['soNumber'] : '',
        poNumber: typeof raw['poNumber'] === 'string' ? raw['poNumber'] : '',
        numeroParte: typeof raw['numeroParte'] === 'string' ? raw['numeroParte'] : '',
        pieza: typeof raw['pieza'] === 'string' ? raw['pieza'] : '',
      });
      existingByKey.set(key, d.id);
    }
  }

  // 3. Construir operaciones de create/update para cada línea
  const toCreate: Array<{ key: string; payload: Record<string, unknown> }> = [];
  const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const seenKeys = new Set<string>();

  for (const order of pendingOrders) {
    const odooOrderId = order.name.replace(/\//g, '_');
    const otDate = order.date_order !== false ? order.date_order.split(' ')[0] : '';
    const validLines = order.order_lines.filter((l) => (l as any).qty_pending_from_pickings > 0);

    for (const line of validLines) {
      // Para servicios genéricos, la pieza real es la description de la línea
      const effectiveProduct = isServiceLine(line.product)
        ? (line.description || line.product)
        : line.product;

      if (!effectiveProduct.trim()) continue;

      const { numeroParte, pieza } = parseOdooProduct(effectiveProduct);
      const key = buildDedupeKey({
        soNumber: order.name,
        poNumber: (order.client_order_ref as any) || '',
        numeroParte,
        pieza,
      });

      if (seenKeys.has(key)) continue; // colapsa duplicados dentro del mismo lote
      seenKeys.add(key);

      const existingId = existingByKey.get(key);
      if (existingId) {
        toUpdate.push({
          id: existingId,
          payload: {
            cantidad: String((line as any).qty_pending_from_pickings),
            odooSource: true,
            odooOrderId,
            updatedAtUTC: FieldValue.serverTimestamp(),
          },
        });
      } else {
        toCreate.push({
          key,
          payload: {
            poNumber: order.client_order_ref ?? '',
            soNumber: order.name,
            otDate,
            customer: order.partner,
            pieza,
            numeroParte,
            cantidad: String((line as any).qty_pending_from_pickings),
            prioridad: 'Normal',
            status: 'pendiente',
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
            notes: '',
            sourcePdfName: 'odoo-sync',
            archived: false,
            odooSource: true,
            odooOrderId,
            createdAtUTC: FieldValue.serverTimestamp(),
            updatedAtUTC: FieldValue.serverTimestamp(),
          },
        });
      }
    }
  }

  if (dryRun) {
    console.info(
      `  [dryRun] workOrders → crear: ${toCreate.length}, actualizar: ${toUpdate.length}, colapsados: ${seenKeys.size - toCreate.length - toUpdate.length}`,
    );
    for (const op of toCreate.slice(0, 5)) {
      console.info(`    [dryRun] create key=${op.key}`);
    }
    if (toCreate.length > 5) console.info(`    [dryRun] …y ${toCreate.length - 5} más`);
    return { created: 0, updated: 0, skipped: toCreate.length + toUpdate.length, archived: 0 };
  }

  // 4. Ejecutar create/update en batches de 450
  let created = 0;
  let updated = 0;

  const allOps = [
    ...toCreate.map((op) => ({ type: 'create' as const, op })),
    ...toUpdate.map((op) => ({ type: 'update' as const, op })),
  ];

  for (let i = 0; i < allOps.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = allOps.slice(i, i + BATCH_SIZE);
    for (const item of chunk) {
      if (item.type === 'create') {
        const ref = db.collection(WORK_ORDERS_COLLECTION).doc();
        batch.set(ref, item.op.payload);
        created++;
      } else {
        const ref = db.collection(WORK_ORDERS_COLLECTION).doc(item.op.id);
        batch.update(ref, item.op.payload);
        updated++;
      }
    }
    await batch.commit();
  }

  return { created, updated, skipped: 0, archived };
}

// ─────────────────────────────────────────────
//  Punto de entrada
// ─────────────────────────────────────────────

async function run(): Promise<void> {
  const dryRun = argv.includes('--dry-run') || argv.includes('--dryRun');
  if (dryRun) {
    console.info('[syncOdoo] Modo DRY RUN — no se escribirá en Firestore.');
  }

  // 1. Leer variables de entorno
  const odooUrl = requireEnv('ODOO_URL').replace(/\/$/, ''); // quitar trailing slash
  const odooDB = requireEnv('ODOO_DB');
  const odooUser = requireEnv('ODOO_USER');
  const odooApiKey = requireEnv('ODOO_API_KEY');
  const serviceAccountPath = requireEnv('FIREBASE_SERVICE_ACCOUNT_PATH');

  console.info(`[syncOdoo] Conectando a Odoo: ${odooUrl} / DB: ${odooDB}`);

  // 2. Autenticar en Odoo
  let uid: number;
  try {
    uid = await odooAuthenticate(odooUrl, odooDB, odooUser, odooApiKey);
    console.info(`[syncOdoo] Autenticado en Odoo. uid=${uid}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[syncOdoo] ✗ Error de autenticación:', msg);
    exit(1);
  }

  // 3. Obtener órdenes de venta de SUPRAJIT
  let orders: OdooSaleOrder[];
  try {
    orders = await fetchOdooSaleOrders(odooUrl, odooDB, uid, odooApiKey);
    console.info(`[syncOdoo] ${orders.length} órdenes encontradas con partner "SUPRAJIT".`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[syncOdoo] ✗ Error al consultar sale.order:', msg);
    exit(1);
  }

  if (orders.length === 0) {
    console.warn('[syncOdoo] No hay órdenes para sincronizar. Fin.');
    return;
  }

  // 4. Obtener líneas de todas las órdenes en una sola llamada
  try {
    const orderIds = orders.map((o) => o.id);
    const linesMap = await fetchOdooOrderLines(odooUrl, odooDB, uid, odooApiKey, orderIds);
    
    const orderNames = orders.map((o) => o.name);
    const pickingsMap = await fetchOdooPickings(odooUrl, odooDB, uid, odooApiKey, orderNames);

    // Obtener los IDs de todos los pickings encontrados para traer sus líneas (stock.move)
    const allPickingIds: number[] = [];
    for (const pickings of pickingsMap.values()) {
      for (const p of pickings) {
        allPickingIds.push(p.id);
      }
    }
    const movesMap = await fetchOdooStockMoves(odooUrl, odooDB, uid, odooApiKey, allPickingIds);

    // Adjuntar los moves al picking
    for (const pickings of pickingsMap.values()) {
      for (const p of pickings) {
        p.lines = movesMap.get(p.id) ?? [];
      }
    }

    // Adjuntar las líneas y remisiones a cada orden
    for (const order of orders) {
      order.order_lines = linesMap.get(order.id) ?? [];
      order.deliveries = pickingsMap.get(order.name) ?? [];
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[syncOdoo] ✗ Error al consultar sale.order.line:', msg);
    exit(1);
  }

  // 5. Inicializar Firebase Admin (omitido en dry run)
  let db: ReturnType<typeof getFirestore> | null = null;
  if (!dryRun) {
    try {
      initFirebaseAdmin(serviceAccountPath);
      db = getFirestore();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[syncOdoo] ✗ Error inicializando Firebase Admin:', msg);
      exit(1);
    }
  }

  // 6. Upsert en Firestore (en lotes para respetar límites)
  const BATCH_SIZE = 450;
  let synced = 0;
  let failed = 0;

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const chunk = orders.slice(i, i + BATCH_SIZE);
    console.info(
      `[syncOdoo] Procesando registros ${i + 1}–${Math.min(i + BATCH_SIZE, orders.length)} de ${orders.length}…`,
    );

    await Promise.all(
      chunk.map(async (order) => {
        try {
          await upsertSaleOrder(db, order, dryRun);
          synced++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  [syncOdoo] ✗ Fallo al upsert ${order.name}: ${msg}`);
          failed++;
        }
      }),
    );
  }

  // 7. Upsert WorkOrders desde las líneas de cada orden
  console.info('\n[syncOdoo] Sincronizando WorkOrders desde líneas de Odoo…');
  let woCreated = 0;
  let woUpdated = 0;
  let woArchived = 0;
  try {
    const woResult = await upsertWorkOrdersFromOdoo(db, orders, dryRun);
    woCreated = woResult.created;
    woUpdated = woResult.updated;
    woArchived = woResult.archived;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[syncOdoo] ✗ Error sincronizando WorkOrders:', msg);
    // No es fatal — el sync de odooSaleOrders ya completó
  }

  // 8. Resumen final
  const status = dryRun ? '[dryRun] ' : '';
  console.info(
    `\n[syncOdoo] ${status}Sincronización completada.\n` +
      `  ✓ Exitosos (odooSaleOrders) : ${synced}\n` +
      `  ✗ Fallidos (odooSaleOrders) : ${failed}\n` +
      `  ✓ OTs creadas               : ${woCreated}\n` +
      `  ✓ OTs actualizadas          : ${woUpdated}\n` +
      `  ✓ OTs archivadas            : ${woArchived}\n` +
      `  Colección Odoo              : ${ODOO_COLLECTION}\n` +
      `  Colección WorkOrders        : ${WORK_ORDERS_COLLECTION}`,
  );

  if (failed > 0) {
    exit(1);
  }
}

// Ejecutar y capturar errores fatales no manejados
run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[syncOdoo] Error fatal no capturado:', message);
  exit(1);
});
