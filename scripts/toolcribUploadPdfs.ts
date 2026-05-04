/**
 * scripts/toolcribUploadPdfs.ts
 *
 * Migración: sube los PDFs locales a Firebase Storage y actualiza `pdfUrl`
 * en Firestore con URLs de descarga de Firebase Storage (con token).
 * También regenera tokens para documentos que ya tienen URL GCS pública
 * (storage.googleapis.com) para convertirlos al formato firebasestorage.googleapis.com
 * que el browser puede hacer fetch sin configuración CORS extra.
 *
 * Uso:
 *   npx tsx scripts/toolcribUploadPdfs.ts \
 *     --credentials=./serviceAccount.json \
 *     --storageBucket=smv-brain.firebasestorage.app \
 *     [--dryRun]
 */

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { argv, exit } from 'node:process';
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const GCS_PUBLIC_PREFIX = 'https://storage.googleapis.com/';

interface CliOptions {
  credentialsPath: string | null;
  storageBucket: string;
  dryRun: boolean;
}

function parseArgs(args: readonly string[]): CliOptions {
  let credentialsPath: string | null = null;
  let storageBucket = '';
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--credentials=')) credentialsPath = arg.slice('--credentials='.length);
    else if (arg.startsWith('--storageBucket=')) storageBucket = arg.slice('--storageBucket='.length);
    else if (arg === '--dryRun' || arg === '--dry-run') dryRun = true;
  }

  if (!storageBucket) {
    console.error('Falta --storageBucket=<nombre-del-bucket>');
    exit(1);
  }

  return { credentialsPath, storageBucket, dryRun };
}

function initAdmin(credentialsPath: string | null, storageBucket: string): void {
  if (getApps().length > 0) return;
  const credential = credentialsPath
    ? cert(JSON.parse(readFileSync(credentialsPath, 'utf8')) as ServiceAccount)
    : (() => { throw new Error('Se requiere --credentials='); })();
  initializeApp({ credential, storageBucket });
}

function buildFirebaseStorageUrl(bucketName: string, storagePath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function run(): Promise<void> {
  const opts = parseArgs(argv.slice(2));
  initAdmin(opts.credentialsPath, opts.storageBucket);

  const db = getFirestore();
  const bucket = getStorage().bucket();

  // Configurar CORS en el bucket para que el browser pueda hacer fetch de los PDFs
  if (!opts.dryRun) {
    await bucket.setCorsConfiguration([
      {
        origin: ['*'],
        method: ['GET', 'HEAD', 'OPTIONS'],
        responseHeader: ['Content-Type', 'Access-Control-Allow-Origin'],
        maxAgeSeconds: 3600,
      },
    ]);
    console.info(`[cors] Configuración CORS aplicada a gs://${bucket.name}`);
  }

  // Busca documentos sin pdfUrl O con URL GCS pública que necesita conversión
  const [nullSnapshot, gcsSnapshot] = await Promise.all([
    db.collection('toolcribDrawings').where('pdfUrl', '==', null).get(),
    db.collection('toolcribDrawings').where('pdfUrl', '>=', GCS_PUBLIC_PREFIX)
      .where('pdfUrl', '<', GCS_PUBLIC_PREFIX + '').get(),
  ]);

  const docsToProcess = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  nullSnapshot.forEach((d) => docsToProcess.set(d.id, d));
  gcsSnapshot.forEach((d) => docsToProcess.set(d.id, d));

  if (docsToProcess.size === 0) {
    console.info('Todos los drawings ya tienen pdfUrl Firebase Storage. Nada que hacer.');
    return;
  }

  console.info(`Procesando ${docsToProcess.size} drawings (nuevos o con URL GCS).`);

  // Resolver customers para armar la ruta en Storage
  const partIds = new Set<string>();
  for (const doc of docsToProcess.values()) {
    const partId = doc.data().partId as string | undefined;
    if (partId) partIds.add(partId);
  }

  const customerByPartId = new Map<string, string>();
  for (const partId of partIds) {
    const partDoc = await db.collection('toolcribParts').doc(partId).get();
    if (partDoc.exists) {
      customerByPartId.set(partId, ((partDoc.data()?.customer as string) ?? 'UNKNOWN').toUpperCase());
    }
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const docSnap of docsToProcess.values()) {
    const data = docSnap.data();
    const sourcePath = data.sourcePath as string | undefined;
    const partId = data.partId as string | undefined;
    const revision = data.revision as string | undefined;
    const existingUrl = data.pdfUrl as string | null | undefined;
    const customer = (partId ? customerByPartId.get(partId) : undefined) ?? 'UNKNOWN';

    // Determinar la ruta en Storage
    let storagePath: string;
    if (existingUrl?.startsWith(GCS_PUBLIC_PREFIX)) {
      // Ya subido — extraer la ruta del Storage de la URL GCS
      const withoutPrefix = existingUrl.slice(GCS_PUBLIC_PREFIX.length);
      // formato: {bucket}/{path} → quitamos el bucket
      const bucketPrefix = `${bucket.name}/`;
      storagePath = withoutPrefix.startsWith(bucketPrefix)
        ? withoutPrefix.slice(bucketPrefix.length)
        : withoutPrefix;
    } else {
      // No subido aún — necesitamos sourcePath para subir
      if (!sourcePath || !existsSync(sourcePath)) {
        console.warn(`[skip] ${docSnap.id}: archivo no encontrado en "${sourcePath ?? '(sin sourcePath)'}"`);
        skipped++;
        continue;
      }
      const filename = basename(sourcePath).toLowerCase().endsWith('.pdf')
        ? basename(sourcePath)
        : `${basename(sourcePath)}.pdf`;
      storagePath = `tool-crib/${customer}/${filename}`;
    }

    if (opts.dryRun) {
      console.info(`[dryRun] ${docSnap.id} → firebasestorage URL para "${storagePath}"`);
      updated++;
      continue;
    }

    try {
      const file = bucket.file(storagePath);

      // Si el archivo no está subido todavía, subirlo
      const [exists] = await file.exists();
      if (!exists) {
        if (!sourcePath || !existsSync(sourcePath)) {
          console.warn(`[skip] ${docSnap.id}: no existe en Storage ni localmente`);
          skipped++;
          continue;
        }
        const content = await readFile(sourcePath);
        await file.save(content, {
          contentType: 'application/pdf',
          metadata: { cacheControl: 'public, max-age=31536000' },
        });
      }

      // Generar token de descarga y ponerlo en los metadatos
      const token = randomUUID();
      await file.setMetadata({
        metadata: {
          firebaseStorageDownloadTokens: token,
          partId: partId ?? '',
          revision: revision ?? '',
        },
      });

      const firebaseUrl = buildFirebaseStorageUrl(bucket.name, storagePath, token);
      await docSnap.ref.set({ pdfUrl: firebaseUrl }, { merge: true });

      console.info(`[ok] ${docSnap.id} → ${firebaseUrl}`);
      updated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[error] ${docSnap.id}: ${message}`);
      failed++;
    }
  }

  console.info(`\nListo. Actualizados: ${updated}, Saltados: ${skipped}, Errores: ${failed}`);
  if (failed > 0) exit(1);
}

run().catch((err: unknown) => {
  console.error('[toolcribUploadPdfs] error fatal:', err instanceof Error ? err.message : String(err));
  exit(1);
});
