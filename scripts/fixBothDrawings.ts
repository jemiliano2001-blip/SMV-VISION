import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { wrapImageFileAsPdfBytes } from './lib/wrapImageAsPdf';

const BUCKET_NAME = 'smv-brain.firebasestorage.app';
const SERVICE_ACCOUNT_PATH = resolve('./serviceAccount.json');

const sa = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({
  credential: cert(sa),
  storageBucket: BUCKET_NAME,
});

const db = getFirestore();
const storage = getStorage();

async function uploadPdfForPart(options: {
  partNumber: string;
  customer: string;
  pdfBytes: Buffer | Uint8Array;
  storageFilename: string;
  sourceDescription: string;
}) {
  const { partNumber, customer, pdfBytes, storageFilename, sourceDescription } = options;
  const sha256 = createHash('sha256').update(pdfBytes).digest('hex');
  console.log(`[${partNumber}] PDF bytes: ${pdfBytes.length} | SHA256: ${sha256}`);

  const storagePath = `tool-crib/${customer}/${storageFilename}`;
  const bucket = storage.bucket();
  const token = randomUUID();
  const fileRef = bucket.file(storagePath);

  console.log(`[${partNumber}] Subiendo a Storage: gs://${BUCKET_NAME}/${storagePath}...`);
  await fileRef.save(Buffer.from(pdfBytes), {
    contentType: 'application/pdf',
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  console.log(`[${partNumber}] URL: ${publicUrl}`);

  // Buscar parte
  const partsSnap = await db.collection('toolcribParts')
    .where('partNumber', '==', partNumber)
    .where('customer', '==', customer)
    .get();

  if (partsSnap.empty) {
    throw new Error(`No se encontró la parte ${partNumber} en toolcribParts`);
  }

  const partId = partsSnap.docs[0].id;

  // Actualizar drawings
  const dwgsSnap = await db.collection('toolcribDrawings')
    .where('partId', '==', partId)
    .get();

  const batch = db.batch();
  for (const d of dwgsSnap.docs) {
    const data = d.data();
    if (data.revision === 'CAD' || data.isActive) {
      batch.update(d.ref, {
        isActive: true,
        pdfUrl: publicUrl,
        checksumSha256: sha256,
        sourcePath: sourceDescription,
        updatedAtUTC: FieldValue.serverTimestamp(),
      });
      console.log(`[${partNumber}] Actualizado doc drawing ${d.id}`);
    }
  }

  await batch.commit();
  console.log(`[${partNumber}] OK en Firestore.\n`);
}

async function main() {
  console.log('=== FIX COMPLETO PARA 90-1012-06 Y 90-1012-06-2 ===\n');

  // 1. Parte 90-1012-06: usar el PDF vectorial oficial rev4 (133 KB)
  const pdf06 = readFileSync(resolve('TOOL CRIB/90-1012-6/90-1012-06rev4.pdf'));
  await uploadPdfForPart({
    partNumber: '90-1012-06',
    customer: 'SUPRAJIT',
    pdfBytes: pdf06,
    storageFilename: '90-1012-06.pdf',
    sourceDescription: 'TOOL CRIB/90-1012-6/90-1012-06rev4.pdf',
  });

  // 2. Parte 90-1012-06-2: envolver el export de alta resolucion (473 KB JPG) en PDF
  const jpg062Path = resolve('scratch/test-export/90-1012-06-2.jpg');
  const pdf062Bytes = await wrapImageFileAsPdfBytes(jpg062Path);
  writeFileSync(resolve('scratch/test-export/90-1012-06-2.pdf'), pdf062Bytes);

  await uploadPdfForPart({
    partNumber: '90-1012-06-2',
    customer: 'SUPRAJIT',
    pdfBytes: pdf062Bytes,
    storageFilename: '90-1012-06-2.pdf',
    sourceDescription: 'SLDDRW eDrawings HighRes: 90-1012-06-2',
  });

  console.log('=== AMBOS PLANOS ACTUALIZADOS SATISFACTORIAMENTE ===');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
