/**
 * Sube STLs locales ya exportados y escribe `stlUrl` en toolcribDrawings.
 *
 * Uso:
 *   npx tsx scripts/toolcribUploadStls.ts --scan=./scratch/toolcrib-3d-full --credentials=./serviceAccount.json
 *   npx tsx scripts/toolcribUploadStls.ts --scan=./scratch/toolcrib-3d-full --credentials=./serviceAccount.json --dryRun
 */

import { randomUUID } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve as resolvePath } from 'node:path';
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import { MIN_BLUEPRINT_MATCH_SCORE } from '../src/lib/matching';
import { buildFirebaseStorageUrl } from './toolcrib/lib/firestoreCatalog';
import { scoreStlDrawingMatch } from './toolcrib/lib/stlMatch';

const DRAWINGS = 'toolcribDrawings';
const PARTS = 'toolcribParts';
const CUSTOMER = 'SUPRAJIT';
const BUCKET = 'smv-brain.firebasestorage.app';

interface CliOptions {
  scanPath: string;
  credentialsPath: string;
  dryRun: boolean;
}

interface StlCandidate {
  absolutePath: string;
  basePartNumber: string;
  fileName: string;
  sizeBytes: number;
}

interface DrawingHit {
  drawingId: string;
  partId: string;
  revision: string;
  partNumber: string;
  sourcePath: string;
}

function parseArgs(args: readonly string[]): CliOptions {
  let scanPath: string | null = null;
  let credentialsPath: string | null = null;
  let dryRun = false;
  for (const arg of args) {
    if (arg.startsWith('--scan=')) scanPath = arg.slice('--scan='.length);
    else if (arg.startsWith('--credentials=')) credentialsPath = arg.slice('--credentials='.length);
    else if (arg === '--dryRun' || arg === '--dry-run') dryRun = true;
  }
  if (!scanPath) throw new Error('Falta --scan=./ruta/con/stls');
  if (!credentialsPath) throw new Error('Falta --credentials=./serviceAccount.json');
  return {
    scanPath: resolvePath(scanPath),
    credentialsPath: resolvePath(credentialsPath),
    dryRun,
  };
}

function normalizePart(value: string): string {
  return value.trim().toUpperCase().replace(/\.STL$/i, '').replace(/\.ISO$/i, '');
}

async function walkStls(root: string): Promise<StlCandidate[]> {
  const out: StlCandidate[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.stl')) continue;
      const info = await stat(absolutePath);
      if (info.size <= 0) continue;
      const stem = basename(entry.name, extname(entry.name));
      const folder = basename(dirname(absolutePath));
      const basePartNumber = normalizePart(stem.includes('-Rev') || stem.includes('-REV') ? stem : (stem || folder));
      out.push({
        absolutePath,
        basePartNumber,
        fileName: entry.name,
        sizeBytes: info.size,
      });
    }
  }
  await walk(root);
  return out.sort((a, b) => a.basePartNumber.localeCompare(b.basePartNumber));
}


async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const candidates = await walkStls(options.scanPath);
  console.info(`[scan] ${candidates.length} STL en ${options.scanPath}`);
  if (candidates.length === 0) {
    console.info('Nada que subir.');
    return;
  }

  const parsedCredential = JSON.parse(readFileSync(options.credentialsPath, 'utf8'));
  if (getApps().length === 0) {
    initializeApp({ credential: cert(parsedCredential), storageBucket: BUCKET });
  }
  const db = getFirestore();
  const bucket = getStorage().bucket();

  const [partsSnap, drawingsSnap] = await Promise.all([
    db.collection(PARTS).where('customer', '==', CUSTOMER).get(),
    db.collection(DRAWINGS).where('isActive', '==', true).get(),
  ]);

  const partNumberById = new Map<string, string>();
  for (const doc of partsSnap.docs) {
    const partNumber = String(doc.data().partNumber ?? '');
    if (partNumber) partNumberById.set(doc.id, partNumber);
  }

  const drawings: DrawingHit[] = drawingsSnap.docs.map((doc) => {
    const data = doc.data();
    const partId = String(data.partId ?? '');
    return {
      drawingId: doc.id,
      partId,
      revision: String(data.revision ?? ''),
      partNumber: partNumberById.get(partId) ?? '',
      sourcePath: String(data.sourcePath ?? ''),
    };
  });

  console.info(`[firestore] ${partsSnap.size} parts · ${drawings.length} drawings activos`);

  let uploaded = 0;
  let linked = 0;
  let skipped = 0;
  let failed = 0;
  const claimedDrawings = new Set<string>();

  for (const stl of candidates) {
    const ranked = drawings
      .map((drawing) => ({
        drawing,
        score: scoreStlDrawingMatch(stl.basePartNumber, drawing.partNumber, drawing.sourcePath),
      }))
      .filter((row) => row.score >= MIN_BLUEPRINT_MATCH_SCORE)
      .sort((a, b) => b.score - a.score);

    const best = ranked.find((row) => !claimedDrawings.has(row.drawing.drawingId));
    if (!best) {
      console.warn(`[skip] sin match libre de catálogo para ${stl.basePartNumber} (${stl.fileName})`);
      skipped += 1;
      continue;
    }

    claimedDrawings.add(best.drawing.drawingId);
    const storagePath = `tool-crib/${CUSTOMER}/${stl.basePartNumber}.stl`;
    console.info(
      `[match] ${stl.basePartNumber} → ${best.drawing.partNumber || best.drawing.drawingId} ` +
        `(score ${best.score}, rev ${best.drawing.revision})`,
    );

    if (options.dryRun) {
      console.info(`[dryRun] subiría ${stl.absolutePath} → ${storagePath}`);
      uploaded += 1;
      linked += 1;
      continue;
    }

    try {
      const bytes = await readFile(stl.absolutePath);
      const token = randomUUID();
      await bucket.file(storagePath).save(bytes, {
        contentType: 'model/stl',
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
      const stlUrl = buildFirebaseStorageUrl(bucket.name, storagePath, token);
      await db.collection(DRAWINGS).doc(best.drawing.drawingId).set({ stlUrl }, { merge: true });
      console.info(`[ok] ${stl.basePartNumber} stlUrl escrito (${bytes.length} bytes)`);
      uploaded += 1;
      linked += 1;
    } catch (error) {
      failed += 1;
      claimedDrawings.delete(best.drawing.drawingId);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[fail] ${stl.basePartNumber}: ${message}`);
    }
  }

  console.info(
    `[done] uploaded=${uploaded} linked=${linked} skipped=${skipped} failed=${failed} dryRun=${options.dryRun}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
