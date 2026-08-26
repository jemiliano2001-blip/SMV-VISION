/**
 * Reporte de estado del catálogo Tool Crib: por pieza, ¿tiene CAD (plano
 * acotado), ISO (isométrica) y/o STL (3D)? Solo lectura — no escribe nada.
 *
 * Reusa `groupDrawingViews`/`canonicalPartNumber` de `src/lib/toolcribCatalog.ts`,
 * el mismo agrupador que usa la Biblioteca en la app — para que este reporte
 * refleje exactamente lo que ve el operador, no una cuenta aparte.
 *
 * Uso:
 *   npx tsx scripts/toolcribAudit.ts --credentials=./serviceAccount.json
 *   npx tsx scripts/toolcribAudit.ts --credentials=./serviceAccount.json --customer=SUPRAJIT --missing=cad
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { argv } from 'node:process';

import { config as loadEnv } from 'dotenv';
loadEnv({ path: resolvePath(process.cwd(), '.env.local'), override: true });

import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { groupDrawingViews, type ToolcribPartGroup } from '../src/lib/toolcribCatalog';
import type { ToolcribActiveDrawingView } from '../src/types';

const PARTS_COLLECTION = 'toolcribParts';
const DRAWINGS_COLLECTION = 'toolcribDrawings';

interface CliOptions {
  credentialsPath: string;
  customer: string | null;
  /** Filtra el listado detallado a piezas que les falte este asset. */
  missing: 'cad' | 'iso' | 'stl' | null;
}

function parseArgs(args: readonly string[]): CliOptions {
  let credentialsPath: string | null = null;
  let customer: string | null = null;
  let missing: CliOptions['missing'] = null;
  for (const arg of args) {
    if (arg.startsWith('--credentials=')) credentialsPath = arg.slice('--credentials='.length);
    else if (arg.startsWith('--customer=')) customer = arg.slice('--customer='.length).toUpperCase();
    else if (arg.startsWith('--missing=')) {
      const value = arg.slice('--missing='.length);
      if (value === 'cad' || value === 'iso' || value === 'stl') missing = value;
    }
  }
  if (!credentialsPath) {
    throw new Error('Falta --credentials=./serviceAccount.json');
  }
  return { credentialsPath: resolvePath(credentialsPath), customer, missing };
}

function initAdmin(credentialsPath: string): void {
  if (getApps().length > 0) return;
  const serviceAccount = JSON.parse(readFileSync(credentialsPath, 'utf8')) as ServiceAccount;
  initializeApp({ credential: cert(serviceAccount) });
}

async function loadDrawingViews(customer: string | null): Promise<ToolcribActiveDrawingView[]> {
  const db = getFirestore();
  let partsQuery = db.collection(PARTS_COLLECTION).where('status', '==', 'active');
  if (customer) partsQuery = partsQuery.where('customer', '==', customer);
  const [partsSnap, drawingsSnap] = await Promise.all([
    partsQuery.get(),
    db.collection(DRAWINGS_COLLECTION).where('isActive', '==', true).get(),
  ]);

  const partById = new Map<string, { partNumber: string; customer: string; description: string }>();
  partsSnap.forEach((doc) => {
    const data = doc.data();
    partById.set(doc.id, {
      partNumber: String(data.partNumber ?? ''),
      customer: String(data.customer ?? ''),
      description: String(data.description ?? ''),
    });
  });

  const views: ToolcribActiveDrawingView[] = [];
  drawingsSnap.forEach((doc) => {
    const data = doc.data();
    const partId = String(data.partId ?? '');
    const part = partById.get(partId);
    if (!part) return; // parte no activa / filtrada por --customer

    views.push({
      partId,
      partNumber: part.partNumber,
      customer: part.customer,
      description: part.description,
      drawingId: doc.id,
      revision: String(data.revision ?? ''),
      sourceType: (data.sourceType === 'network' ? 'network' : 'storage'),
      sourcePath: String(data.sourcePath ?? ''),
      pdfUrl: typeof data.pdfUrl === 'string' ? data.pdfUrl : null,
      stlUrl: typeof data.stlUrl === 'string' ? data.stlUrl : null,
      effectiveFromUTC: typeof data.effectiveFromUTC === 'string' ? data.effectiveFromUTC : null,
    });
  });
  return views;
}

function printGroupLine(group: ToolcribPartGroup): void {
  const flags = [
    group.cad ? 'CAD' : '---',
    group.iso ? 'ISO' : '---',
    group.stlView ? 'STL' : '---',
  ].join(' ');
  console.info(`  [${flags}] ${group.partNumber}  ${group.description.slice(0, 60)}`);
}

async function main(): Promise<void> {
  const options = parseArgs(argv.slice(2));
  initAdmin(options.credentialsPath);

  const views = await loadDrawingViews(options.customer);
  console.info(`[scan] ${views.length} drawings activos${options.customer ? ` (customer=${options.customer})` : ''}`);

  const groups = groupDrawingViews(views);
  const withCad = groups.filter((g) => g.cad !== null);
  const withIso = groups.filter((g) => g.iso !== null);
  const withStl = groups.filter((g) => g.stlView !== null);
  const missingCad = groups.filter((g) => g.cad === null);
  const missingIso = groups.filter((g) => g.iso === null);
  const missingStl = groups.filter((g) => g.stlView === null);

  console.info('');
  console.info(`Piezas totales:     ${groups.length}`);
  console.info(`Con CAD (acotado):  ${withCad.length}  (faltan ${missingCad.length})`);
  console.info(`Con ISO (3D vista): ${withIso.length}  (faltan ${missingIso.length})`);
  console.info(`Con STL (3D real):  ${withStl.length}  (faltan ${missingStl.length})`);
  console.info('');

  const toList = options.missing === 'cad' ? missingCad
    : options.missing === 'iso' ? missingIso
    : options.missing === 'stl' ? missingStl
    : groups;
  if (options.missing) {
    console.info(`--- piezas sin ${options.missing.toUpperCase()} (${toList.length}) ---`);
  } else {
    console.info(`--- todas las piezas (${toList.length}) ---`);
  }
  for (const group of toList) printGroupLine(group);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
