/**
 * scripts/toolcribDedupeDrawings.ts
 *
 * Detecta y elimina documentos duplicados en `toolcribDrawings`.
 * Dos planos son duplicados cuando sus PDFs tienen el mismo contenido (SHA-256).
 *
 * MODOS:
 *   # Solo reporte (default — sin cambios en Firestore):
 *   npx tsx scripts/toolcribDedupeDrawings.ts --credentials=./serviceAccount.json
 *
 *   # Llenar checksumSha256 en todos los docs (sin eliminar nada):
 *   npx tsx scripts/toolcribDedupeDrawings.ts --credentials=./serviceAccount.json --write-checksums
 *
 *   # Eliminar duplicados:
 *   npx tsx scripts/toolcribDedupeDrawings.ts --credentials=./serviceAccount.json --execute
 *
 * ESTRATEGIA:
 *   - Agrupa drawings por SHA-256 de su PDF.
 *   - Dentro de cada grupo con el mismo partId: elige el canónico (isActive=true,
 *     o más reciente) y elimina los demás.
 *   - Grupos con diferentes partIds (misma PDF, distintas piezas): solo reporta —
 *     requieren revisión manual porque podrían ser partes legítimamente distintas.
 *   - Siempre escribe el checksum de vuelta en Firestore para acelerar próximas corridas.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { argv, exit } from 'node:process';

import { config as loadEnv } from 'dotenv';
loadEnv({ path: resolvePath(process.cwd(), '.env.local'), override: true });

import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// ─────────────────────────────────────────────
//  Configuración
// ─────────────────────────────────────────────

const DRAWINGS_COLLECTION = 'toolcribDrawings';
const PARTS_COLLECTION = 'toolcribParts';

// ─────────────────────────────────────────────
//  Tipos
// ─────────────────────────────────────────────

interface DrawingRecord {
  id: string;
  partId: string;
  revision: string;
  isActive: boolean;
  sourcePath: string;
  pdfUrl: string | null;
  checksumSha256: string | null;
  createdAtUTC: string | null;
}

interface DuplicateGroup {
  hash: string;
  canonical: DrawingRecord;
  duplicates: DrawingRecord[];
  crossPart: boolean; // true si los docs son de diferentes partIds
}

// ─────────────────────────────────────────────
//  Firebase Admin
// ─────────────────────────────────────────────

function initAdmin(credentialsPath: string): void {
  if (getApps().length > 0) return;
  const serviceAccount = JSON.parse(readFileSync(resolvePath(credentialsPath), 'utf8')) as ServiceAccount;
  const storageBucket = process.env['VITE_FIREBASE_STORAGE_BUCKET'];
  if (!storageBucket) {
    throw new Error('VITE_FIREBASE_STORAGE_BUCKET no está definido en .env.local');
  }
  initializeApp({ credential: cert(serviceAccount), storageBucket });
}

// ─────────────────────────────────────────────
//  Utilidades
// ─────────────────────────────────────────────

/** Descarga una URL y devuelve su SHA-256 hex. */
async function sha256FromUrl(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  const buf = await res.arrayBuffer();
  return createHash('sha256').update(Buffer.from(buf)).digest('hex');
}

/**
 * Extrae la ruta de Storage de una Firebase Storage download URL.
 * Formato: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?...
 */
function storagePathFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/o/');
    if (parts.length < 2) return null;
    return decodeURIComponent(parts[1]);
  } catch {
    return null;
  }
}

/** Selecciona el documento canónico de un grupo: isActive=true > más reciente. */
function pickCanonical(docs: DrawingRecord[]): DrawingRecord {
  const sorted = [...docs].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const dateA = a.createdAtUTC ?? '';
    const dateB = b.createdAtUTC ?? '';
    return dateB.localeCompare(dateA);
  });
  return sorted[0];
}

// ─────────────────────────────────────────────
//  Lógica principal
// ─────────────────────────────────────────────

