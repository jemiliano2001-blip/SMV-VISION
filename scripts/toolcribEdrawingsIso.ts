/**
 * scripts/toolcribEdrawingsIso.ts
 *
 * Escanea un directorio Tool Crib en busca de eDrawings (.eprt / .easm),
 * obtiene (o reutiliza) un JPG isométrico + STL opcional, envuelve el JPG
 * en un PDF `{PART}.ISO.pdf`, lo sube a Storage y hace upsert en
 * `toolcribParts` / `toolcribDrawings` con partNumber `{PART}.ISO`.
 *
 * Export eDrawings (Windows):
 *   - Preferido: companions ya exportados junto al archivo (`PART.jpg`, `PART.stl`)
 *   - Opcional: `--exporter=C:\path\export.exe` (API eDrawings / xPort)
 *
 * Uso:
 *   npx tsx scripts/toolcribEdrawingsIso.ts \
 *     --scan="./TOOL CRIB" \
 *     --customer=SUPRAJIT \
 *     --credentials=./serviceAccount.json \
 *     --storageBucket=smv-brain.firebasestorage.app \
 *     [--exporter=C:\\tools\\export.exe] \
 *     [--dryRun]
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve as resolvePath } from 'node:path';
import { argv, exit } from 'node:process';
import { spawnSync } from 'node:child_process';
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
  type Firestore,
} from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import {
  buildIsoPartNumber,
  buildIsoPdfFileName,
  buildIsoStlFileName,
  EDRAWINGS_ISO_REVISION,
  parseEDrawingFileName,
  resolveCompanionImagePath,
  resolveCompanionStlPath,
} from '../src/lib/edrawingsIso';
import { wrapImageFileAsPdfBytes } from './lib/wrapImageAsPdf';

const PARTS_COLLECTION = 'toolcribParts';
const DRAWINGS_COLLECTION = 'toolcribDrawings';
const CREATED_BY_UID = 'edrawings-iso-v1';

interface CliOptions {
  scanPath: string;
  customer: string;
  credentialsPath: string | null;
  storageBucket: string;
  exporterPath: string | null;
  workDir: string | null;
  dryRun: boolean;
}

interface DiscoveredEDrawing {
  absolutePath: string;
  basePartNumber: string;
  isoPartNumber: string;
}

function parseCliOptions(args: readonly string[]): CliOptions {
  let scanPath: string | null = null;
  let customer = 'SUPRAJIT';
  let credentialsPath: string | null = null;
  let storageBucket = 'smv-brain.firebasestorage.app';
  let exporterPath: string | null = null;
  let workDir: string | null = null;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--scan=')) scanPath = arg.slice('--scan='.length);
    else if (arg.startsWith('--customer=')) customer = arg.slice('--customer='.length);
    else if (arg.startsWith('--credentials=')) credentialsPath = arg.slice('--credentials='.length);
    else if (arg.startsWith('--storageBucket=')) storageBucket = arg.slice('--storageBucket='.length);
    else if (arg.startsWith('--exporter=')) exporterPath = arg.slice('--exporter='.length);
    else if (arg.startsWith('--workDir=')) workDir = arg.slice('--workDir='.length);
    else if (arg === '--dryRun' || arg === '--dry-run') dryRun = true;
  }

  if (!scanPath) {
    console.error('Falta --scan=./ruta/TOOL CRIB');
    exit(1);
  }

  return {
    scanPath: resolvePath(scanPath),
    customer: customer.trim().toUpperCase() || 'SUPRAJIT',
    credentialsPath: credentialsPath ? resolvePath(credentialsPath) : null,
    storageBucket,
    exporterPath: exporterPath ? resolvePath(exporterPath) : null,
    workDir: workDir ? resolvePath(workDir) : null,
    dryRun,
  };
}

function initAdmin(credentialsPath: string | null, storageBucket: string): void {
  if (getApps().length > 0) return;
  if (credentialsPath) {
    const serviceAccount = JSON.parse(readFileSync(credentialsPath, 'utf8')) as ServiceAccount;
    initializeApp({ credential: cert(serviceAccount), storageBucket });
    return;
  }
  initializeApp({ credential: applicationDefault(), storageBucket });
}

function buildPartDocId(customer: string, partNumber: string): string {
  const normalized = `${customer.toUpperCase()}::${partNumber.toUpperCase()}`;
  const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 16);
  return `part_${digest}`;
}

function buildDrawingDocId(partId: string, revision: string): string {
  const normalized = `${partId}::${revision.toUpperCase()}`;
  const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 20);
  return `drw_${digest}`;
}

function buildFirebaseStorageUrl(bucketName: string, storagePath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function walkEDrawings(dir: string): Promise<DiscoveredEDrawing[]> {
  const found: DiscoveredEDrawing[] = [];
  const seen = new Set<string>();

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current);
    for (const entry of entries) {
      const fullPath = join(current, entry);
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        if (entry.startsWith('_iso_export') || entry.startsWith('.')) continue;
        await walk(fullPath);
        continue;
      }
      const parsed = parseEDrawingFileName(entry);
      if (!parsed) continue;
      const key = parsed.basePartNumber;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        absolutePath: fullPath,
        basePartNumber: parsed.basePartNumber,
        isoPartNumber: buildIsoPartNumber(parsed.basePartNumber),
      });
    }
  }

  await walk(dir);
  return found;
}

function tryExportWithExporter(
  exporterPath: string,
  inputFile: string,
  outDir: string,
): boolean {
  mkdirSync(outDir, { recursive: true });
  const ps1 = resolvePath(join('scripts', 'edrawings', 'Export-EDrawings.ps1'));
  if (existsSync(ps1)) {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ps1,
        '-ExporterPath', exporterPath,
        '-InputFile', inputFile,
        '-OutDir', outDir,
        '-Formats', '.jpg', '.stl',
      ],
      { encoding: 'utf8' },
    );
    if (result.status === 0) return true;
    console.warn(`[exporter] PowerShell falló (${result.status}): ${result.stderr || result.stdout}`);
  }

  const direct = spawnSync(
    exporterPath,
    ['-input', inputFile, '-outdir', outDir, '-format', '.jpg', '.stl'],
    { encoding: 'utf8' },
  );
  if (direct.status === 0) return true;
  console.warn(`[exporter] exe falló (${direct.status}): ${direct.stderr || direct.stdout}`);
  return false;
}

function resolveImageForItem(
  item: DiscoveredEDrawing,
  exporterPath: string | null,
  workRoot: string,
): string | null {
  const companion = resolveCompanionImagePath(
    item.absolutePath,
    existsSync,
    dirname,
    basename,
    join,
    extname,
  );
  if (companion) return companion;

  if (!exporterPath) return null;

  const outDir = join(workRoot, item.basePartNumber);
  const ok = tryExportWithExporter(exporterPath, item.absolutePath, outDir);
  if (!ok) return null;

  const stem = basename(item.absolutePath, extname(item.absolutePath));
  for (const name of [`${stem}.jpg`, `${stem}.jpeg`, `${stem}.png`, `${stem}.JPG`, `${stem}.PNG`]) {
    const candidate = join(outDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveStlForItem(
  item: DiscoveredEDrawing,
  workRoot: string,
): string | null {
  const companion = resolveCompanionStlPath(
    item.absolutePath,
    existsSync,
    dirname,
    basename,
    join,
    extname,
  );
  if (companion) return companion;

  const stem = basename(item.absolutePath, extname(item.absolutePath));
  const exported = join(workRoot, item.basePartNumber, `${stem}.stl`);
  if (existsSync(exported)) return exported;
  const exportedUpper = join(workRoot, item.basePartNumber, `${stem}.STL`);
  if (existsSync(exportedUpper)) return exportedUpper;
  return null;
}

async function uploadBytes(
  storagePath: string,
  bytes: Buffer | Uint8Array,
  contentType: string,
  dryRun: boolean,
): Promise<string | null> {
  if (dryRun) {
    console.info(`[dryRun] upload ${storagePath} (${bytes.byteLength} bytes, ${contentType})`);
    return `https://example.invalid/${storagePath}`;
  }
  const bucket = getStorage().bucket();
  const token = randomUUID();
  const file = bucket.file(storagePath);
  await file.save(Buffer.from(bytes), {
    contentType,
    metadata: {
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return buildFirebaseStorageUrl(bucket.name, storagePath, token);
}

async function upsertIsoDrawing(params: {
  db: Firestore;
  customer: string;
  item: DiscoveredEDrawing;
  pdfLocalPath: string;
  stlLocalPath: string | null;
  dryRun: boolean;
}): Promise<void> {
  const { db, customer, item, pdfLocalPath, stlLocalPath, dryRun } = params;
  const partId = buildPartDocId(customer, item.isoPartNumber);
  const drawingId = buildDrawingDocId(partId, EDRAWINGS_ISO_REVISION);
  const pdfBytes = await readFile(pdfLocalPath);
  const checksum = createHash('sha256').update(pdfBytes).digest('hex');

  const pdfStoragePath = `tool-crib/${customer}/${buildIsoPdfFileName(item.basePartNumber)}`;
  const pdfUrl = await uploadBytes(pdfStoragePath, pdfBytes, 'application/pdf', dryRun);

  let stlUrl: string | null = null;
  if (stlLocalPath) {
    const stlBytes = await readFile(stlLocalPath);
    const stlStoragePath = `tool-crib/${customer}/${buildIsoStlFileName(item.basePartNumber)}`;
    stlUrl = await uploadBytes(stlStoragePath, stlBytes, 'model/stl', dryRun);
  }

  if (dryRun) {
    console.info(
      `[dryRun] upsert ${item.isoPartNumber} rev=${EDRAWINGS_ISO_REVISION} pdf=${pdfUrl} stl=${stlUrl ?? '(none)'}`,
    );
    return;
  }

  const partRef = db.collection(PARTS_COLLECTION).doc(partId);
  const partExisting = await partRef.get();
  const partPayload = {
    partNumber: item.isoPartNumber,
    customer,
    description: `ISO export eDrawings (${item.basePartNumber})`,
    status: 'active' as const,
    updatedAtUTC: FieldValue.serverTimestamp(),
  };
  if (partExisting.exists) {
    await partRef.set(partPayload, { merge: true });
  } else {
    await partRef.set({
      ...partPayload,
      createdAtUTC: FieldValue.serverTimestamp(),
    });
  }

  const drawingRef = db.collection(DRAWINGS_COLLECTION).doc(drawingId);
  const drawingExisting = await drawingRef.get();
  const drawingPayload: Record<string, unknown> = {
    partId,
    revision: EDRAWINGS_ISO_REVISION,
    isActive: true,
    sourceType: 'storage',
    sourcePath: pdfLocalPath,
    pdfUrl,
    stlUrl,
    checksumSha256: checksum,
    effectiveFromUTC: null,
  };
  if (drawingExisting.exists) {
    await drawingRef.set(drawingPayload, { merge: true });
  } else {
    await drawingRef.set({
      ...drawingPayload,
      createdAtUTC: FieldValue.serverTimestamp(),
      createdByUid: CREATED_BY_UID,
    });
  }

  // Una sola revisión activa por parte ISO
  const others = await db
    .collection(DRAWINGS_COLLECTION)
    .where('partId', '==', partId)
    .where('isActive', '==', true)
    .get();
  const batch = db.batch();
  others.forEach((docSnap) => {
    if (docSnap.id !== drawingId) {
      batch.set(docSnap.ref, { isActive: false }, { merge: true });
    }
  });
  await batch.commit();
}

async function run(): Promise<void> {
  const options = parseCliOptions(argv.slice(2));
  if (!existsSync(options.scanPath)) {
    console.error(`Directorio --scan no existe: ${options.scanPath}`);
    exit(1);
  }

  const workRoot = options.workDir ?? join(options.scanPath, '_iso_export');
  mkdirSync(workRoot, { recursive: true });

  const discovered = await walkEDrawings(options.scanPath);
  console.info(
    `[toolcribEdrawingsIso] ${discovered.length} eDrawing(s) en ${options.scanPath} (cliente ${options.customer})`,
  );

  if (discovered.length === 0) {
    console.info('Nada que procesar.');
    return;
  }

  initAdmin(options.credentialsPath, options.storageBucket);
  const db = getFirestore();

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of discovered) {
    try {
      const imagePath = resolveImageForItem(item, options.exporterPath, workRoot);
      if (!imagePath) {
        console.warn(
          `[skip] ${item.basePartNumber}: sin JPG/PNG companion y sin export usable. ` +
            `Coloca ${basename(item.absolutePath, extname(item.absolutePath))}.jpg junto al eDrawing o usa --exporter=.`,
        );
        skipped += 1;
        continue;
      }

      const pdfOutDir = join(workRoot, item.basePartNumber);
      mkdirSync(pdfOutDir, { recursive: true });
      const pdfLocalPath = join(pdfOutDir, buildIsoPdfFileName(item.basePartNumber));
      const pdfBytes = await wrapImageFileAsPdfBytes(imagePath);
      await writeFile(pdfLocalPath, pdfBytes);
      // También deja una copia legible del path para dry-run debugging
      if (options.dryRun) {
        writeFileSync(join(pdfOutDir, 'source-image.txt'), imagePath, 'utf8');
      }

      const stlLocalPath = resolveStlForItem(item, workRoot);
      await upsertIsoDrawing({
        db,
        customer: options.customer,
        item,
        pdfLocalPath,
        stlLocalPath,
        dryRun: options.dryRun,
      });
      console.info(
        `[ok] ${item.isoPartNumber} ← ${basename(item.absolutePath)}` +
          (stlLocalPath ? ` (+STL)` : ''),
      );
      ok += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[fail] ${item.basePartNumber}: ${message}`);
    }
  }

  console.info(
    `[toolcribEdrawingsIso] ${options.dryRun ? '[dryRun] ' : ''}listo. ok=${ok} skipped=${skipped} failed=${failed}`,
  );
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[toolcribEdrawingsIso] abort:', message);
  exit(1);
});
