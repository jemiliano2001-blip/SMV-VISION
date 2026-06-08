/**
 * scripts/toolcribMergeDuplicates.ts
 *
 * Limpieza puntual de los 6 grupos de planos duplicados detectados por
 * toolcribDedupeDrawings.ts el 2026-06-05.
 *
 * Para cada par:
 *   1. Redirige WorkOrders que apunten al duplicado → canónico.
 *   2. Elimina el toolcribDrawing duplicado.
 *   3. Archiva el toolcribPart duplicado (status=archived, no hard-delete
 *      para preservar historial en printLogs).
 *
 * Uso:
 *   # Reporte sin cambios:
 *   npx tsx scripts/toolcribMergeDuplicates.ts --credentials=./serviceAccount.json
 *
 *   # Ejecutar:
 *   npx tsx scripts/toolcribMergeDuplicates.ts --credentials=./serviceAccount.json --execute
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { argv, exit } from 'node:process';

import { config as loadEnv } from 'dotenv';
loadEnv({ path: resolvePath(process.cwd(), '.env.local'), override: true });

import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// ─────────────────────────────────────────────
//  Pares a fusionar  (canónico ← duplicado)
// ─────────────────────────────────────────────

interface MergePair {
  description: string;
  canonical: { partId: string; drawingId: string; partNumber: string };
  duplicate: { partId: string; drawingId: string; partNumber: string };
}

const MERGE_PAIRS: MergePair[] = [
  {
    description: 'BLADE PIN vs BLADE PIN VERSION OBSOLETA',
    canonical:  { partId: 'part_23aee2d4363ced15',   drawingId: 'drw_609e716e0bebfc072f74',   partNumber: 'BLADE PIN' },
    duplicate:  { partId: 'part_ecc8c7ba6c9a74be',   drawingId: 'drw_0eaea298600f8f3d58e6',   partNumber: 'BLADE PIN VERSION OBSOLETA' },
  },
  {
    description: '90-3354REV2 vs 90-3354REV2-TORNILLO-PARA-HUSILLO',
    canonical:  { partId: 'part_4f0acbb3c4162dc1',   drawingId: 'drw_527e02a455401e02773c',   partNumber: '90-3354REV2' },
    duplicate:  { partId: 'part_baeaf7d3aea0f2dd',   drawingId: 'drw_5ab34466118fd58d0fb7',   partNumber: '90-3354REV2-TORNILLO-PARA-HUSILLO' },
  },
  {
    description: '90-3262 rev=4 vs 90-3262REV4',
    canonical:  { partId: 'part_2390c0f0762b5555',   drawingId: 'drw_55c2fd5420af493361d5',   partNumber: '90-3262' },
    duplicate:  { partId: 'part_c5745eb43a1166d7',   drawingId: 'drw_80f9e2d35e85fc119e89',   partNumber: '90-3262REV4' },
  },
  {
    description: 'HOT STAMP.ISO vs PUNZONES DE MARCA.ISO',
    canonical:  { partId: 'part_488d614a89ce083e',   drawingId: 'drw_612a7a4a29b7d4ed5b24',   partNumber: 'HOT STAMP.ISO' },
    duplicate:  { partId: 'part_a2691abada54ada1',   drawingId: 'drw_b8b8e20f57a1bae9a96f',   partNumber: 'PUNZONES DE MARCA.ISO' },
  },
  {
    description: '90-1216.ISO vs 901216 (formato viejo)',
    canonical:  { partId: 'part_0d4725af77245f70',   drawingId: 'drw_8bb59cb092748ff661f6',   partNumber: '90-1216.ISO' },
    duplicate:  { partId: '7x24h99IrXUFwbSdRZ8i',   drawingId: 'lGqNSnzwnMyvPxAirW05',        partNumber: '901216' },
  },
  {
    description: 'BLOCK UT2033 vs UT2033',
    canonical:  { partId: 'part_94b05786381c4e16',   drawingId: 'drw_fdc9f5d837942303792a',   partNumber: 'BLOCK UT2033' },
    duplicate:  { partId: 'part_53f002ee327d9e6e',   drawingId: 'drw_c14ab71f9b2756876fa9',   partNumber: 'UT2033' },
  },
];

// ─────────────────────────────────────────────
//  Firebase Admin
// ─────────────────────────────────────────────

function initAdmin(credentialsPath: string): void {
  if (getApps().length > 0) return;
  const sa = JSON.parse(readFileSync(resolvePath(credentialsPath), 'utf8')) as ServiceAccount;
  initializeApp({ credential: cert(sa) });
}

// ─────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────

async function run(): Promise<void> {
  const args = argv.slice(2);
  const execute = args.includes('--execute');
  const credArg = args.find((a) => a.startsWith('--credentials='));

  if (!credArg) {
    console.error('Uso: npx tsx scripts/toolcribMergeDuplicates.ts --credentials=./serviceAccount.json [--execute]');
    exit(1);
  }

  initAdmin(credArg.slice('--credentials='.length));
  const db = getFirestore();

  console.info(execute
    ? '[mergeDuplicates] ⚠️  MODO EXECUTE — se aplicarán cambios en Firestore.'
    : '[mergeDuplicates] MODO REPORTE — sin cambios.\n');

  const dupPartIds   = MERGE_PAIRS.map((p) => p.duplicate.partId);
  const dupDrawingIds = MERGE_PAIRS.map((p) => p.duplicate.drawingId);

  // Buscar WorkOrders afectadas (chunks de 30 para el operador `in`)
  console.info('[1/3] Buscando WorkOrders que referencien los duplicados…');
  const CHUNK = 30;
  const affectedByPart    = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  const affectedByDrawing = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();

  for (let i = 0; i < dupPartIds.length; i += CHUNK) {
    const snap = await db.collection('workOrders')
      .where('matchedPartId', 'in', dupPartIds.slice(i, i + CHUNK))
      .get();
    snap.forEach((d) => {
      const key = d.data()['matchedPartId'] as string;
      affectedByPart.set(key, [...(affectedByPart.get(key) ?? []), d]);
    });
  }

  for (let i = 0; i < dupDrawingIds.length; i += CHUNK) {
    const snap = await db.collection('workOrders')
      .where('matchedDrawingId', 'in', dupDrawingIds.slice(i, i + CHUNK))
      .get();
    snap.forEach((d) => {
      const key = d.data()['matchedDrawingId'] as string;
      affectedByDrawing.set(key, [...(affectedByDrawing.get(key) ?? []), d]);
    });
  }

  // Reporte por par
  console.info('\n[2/3] Plan de operaciones:\n');
  let totalWoUpdates = 0;

  for (const pair of MERGE_PAIRS) {
    const woByPart    = affectedByPart.get(pair.duplicate.partId) ?? [];
    const woByDrawing = affectedByDrawing.get(pair.duplicate.drawingId) ?? [];
    const woCount = new Set([...woByPart.map((d) => d.id), ...woByDrawing.map((d) => d.id)]).size;
    totalWoUpdates += woCount;

    console.info(`  ▸ ${pair.description}`);
    console.info(`    CONSERVAR : partId=${pair.canonical.partId}  drawingId=${pair.canonical.drawingId}`);
    console.info(`    ELIMINAR  : partId=${pair.duplicate.partId}  drawingId=${pair.duplicate.drawingId}`);
    console.info(`    WorkOrders afectadas: ${woCount}`);
    console.info('');
  }

  console.info(`  Total WorkOrders a redirigir: ${totalWoUpdates}`);

  if (!execute) {
    console.info('\n→ Ejecuta con --execute para aplicar.');
    return;
  }

  // ── Ejecutar ──
  console.info('\n[3/3] Aplicando cambios…');

  for (const pair of MERGE_PAIRS) {
    console.info(`\n  Procesando: ${pair.description}`);

    const woByPart    = affectedByPart.get(pair.duplicate.partId) ?? [];
    const woByDrawing = affectedByDrawing.get(pair.duplicate.drawingId) ?? [];

    // Unificar los docs de workOrders afectados (puede haber overlap)
    const woMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    [...woByPart, ...woByDrawing].forEach((d) => woMap.set(d.id, d));

    // Redirigir WorkOrders
    if (woMap.size > 0) {
      const batch = db.batch();
      for (const wo of woMap.values()) {
        const update: Record<string, unknown> = { updatedAtUTC: FieldValue.serverTimestamp() };
        if (wo.data()['matchedPartId']    === pair.duplicate.partId)    update['matchedPartId']    = pair.canonical.partId;
        if (wo.data()['matchedDrawingId'] === pair.duplicate.drawingId) update['matchedDrawingId'] = pair.canonical.drawingId;
        batch.update(wo.ref, update);
      }
      await batch.commit();
      console.info(`    ✓ ${woMap.size} WorkOrders redirigidas → ${pair.canonical.partId}`);
    }

    // Eliminar drawing duplicado
    await db.collection('toolcribDrawings').doc(pair.duplicate.drawingId).delete();
    console.info(`    ✓ Drawing eliminado: ${pair.duplicate.drawingId}`);

    // Archivar part duplicado (conserva historial en printLogs)
    await db.collection('toolcribParts').doc(pair.duplicate.partId).update({
      status: 'archived',
      updatedAtUTC: FieldValue.serverTimestamp(),
    });
    console.info(`    ✓ Part archivado: ${pair.duplicate.partId} (${pair.duplicate.partNumber})`);
  }

  console.info('\n[mergeDuplicates] ✓ Limpieza completada.');
}

run().catch((err: unknown) => {
  console.error('[mergeDuplicates] Error fatal:', err instanceof Error ? err.message : String(err));
  exit(1);
});