async function run(): Promise<void> {
  const args = argv.slice(2);
  const execute = args.includes('--execute');
  const writeChecksums = args.includes('--write-checksums');
  const credentialsArg = args.find((a) => a.startsWith('--credentials='));

  if (!credentialsArg) {
    console.error('Uso: npx tsx scripts/toolcribDedupeDrawings.ts --credentials=./serviceAccount.json [--execute] [--write-checksums]');
    exit(1);
  }

  const credentialsPath = credentialsArg.slice('--credentials='.length);
  initAdmin(credentialsPath);

  const db = getFirestore();
  const bucket = getStorage().bucket();

  if (execute) {
    console.info('[dedupeDrawings] ⚠️  MODO EXECUTE — se eliminarán duplicados de Firestore y Storage.');
  } else if (writeChecksums) {
    console.info('[dedupeDrawings] MODO WRITE-CHECKSUMS — solo escribe SHA-256 en Firestore.');
  } else {
    console.info('[dedupeDrawings] MODO REPORTE — solo lectura, sin cambios.');
  }

  // 1. Leer todos los toolcribDrawings
  console.info('\n[1/4] Leyendo toolcribDrawings…');
  const snap = await db.collection(DRAWINGS_COLLECTION).get();
  const allDrawings: DrawingRecord[] = snap.docs.map((d) => {
    const raw = d.data();
    const ts = raw['createdAtUTC'];
    const createdAtUTC =
      ts && typeof (ts as { toDate?: () => Date }).toDate === 'function'
        ? (ts as { toDate: () => Date }).toDate().toISOString()
        : typeof ts === 'string'
        ? ts
        : null;
    return {
      id: d.id,
      partId: typeof raw['partId'] === 'string' ? raw['partId'] : '',
      revision: typeof raw['revision'] === 'string' ? raw['revision'] : '',
      isActive: raw['isActive'] === true,
      sourcePath: typeof raw['sourcePath'] === 'string' ? raw['sourcePath'] : '',
      pdfUrl: typeof raw['pdfUrl'] === 'string' ? raw['pdfUrl'] : null,
      checksumSha256: typeof raw['checksumSha256'] === 'string' ? raw['checksumSha256'] : null,
      createdAtUTC,
    };
  });

  console.info(`   → ${allDrawings.length} drawings encontrados.`);

  const withUrl = allDrawings.filter((d) => d.pdfUrl !== null);
  const withoutUrl = allDrawings.filter((d) => d.pdfUrl === null);
  if (withoutUrl.length > 0) {
    console.warn(`   → ${withoutUrl.length} drawings SIN pdfUrl (se omiten del análisis).`);
  }

  // 2. Obtener o calcular SHA-256 para cada drawing con URL
  console.info(`\n[2/4] Calculando SHA-256 para ${withUrl.length} PDFs…`);
  let computed = 0;
  let cached = 0;
  let failed = 0;
  const checksumUpdates: Array<{ id: string; hash: string }> = [];

  for (const drawing of withUrl) {
    if (drawing.checksumSha256) {
      cached++;
      continue;
    }
    try {
      process.stdout.write(`   Descargando ${drawing.id}… `);
      const hash = await sha256FromUrl(drawing.pdfUrl!);
      drawing.checksumSha256 = hash;
      checksumUpdates.push({ id: drawing.id, hash });
      computed++;
      process.stdout.write(`${hash.slice(0, 12)}… ✓\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`\n   [warn] No se pudo descargar ${drawing.id}: ${msg}`);
      failed++;
    }
  }

  console.info(`   → Cacheados: ${cached} | Calculados: ${computed} | Fallidos: ${failed}`);

  // 2b. Guardar checksums nuevos en Firestore (siempre, incluso en modo reporte)
  if (checksumUpdates.length > 0) {
    if (!writeChecksums && !execute) {
      console.info(`   → ${checksumUpdates.length} checksums calculados (usa --write-checksums para guardarlos).`);
    } else {
      console.info(`   → Guardando ${checksumUpdates.length} checksums en Firestore…`);
      const BATCH = 450;
      for (let i = 0; i < checksumUpdates.length; i += BATCH) {
        const batch = db.batch();
        for (const { id, hash } of checksumUpdates.slice(i, i + BATCH)) {
          batch.update(db.collection(DRAWINGS_COLLECTION).doc(id), {
            checksumSha256: hash,
            updatedAtUTC: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      }
      console.info('   → Checksums guardados.');
    }
  }

  if (writeChecksums && !execute) {
    console.info('\n[dedupeDrawings] Modo --write-checksums completado. Sin duplicados eliminados.');
    return;
  }

  // 3. Agrupar por SHA-256 y detectar duplicados
  console.info('\n[3/4] Analizando duplicados…');

  const byHash = new Map<string, DrawingRecord[]>();
  for (const drawing of withUrl) {
    if (!drawing.checksumSha256) continue;
    const group = byHash.get(drawing.checksumSha256) ?? [];
    group.push(drawing);
    byHash.set(drawing.checksumSha256, group);
  }

  const duplicateGroups: DuplicateGroup[] = [];
  for (const [hash, docs] of byHash) {
    if (docs.length < 2) continue;

    const partIds = new Set(docs.map((d) => d.partId));
    const crossPart = partIds.size > 1;
    const canonical = pickCanonical(docs);
    const dupes = docs.filter((d) => d.id !== canonical.id);

    duplicateGroups.push({ hash, canonical, duplicates: dupes, crossPart });
  }

  if (duplicateGroups.length === 0) {
    console.info('   → No se encontraron duplicados. ✓');
    return;
  }

  // 4. Reporte
  console.info(`\n[4/4] ${duplicateGroups.length} grupo(s) de duplicados encontrado(s):\n`);

  const samePart = duplicateGroups.filter((g) => !g.crossPart);
  const crossPart = duplicateGroups.filter((g) => g.crossPart);

  // ── Grupos mismo partId (se pueden limpiar automáticamente) ──
  if (samePart.length > 0) {
    console.info(`── Mismo partId (${samePart.length} grupos — ${execute ? 'SE ELIMINARÁN' : 'se eliminarían con --execute'}):`);
    for (const group of samePart) {
      console.info(`\n  Hash: ${group.hash.slice(0, 16)}…`);
      console.info(`  ✓ CONSERVAR: [${group.canonical.id}] rev="${group.canonical.revision}" isActive=${group.canonical.isActive} pdfUrl=${group.canonical.pdfUrl?.split('?')[0]?.slice(-40)}`);
      for (const dupe of group.duplicates) {
        console.info(`  ✗ ELIMINAR : [${dupe.id}] rev="${dupe.revision}" isActive=${dupe.isActive} pdfUrl=${dupe.pdfUrl?.split('?')[0]?.slice(-40)}`);
      }
    }
  }

  // ── Grupos cross-part (requieren revisión manual) ──
  if (crossPart.length > 0) {
    console.info(`\n── Diferentes partIds (${crossPart.length} grupos — requieren revisión manual):`);
    for (const group of crossPart) {
      console.info(`\n  Hash: ${group.hash.slice(0, 16)}…`);
      for (const doc of [group.canonical, ...group.duplicates]) {
        console.info(`    [${doc.id}] partId=${doc.partId} rev="${doc.revision}" isActive=${doc.isActive}`);
      }
    }
    // Buscar el nombre de la parte para ayudar en revisión manual
    if (crossPart.length > 0) {
      const allPartIds = new Set(crossPart.flatMap((g) => [g.canonical, ...g.duplicates].map((d) => d.partId)));
      console.info(`\n  Verificando nombres de partes para revisión manual…`);
      for (const partId of allPartIds) {
        const partDoc = await db.collection(PARTS_COLLECTION).doc(partId).get();
        if (partDoc.exists) {
          const d = partDoc.data()!;
          console.info(`    partId=${partId} → partNumber="${d['partNumber']}" desc="${d['description']}"`);
        }
      }
    }
  }

  // 5. Ejecutar limpieza (solo samePart)
  if (!execute) {
    console.info('\n→ Ejecuta con --execute para aplicar la limpieza de los grupos "Mismo partId".');
    return;
  }

  if (samePart.length === 0) {
    console.info('\n→ No hay grupos de mismo partId para limpiar. Los grupos cross-part requieren revisión manual.');
    return;
  }

  console.info(`\n[dedupeDrawings] Eliminando ${samePart.reduce((acc, g) => acc + g.duplicates.length, 0)} documentos duplicados…`);

  // Contar referencias para saber si borrar el Storage file
  const urlReferenceCount = new Map<string, number>();
  for (const drawing of allDrawings) {
    if (!drawing.pdfUrl) continue;
    const path = storagePathFromUrl(drawing.pdfUrl);
    if (!path) continue;
    urlReferenceCount.set(path, (urlReferenceCount.get(path) ?? 0) + 1);
  }

  let deleted = 0;
  let storageDeleted = 0;
  let storageSkipped = 0;

  const BATCH_SIZE = 450;
  const toDelete = samePart.flatMap((g) => g.duplicates);

  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = toDelete.slice(i, i + BATCH_SIZE);

    for (const dupe of chunk) {
      batch.delete(db.collection(DRAWINGS_COLLECTION).doc(dupe.id));
      deleted++;

      // Intentar eliminar el archivo de Storage si nadie más lo referencia
      if (dupe.pdfUrl) {
        const storagePath = storagePathFromUrl(dupe.pdfUrl);
        if (storagePath) {
          const refCount = urlReferenceCount.get(storagePath) ?? 0;
          if (refCount <= 1) {
            try {
              await bucket.file(storagePath).delete();
              storageDeleted++;
              console.info(`   [storage] Eliminado: ${storagePath}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`   [storage] No se pudo eliminar "${storagePath}": ${msg}`);
            }
          } else {
            storageSkipped++;
            console.info(`   [storage] Conservado (referenciado por ${refCount} docs): ${storagePath}`);
          }
        }
      }
    }

    await batch.commit();
  }

  console.info(
    `\n[dedupeDrawings] Limpieza completada.\n` +
    `  ✓ Documentos Firestore eliminados : ${deleted}\n` +
    `  ✓ Archivos Storage eliminados     : ${storageDeleted}\n` +
    `  ○ Archivos Storage conservados    : ${storageSkipped} (referenciados por otros docs)\n` +
    `  ⚠ Grupos cross-part (manuales)   : ${crossPart.length}`,
  );
}

run().catch((err: unknown) => {
  console.error('[dedupeDrawings] Error fatal:', err instanceof Error ? err.message : String(err));
  exit(1);
});
