import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const BUCKET_NAME = 'smv-brain.firebasestorage.app';
const SERVICE_ACCOUNT_PATH = resolve('./serviceAccount.json');
const PDF_SOURCE_PATH = resolve('TOOL CRIB/90-1012-6/90-1012-06rev4.pdf');

const sa = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({
  credential: cert(sa),
  storageBucket: BUCKET_NAME,
});

const db = getFirestore();
const storage = getStorage();

async function main() {
  console.log('--- Iniciando reemplazo de plano 90-1012-06 en Firestore/Storage ---');

  // 1. Leer archivo PDF vectorial original
  const pdfBytes = readFileSync(PDF_SOURCE_PATH);
  const sha256 = createHash('sha256').update(pdfBytes).digest('hex');
  console.log(`Leído ${PDF_SOURCE_PATH}: ${pdfBytes.length} bytes (SHA256: ${sha256})`);

  // 2. Subir a Firebase Storage
  const storagePath = 'tool-crib/SUPRAJIT/90-1012-06.pdf';
  const bucket = storage.bucket();
  const token = randomUUID();
  const fileRef = bucket.file(storagePath);

  console.log(`Subiendo a Storage: gs://${BUCKET_NAME}/${storagePath}...`);
  await fileRef.save(pdfBytes, {
    contentType: 'application/pdf',
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  console.log(`Subida completada. URL pública: ${publicUrl}`);

  // 3. Buscar parte en Firestore
  const partsSnap = await db.collection('toolcribParts')
    .where('partNumber', '==', '90-1012-06')
    .where('customer', '==', 'SUPRAJIT')
    .get();

  if (partsSnap.empty) {
    throw new Error('No se encontró la parte 90-1012-06 en toolcribParts');
  }

  const partDoc = partsSnap.docs[0];
  const partId = partDoc.id;
  console.log(`Parte encontrada: ${partId}`);

  // 4. Actualizar toolcribDrawings
  const dwgsSnap = await db.collection('toolcribDrawings')
    .where('partId', '==', partId)
    .get();

  const batch = db.batch();

  if (dwgsSnap.empty) {
    const newDwgRef = db.collection('toolcribDrawings').doc();
    batch.set(newDwgRef, {
      partId,
      revision: 'CAD',
      isActive: true,
      sourceType: 'storage',
      sourcePath: 'TOOL CRIB/90-1012-6/90-1012-06rev4.pdf',
      pdfUrl: publicUrl,
      checksumSha256: sha256,
      effectiveFromUTC: null,
      createdByUid: 'manual-fix-vector-v1',
      createdAtUTC: FieldValue.serverTimestamp(),
      updatedAtUTC: FieldValue.serverTimestamp(),
    });
    console.log(`Creando nuevo drawing doc: ${newDwgRef.id}`);
  } else {
    for (const d of dwgsSnap.docs) {
      const data = d.data();
      if (data.revision === 'CAD' || data.isActive) {
        batch.update(d.ref, {
          isActive: true,
          pdfUrl: publicUrl,
          checksumSha256: sha256,
          sourcePath: 'TOOL CRIB/90-1012-6/90-1012-06rev4.pdf',
          updatedAtUTC: FieldValue.serverTimestamp(),
        });
        console.log(`Actualizando drawing doc existente ${d.id} con el nuevo PDF y checksum.`);
      }
    }
  }

  await batch.commit();
  console.log('--- Firestore y Storage actualizados con éxito ---');
}

main().catch((err) => {
  console.error('Error durante la actualización:', err);
  process.exit(1);
});
