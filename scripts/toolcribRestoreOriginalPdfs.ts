/**
 * scripts/toolcribRestoreOriginalPdfs.ts
 *
 * Restaura planos en alta definición / vectoriales en Firebase Storage y Firestore
 * reemplazando aquellos que apuntaban a capturas rasterizadas de baja resolución (cad-recover-work/scratch).
 *
 * Uso:
 *   npx tsx scripts/toolcribRestoreOriginalPdfs.ts --dryRun
 *   npx tsx scripts/toolcribRestoreOriginalPdfs.ts --execute
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { argv, exit } from 'node:process';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const BUCKET_NAME = 'smv-brain.firebasestorage.app';
const SERVICE_ACCOUNT_PATH = resolve('./serviceAccount.json');
const TOOL_CRIB_ROOT = resolve('./TOOL CRIB');

interface CliOptions {
  dryRun: boolean;
  execute: boolean;
  customer: string;
}

function parseArgs(args: readonly string[]): CliOptions {
  let dryRun = true;
  let execute = false;
  let customer = 'SUPRAJIT';

  for (const arg of args) {
    if (arg === '--execute') {
      execute = true;
      dryRun = false;
    } else if (arg === '--dryRun' || arg === '--dry-run') {
      dryRun = true;
      execute = false;
    } else if (arg.startsWith('--customer=')) {
      customer = arg.slice('--customer='.length).toUpperCase();
    }
  }

  return { dryRun, execute, customer };
}

function findPdfsRecursively(dir: string, list: string[] = []): string[] {
  try {
    for (const item of readdirSync(dir)) {
      const full = join(dir, item);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        findPdfsRecursively(full, list);
      } else if (item.toLowerCase().endsWith('.pdf')) {
        list.push(full);
      }
    }
  } catch (e) {
    console.warn(`Error leyendo directorio ${dir}:`, e);
  }
  return list;
}

function normalizeKey(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface MatchResult {
  dwgDocId: string;
  partDocId: string;
  partNumber: string;
  revision: string;
  currentSource: string;
  localPdfPath: string;
  relativeLocalPath: string;
  targetStoragePath: string;
  score: number;
}

async function main() {
  const opts = parseArgs(argv.slice(2));

  console.log('================================================================');
  console.log('   RESTAURACIÓN DE PLANOS VECTORIALES / ALTA DEF EN TOOL CRIB   ');
  console.log('================================================================');
  console.log(`Modo: ${opts.execute ? 'EJECUCIÓN REAL (--execute)' : 'SIMULACIÓN (--dryRun)'}`);
  console.log(`Cliente: ${opts.customer}`);
  console.log(`Directorio fuente: ${TOOL_CRIB_ROOT}\n`);

  if (!existsSync(TOOL_CRIB_ROOT)) {
    console.error(`Error: No existe la carpeta ${TOOL_CRIB_ROOT}`);
    exit(1);
  }

  // 1. Inicializar Firebase
  if (getApps().length === 0) {
    const sa = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    initializeApp({
      credential: cert(sa),
      storageBucket: BUCKET_NAME,
    });
  }

  const db = getFirestore();
  const bucket = getStorage().bucket();

  // 2. Indexar todos los PDFs locales en TOOL CRIB
  const allLocalPdfs = findPdfsRecursively(TOOL_CRIB_ROOT);
  console.log(`[local] Se encontraron ${allLocalPdfs.length} PDFs en "${TOOL_CRIB_ROOT}".`);

  // 3. Obtener Partes y Planos de Firestore
  console.log('[firestore] Consultando partes y planos activos...');
  const partsSnap = await db.collection('toolcribParts').where('customer', '==', opts.customer).get();
  const partMap = new Map<string, any>();
  partsSnap.forEach((doc) => partMap.set(doc.id, { id: doc.id, ...doc.data() }));

  const dwgsSnap = await db.collection('toolcribDrawings').where('isActive', '==', true).get();
  console.log(`[firestore] Partes encontradas: ${partsSnap.size} | Planos activos: ${dwgsSnap.size}`);

  const matches: MatchResult[] = [];
  const skippedClean: string[] = [];
  const unmatchable: string[] = [];

  for (const dwgDoc of dwgsSnap.docs) {
    const data = dwgDoc.data();
    const part = partMap.get(data.partId);
    if (!part) continue; // pertenece a otro cliente o huérfano

    const partNumber = part.partNumber as string;
    const currentSource = (data.sourcePath as string) || '';

    // Solo restaurar aquellos que vengan de scratch / cad-recover / edrawings temporales
    const isBlurrySource =
      currentSource.includes('scratch') ||
      currentSource.includes('cad-recover') ||
      currentSource.includes('edrawings-');

    if (!isBlurrySource) {
      skippedClean.push(partNumber);
      continue;
    }

    const isIso = data.revision === 'EDRW' || partNumber.toLowerCase().endsWith('.iso');
    const basePartClean = partNumber.replace(/\.iso$/i, '').trim();
    const normBasePart = normalizeKey(basePartClean);

    // Buscar el mejor candidato PDF local
    let bestPdf: string | null = null;
    let bestScore = -1;

    for (const pdfPath of allLocalPdfs) {
      const fileName = basename(pdfPath);
      const fileNameLower = fileName.toLowerCase();
      const fnNoExt = fileNameLower.replace(/\.pdf$/, '');
      const normFileName = normalizeKey(fnNoExt);
      const isPdfIso = fileNameLower.includes('.iso') || fileNameLower.includes('iso.');

      // Reglas de tipo de plano (CAD vs ISO)
      if (isIso) {
        // Para plano ISO: priorizar fuertemente archivos que tengan .iso en el nombre
        if (normFileName === normBasePart + 'iso' || (normFileName.includes(normBasePart) && isPdfIso)) {
          bestScore = 150;
          bestPdf = pdfPath;
          break; // Match perfecto de ISO
        }
      } else {
        // Para plano CAD: no queremos que un plano dimensional tome un archivo .iso.pdf
        if (isPdfIso) continue;
      }

      // Exact match de nombre base (o con sufijo de revisión como rev3, rB, etc.)
      if (normFileName === normBasePart) {
        const score = isIso ? 90 : 140;
        if (score > bestScore) {
          bestScore = score;
          bestPdf = pdfPath;
        }
        continue;
      }

      if (normFileName.startsWith(normBasePart)) {
        // e.g. 90-1012-05rev3.pdf matches 90-1012-05
        const score = isIso ? (isPdfIso ? 150 : 95) : 130;
        if (score > bestScore) {
          bestScore = score;
          bestPdf = pdfPath;
        }
        continue;
      }

      // Prefijo exacto o contenido en el directorio del número de parte
      const parentDir = basename(join(pdfPath, '..')).toLowerCase();
      const normParentDir = normalizeKey(parentDir);

      if (normParentDir.includes(normBasePart) || normFileName.includes(normBasePart)) {
        let score = 80;
        if (isIso && isPdfIso) score = 110;
        if (!isIso && !isPdfIso) score = 100;

        if (score > bestScore) {
          bestScore = score;
          bestPdf = pdfPath;
        }
      }
    }

    if (bestPdf && bestScore >= 80) {
      const relativeLocalPath = relative(resolve('.'), bestPdf);
      const storageFilename = isIso
        ? `${basePartClean}.ISO.pdf`
        : `${basePartClean}.pdf`;
      const targetStoragePath = `tool-crib/${opts.customer}/${storageFilename}`;

      matches.push({
        dwgDocId: dwgDoc.id,
        partDocId: data.partId,
        partNumber,
        revision: data.revision,
        currentSource,
        localPdfPath: bestPdf,
        relativeLocalPath,
        targetStoragePath,
        score: bestScore,
      });
    } else {
      unmatchable.push(`[${partNumber}] (Rev: ${data.revision}) Source: ${basename(currentSource)}`);
    }
  }

  console.log(`\n================== RESUMEN DE COINCIDENCIAS ==================`);
  console.log(`Planos limpios (no requieren cambio): ${skippedClean.length}`);
  console.log(`Planos a restaurar con PDF original:  ${matches.length}`);
  console.log(`Planos sin PDF local en TOOL CRIB:    ${unmatchable.length}`);
  console.log(`==============================================================\n`);

  // Mostrar muestra de coincidencias
  console.log('--- DETALLE DE EMPAREJAMIENTOS (Primeros 25) ---');
  for (const m of matches.slice(0, 25)) {
    console.log(`✔ [${m.partNumber}] (${m.revision}) -> ${basename(m.localPdfPath)} (score: ${m.score})`);
    console.log(`    Storage: gs://${BUCKET_NAME}/${m.targetStoragePath}`);
  }

  if (matches.some((m) => m.partNumber.includes('90-1012-05'))) {
    console.log('\n--- VERIFICACIÓN ESPECÍFICA PARA 90-1012-05 ---');
    matches
      .filter((m) => m.partNumber.includes('90-1012-05'))
      .forEach((m) => {
        console.log(`✔ [${m.partNumber}] (${m.revision}) -> ${m.relativeLocalPath}`);
      });
  }

  if (opts.dryRun) {
    console.log('\n[dryRun] Modo simulación completado. No se escribieron datos.');
    console.log('Para aplicar los cambios a Firebase Storage y Firestore, corre:');
    console.log('npx tsx scripts/toolcribRestoreOriginalPdfs.ts --execute\n');
    return;
  }

  // 4. EJECUCIÓN REAL: Subir a Storage y actualizar Firestore
  console.log('\n[execute] Iniciando subida de archivos y actualización en Firestore...');

  let successCount = 0;
  let errorCount = 0;

  // Cache para no subir el mismo archivo local dos veces si se usa en varios docs
  const uploadedUrls = new Map<string, { publicUrl: string; sha256: string }>();

  // Procesamos secuencialmente o en lotes pequeños para no saturar
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const progress = `[${i + 1}/${matches.length}]`;

    try {
      let uploadInfo = uploadedUrls.get(m.localPdfPath);

      if (!uploadInfo) {
        const fileBytes = readFileSync(m.localPdfPath);
        const sha256 = createHash('sha256').update(fileBytes).digest('hex');
        const token = randomUUID();
        const fileRef = bucket.file(m.targetStoragePath);

        await fileRef.save(fileBytes, {
          contentType: 'application/pdf',
          metadata: {
            cacheControl: 'public, max-age=31536000',
            metadata: {
              firebaseStorageDownloadTokens: token,
              restoredBy: 'toolcribRestoreOriginalPdfs',
              sourcePath: m.relativeLocalPath,
            },
          },
        });

        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodeURIComponent(m.targetStoragePath)}?alt=media&token=${token}`;
        uploadInfo = { publicUrl, sha256 };
        uploadedUrls.set(m.localPdfPath, uploadInfo);
      }

      // Actualizar documento toolcribDrawings
      const dwgRef = db.collection('toolcribDrawings').doc(m.dwgDocId);
      await dwgRef.update({
        isActive: true,
        pdfUrl: uploadInfo.publicUrl,
        checksumSha256: uploadInfo.sha256,
        sourcePath: m.relativeLocalPath,
        updatedAtUTC: FieldValue.serverTimestamp(),
      });

      console.log(`${progress} OK: [${m.partNumber}] (${m.revision}) -> ${basename(m.localPdfPath)}`);
      successCount++;
    } catch (err) {
      console.error(`${progress} ERROR en [${m.partNumber}]:`, err);
      errorCount++;
    }
  }

  console.log('\n================================================================');
  console.log(`RESTAURACIÓN FINALIZADA`);
  console.log(`Exitosos: ${successCount}`);
  console.log(`Fallidos: ${errorCount}`);
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('[toolcribRestoreOriginalPdfs] Error fatal:', err);
  exit(1);
});
