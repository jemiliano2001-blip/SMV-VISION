/**
 * scripts/toolcribBootstrap.ts
 *
 * Script one-time para poblar el catálogo Tool Crib (colecciones
 * `toolcribParts` y `toolcribDrawings`) a partir de un inventario local.
 * Usa el Admin SDK (bypass de reglas) así que DEBE ejecutarse con una
 * cuenta de servicio de Firebase con permisos Firestore.
 *
 * Uso:
 *   1. Descarga la service account JSON desde Firebase Console →
 *      Project settings → Service accounts → Generate new private key.
 *   2. Exporta GOOGLE_APPLICATION_CREDENTIALS="/ruta/serviceAccount.json"
 *      (o pasa --credentials=/ruta/serviceAccount.json).
 *   3. Prepara un inventario JSON con el siguiente shape:
 *
 *      {
 *        "customer": "SUPRAJIT",
 *        "parts": [
 *          {
 *            "partNumber": "D7PT-19E525-AA",
 *            "description": "Soporte superior",
 *            "revisions": [
 *              {
 *                "revision": "A",
 *                "isActive": true,
 *                "sourceType": "network",
 *                "sourcePath": "\\\\smvmatamoros\\TOOL CRIB\\D7PT-19E525-AA_RevA.pdf",
 *                "pdfUrl": null,
 *                "checksumSha256": null,
 *                "effectiveFromUTC": "2026-01-01T00:00:00.000Z"
 *              }
 *            ]
 *          }
 *        ]
 *      }
 *
 *   4. Ejecuta:
 *      npx tsx scripts/toolcribBootstrap.ts --inventory=./inventory.json --dryRun
 *      (quita --dryRun cuando valides la salida)
 *
 * Reglas de negocio aplicadas (user_rules):
 * - Trazabilidad: cada revisión lleva `createdAtUTC` (serverTimestamp) y
 *   `createdByUid` con el caller identificado en el script (`bootstrap-v1`).
 * - Validación: duplicados (partNumber+revision) abortan la escritura.
 *   Un partNumber se permite crearse una sola vez por ejecución.
 * - Preservación: el script NO borra datos existentes; usa upsert basado
 *   en claves naturales (partNumber para parte, partId+revision para
 *   dibujo). Para marcar una revisión activa, se desactivan otras del
 *   mismo `partId` en una transacción.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { argv, exit } from 'node:process';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const PARTS_COLLECTION = 'toolcribParts';
const DRAWINGS_COLLECTION = 'toolcribDrawings';
const SOURCE_TYPES = new Set(['network', 'storage']);
const CREATED_BY_UID = 'bootstrap-v1';

interface RawRevision {
  revision?: unknown;
  isActive?: unknown;
  sourceType?: unknown;
  sourcePath?: unknown;
  pdfUrl?: unknown;
  checksumSha256?: unknown;
  effectiveFromUTC?: unknown;
}

interface RawPart {
  partNumber?: unknown;
  description?: unknown;
  revisions?: unknown;
  customer?: unknown;
}

interface RawInventory {
  customer?: unknown;
  parts?: unknown;
}

interface ParsedRevision {
  revision: string;
  isActive: boolean;
  sourceType: 'network' | 'storage';
  sourcePath: string;
  pdfUrl: string | null;
  checksumSha256: string | null;
  effectiveFromUTC: Date | null;
}

interface ParsedPart {
  partNumber: string;
  customer: string;
  description: string;
  revisions: ParsedRevision[];
}

interface ParsedInventory {
  customer: string;
  parts: ParsedPart[];
}

interface CliOptions {
  inventoryPath: string | null;
  scanPath: string | null;
  customer: string;
  credentialsPath: string | null;
  dryRun: boolean;
}

function parseCliOptions(args: readonly string[]): CliOptions {
  let inventoryPath: string | null = null;
  let scanPath: string | null = null;
  let customer = 'SUPRAJIT';
  let credentialsPath: string | null = null;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--inventory=')) {
      inventoryPath = arg.slice('--inventory='.length);
    } else if (arg.startsWith('--scan=')) {
      scanPath = arg.slice('--scan='.length);
    } else if (arg.startsWith('--customer=')) {
      customer = arg.slice('--customer='.length);
    } else if (arg.startsWith('--credentials=')) {
      credentialsPath = arg.slice('--credentials='.length);
    } else if (arg === '--dryRun' || arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (!inventoryPath && !scanPath) {
    console.error(
      'Falta argumento obligatorio: --inventory=./ruta/inventory.json o --scan=./ruta/directorio',
    );
    exit(1);
  }

  return {
    inventoryPath: inventoryPath ? resolvePath(inventoryPath) : null,
    scanPath: scanPath ? resolvePath(scanPath) : null,
    customer,
    credentialsPath: credentialsPath ? resolvePath(credentialsPath) : null,
    dryRun,
  };
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Campo "${field}" debe ser string no vacío`);
  }
  return value.trim();
}

function asOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('Campo opcional debe ser string o null');
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function asBooleanOrFalse(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function asSourceType(value: unknown): 'network' | 'storage' {
  if (typeof value !== 'string' || !SOURCE_TYPES.has(value)) {
    throw new Error(`sourceType inválido (esperado 'network' | 'storage')`);
  }
  return value as 'network' | 'storage';
}

function asOptionalDate(value: unknown, field: string): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Campo "${field}" debe ser ISO 8601 o null`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Campo "${field}" no es fecha válida`);
  }
  return parsed;
}

function asChecksum(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('checksumSha256 debe ser string o null');
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^[0-9a-f]{64}$/.test(trimmed)) {
    throw new Error('checksumSha256 debe ser hex de 64 caracteres');
  }
  return trimmed;
}

function parseRevision(raw: RawRevision, path: string): ParsedRevision {
  try {
    return {
      revision: asNonEmptyString(raw.revision, `${path}.revision`),
      isActive: asBooleanOrFalse(raw.isActive),
      sourceType: asSourceType(raw.sourceType),
      sourcePath: asNonEmptyString(raw.sourcePath, `${path}.sourcePath`),
      pdfUrl: asOptionalString(raw.pdfUrl),
      checksumSha256: asChecksum(raw.checksumSha256),
      effectiveFromUTC: asOptionalDate(raw.effectiveFromUTC, `${path}.effectiveFromUTC`),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error desconocido';
    throw new Error(`Revisión inválida en ${path}: ${message}`);
  }
}

function parseInventory(raw: unknown): { customer: string; parts: ParsedPart[] } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('El inventario debe ser un objeto JSON.');
  }
  const typed = raw as RawInventory;
  const customer = asNonEmptyString(typed.customer ?? 'SUPRAJIT', 'customer');
  if (!Array.isArray(typed.parts)) {
    throw new Error('Campo "parts" debe ser array');
  }

  const parts: ParsedPart[] = [];
  const seenPartNumbers = new Set<string>();

  typed.parts.forEach((rawPart: unknown, index: number) => {
    if (typeof rawPart !== 'object' || rawPart === null) {
      throw new Error(`parts[${index}] debe ser objeto`);
    }
    const partRaw = rawPart as RawPart;
    const partNumber = asNonEmptyString(partRaw.partNumber, `parts[${index}].partNumber`);
    if (seenPartNumbers.has(partNumber)) {
      throw new Error(`partNumber duplicado en inventario: ${partNumber}`);
    }
    seenPartNumbers.add(partNumber);

    const description = typeof partRaw.description === 'string' ? partRaw.description.trim() : '';
    const partCustomer = typeof partRaw.customer === 'string' && partRaw.customer.trim().length > 0
      ? partRaw.customer.trim()
      : customer;

    if (!Array.isArray(partRaw.revisions) || partRaw.revisions.length === 0) {
      throw new Error(`parts[${index}].revisions debe ser array no vacío`);
    }

    const revisions: ParsedRevision[] = [];
    const seenRevisions = new Set<string>();
    let activeCount = 0;
    partRaw.revisions.forEach((rawRev: unknown, rIdx: number) => {
      const parsed = parseRevision(rawRev as RawRevision, `parts[${index}].revisions[${rIdx}]`);
      const key = parsed.revision.toLowerCase();
      if (seenRevisions.has(key)) {
        throw new Error(
          `Revisión duplicada ${parsed.revision} en ${partNumber} (parts[${index}])`,
        );
      }
      seenRevisions.add(key);
      if (parsed.isActive) {
        activeCount += 1;
      }
      revisions.push(parsed);
    });

    if (activeCount > 1) {
      throw new Error(
        `parts[${index}] (${partNumber}) tiene ${activeCount} revisiones activas; máximo permitido: 1`,
      );
    }

    parts.push({
      partNumber,
      customer: partCustomer,
      description,
      revisions,
    });
  });

  return { customer, parts };
}

function buildPartDocId(customer: string, partNumber: string): string {
  // ID determinístico para idempotencia del bootstrap. Evita colisiones
  // usando hash corto del par (customer, partNumber).
  const normalized = `${customer.toUpperCase()}::${partNumber.toUpperCase()}`;
  const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 16);
  return `part_${digest}`;
}

function buildDrawingDocId(partId: string, revision: string): string {
  const normalized = `${partId}::${revision.toUpperCase()}`;
  const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 20);
  return `drw_${digest}`;
}

async function calculateFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function scanDirectory(dir: string, customer: string): Promise<ParsedInventory> {
  const partsMap = new Map<string, ParsedPart>();

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir);
    for (const entry of entries) {
      const fullPath = resolvePath(currentDir, entry);
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.toLowerCase().endsWith('.pdf')) continue;

      // Regex para extraer partNumber y revisión del nombre del archivo
      // Formatos soportados:
      // - PARTNUMBER.pdf (Revision "1")
      // - PARTNUMBER_REVA.pdf (Revision "A")
      // - PARTNUMBER-REV1.pdf (Revision "1")
      const match = entry.match(/^(.+?)(?:[-_]REV([A-Z0-9]+))?\.pdf$/i);
      if (!match) continue;

      const partNumber = match[1].trim().toUpperCase();
      const revision = (match[2] ?? '1').toUpperCase();

      let part = partsMap.get(partNumber);
      if (!part) {
        part = {
          partNumber,
          description: `Importado de ${entry}`,
          customer,
          revisions: [],
        };
        partsMap.set(partNumber, part);
      }

      // Evitar duplicados en el mismo scan
      if (part.revisions.some((r) => r.revision === revision)) continue;

      const checksum = await calculateFileHash(fullPath);

      part.revisions.push({
        revision,
        isActive: true, // Por defecto la última encontrada queda activa
        sourceType: 'network',
        sourcePath: fullPath,
        pdfUrl: null,
        checksumSha256: checksum,
        effectiveFromUTC: new Date(),
      });
    }
  }

  await walk(dir);

  // Regla: Si hay múltiples revisiones para una parte en el scan,
  // solo la última (por orden alfabético de revisión) queda activa.
  for (const part of partsMap.values()) {
    if (part.revisions.length > 1) {
      part.revisions.sort((a, b) => b.revision.localeCompare(a.revision));
      part.revisions.forEach((r, idx) => {
        r.isActive = idx === 0;
      });
    }
  }

  return {
    customer,
    parts: Array.from(partsMap.values()),
  };
}

function initAdmin(credentialsPath: string | null): void {
  if (getApps().length > 0) {
    return;
  }

  const options = { storageBucket: 'smv-brain.firebasestorage.app' };

  if (credentialsPath) {
    const serviceAccount = JSON.parse(
      // Lee el JSON de credenciales en runtime sin usar require (ESM-safe).
      readFileSync(credentialsPath, 'utf8'),
    ) as ServiceAccount;
    initializeApp({ credential: cert(serviceAccount), ...options });
    return;
  }

  initializeApp({ credential: applicationDefault(), ...options });
}

async function upsertPart(
  db: Firestore,
  part: ParsedPart,
  dryRun: boolean,
): Promise<string> {
  const partId = buildPartDocId(part.customer, part.partNumber);
  const ref = db.collection(PARTS_COLLECTION).doc(partId);

  if (dryRun) {
    console.info(`[dryRun] upsert parte ${part.partNumber} -> ${partId}`);
    return partId;
  }

  const existing = await ref.get();
  const basePayload = {
    partNumber: part.partNumber,
    customer: part.customer,
    description: part.description,
    status: 'active' as const,
    updatedAtUTC: FieldValue.serverTimestamp(),
  };

  if (existing.exists) {
    await ref.set(basePayload, { merge: true });
  } else {
    await ref.set({
      ...basePayload,
      createdAtUTC: FieldValue.serverTimestamp(),
    });
  }
  return partId;
}

async function upsertDrawings(
  db: Firestore,
  partId: string,
  revisions: ParsedRevision[],
  dryRun: boolean,
): Promise<void> {
  const activeRevision = revisions.find((r) => r.isActive) ?? null;
  const bucket = getStorage().bucket();

  for (const revision of revisions) {
    const drawingId = buildDrawingDocId(partId, revision.revision);
    const ref = db.collection(DRAWINGS_COLLECTION).doc(drawingId);

    if (dryRun) {
      console.info(
        `[dryRun] upsert dibujo partId=${partId} rev=${revision.revision} activo=${revision.isActive}`,
      );
      continue;
    }

    let pdfUrl = revision.pdfUrl;
    let sourceType = revision.sourceType;

    if (!pdfUrl && revision.sourcePath && revision.sourceType === 'network') {
      const destName = `toolcrib/${partId}/${revision.revision}.pdf`;
      console.info(`Subiendo a Storage: ${destName}`);
      const file = bucket.file(destName);
      await bucket.upload(revision.sourcePath, {
        destination: destName,
        metadata: { contentType: 'application/pdf' },
      });
      // Creamos un signed URL muy largo para acceso de solo lectura
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '01-01-2100',
      });
      pdfUrl = url;
      sourceType = 'storage';
    }

    const existing = await ref.get();
    const payload: Record<string, unknown> = {
      partId,
      revision: revision.revision,
      isActive: revision.isActive,
      sourceType,
      sourcePath: revision.sourcePath,
      pdfUrl,
      checksumSha256: revision.checksumSha256,
      effectiveFromUTC: revision.effectiveFromUTC
        ? Timestamp.fromDate(revision.effectiveFromUTC)
        : null,
    };

    if (existing.exists) {
      await ref.set(payload, { merge: true });
    } else {
      await ref.set({
        ...payload,
        createdAtUTC: FieldValue.serverTimestamp(),
        createdByUid: CREATED_BY_UID,
      });
    }
  }

  // Mantener el invariante "una sola revisión activa por parte": si hay una
  // activa en el input, apagamos cualquier otra en Firestore que no esté en
  // el inventario con isActive=true.
  if (!dryRun && activeRevision) {
    const activeDrawingId = buildDrawingDocId(partId, activeRevision.revision);
    const others = await db
      .collection(DRAWINGS_COLLECTION)
      .where('partId', '==', partId)
      .where('isActive', '==', true)
      .get();
    const batch = db.batch();
    others.forEach((docSnap) => {
      if (docSnap.id !== activeDrawingId) {
        batch.set(docSnap.ref, { isActive: false }, { merge: true });
      }
    });
    await batch.commit();
  }
}

async function run(): Promise<void> {
  const options = parseCliOptions(argv.slice(2));
  let inventory: ParsedInventory;

  if (options.scanPath) {
    console.info('[toolcribBootstrap] escaneando directorio', options.scanPath);
    inventory = await scanDirectory(options.scanPath, options.customer);
  } else if (options.inventoryPath) {
    console.info('[toolcribBootstrap] leyendo inventario', options.inventoryPath);
    const rawJson = await readFile(options.inventoryPath, 'utf8');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Inventario JSON inválido: ${message}`);
    }
    inventory = parseInventory(parsedJson);
  } else {
    throw new Error('No se especificó --inventory ni --scan');
  }

  console.info(
    `[toolcribBootstrap] inventario listo: ${inventory.parts.length} partes para cliente "${inventory.customer}"`,
  );

  initAdmin(options.credentialsPath);
  const db = getFirestore();

  let partsProcessed = 0;
  let drawingsProcessed = 0;
  for (const part of inventory.parts) {
    const partId = await upsertPart(db, part, options.dryRun);
    await upsertDrawings(db, partId, part.revisions, options.dryRun);
    partsProcessed += 1;
    drawingsProcessed += part.revisions.length;
  }

  console.info(
    `[toolcribBootstrap] ${options.dryRun ? '[dryRun] ' : ''}listo. Partes: ${partsProcessed}, revisiones: ${drawingsProcessed}`,
  );
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[toolcribBootstrap] error fatal:', message);
  exit(1);
});
