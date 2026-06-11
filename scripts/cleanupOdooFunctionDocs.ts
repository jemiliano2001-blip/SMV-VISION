/**
 * scripts/cleanupOdooFunctionDocs.ts
 *
 * Limpieza única de los documentos basura que la Cloud Function retirada
 * `syncSuprajitOrders` escribió en `workOrders`: encabezados crudos de Odoo
 * (`name`, `date_order`, `amount_total`, `state`, `lastSyncAt`) con doc ID =
 * nombre de la orden. Esos docs carecen de `status` y `archived`, por lo que
 * el tablero nunca los mostró, pero ensucian la colección.
 *
 * Criterio de detección (conservador — TODAS deben cumplirse):
 *   1. NO tiene `status` ni `archived` (toda OT real los tiene).
 *   2. Tiene al menos uno de los campos crudos de Odoo: `amount_total`,
 *      `state` o `name`.
 *
 * Uso:
 *   npx tsx scripts/cleanupOdooFunctionDocs.ts            # dry-run (solo lista)
 *   npx tsx scripts/cleanupOdooFunctionDocs.ts --execute  # borra en Firestore
 *
 * Requiere FIREBASE_SERVICE_ACCOUNT_PATH en .env.local.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { argv, exit } from 'node:process';

import { config as loadEnv } from 'dotenv';
loadEnv({ path: resolvePath(process.cwd(), '.env.local'), override: true });

import {
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const WORK_ORDERS_COLLECTION = 'workOrders';
const BATCH_SIZE = 450;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Variable de entorno requerida no definida o vacía: ${key}`);
  }
  return value.trim();
}

function isFunctionJunkDoc(data: Record<string, unknown>): boolean {
  const lacksWorkOrderShape = !('status' in data) && !('archived' in data);
  if (!lacksWorkOrderShape) return false;
  return 'amount_total' in data || 'state' in data || 'name' in data;
}

async function run(): Promise<void> {
  const execute = argv.includes('--execute');
  console.info(
    execute
      ? '[cleanup] Modo EXECUTE — los docs detectados se BORRARÁN.'
      : '[cleanup] Modo dry-run — solo se listan candidatos. Usa --execute para borrar.',
  );

  const serviceAccountPath = requireEnv('FIREBASE_SERVICE_ACCOUNT_PATH');
  if (getApps().length === 0) {
    const serviceAccount = JSON.parse(
      readFileSync(resolvePath(serviceAccountPath), 'utf8'),
    ) as ServiceAccount;
    initializeApp({ credential: cert(serviceAccount) });
  }
  const db = getFirestore();

  const snap = await db.collection(WORK_ORDERS_COLLECTION).get();
  console.info(`[cleanup] ${snap.size} docs en ${WORK_ORDERS_COLLECTION}.`);

  const junk = snap.docs.filter((d) => isFunctionJunkDoc(d.data()));

  if (junk.length === 0) {
    console.info('[cleanup] No se encontraron docs basura de la Cloud Function. Nada que hacer.');
    return;
  }

  console.info(`[cleanup] ${junk.length} docs basura detectados:`);
  for (const d of junk) {
    const data = d.data();
    console.info(
      `  - ${d.id}` +
        ` | name: ${typeof data['name'] === 'string' ? data['name'] : '—'}` +
        ` | state: ${typeof data['state'] === 'string' ? data['state'] : '—'}` +
        ` | amount_total: ${typeof data['amount_total'] === 'number' ? data['amount_total'] : '—'}`,
    );
  }

  if (!execute) {
    console.info('\n[cleanup] Dry-run terminado. Revisa la lista y vuelve a correr con --execute.');
    return;
  }

  let deleted = 0;
  for (let i = 0; i < junk.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const d of junk.slice(i, i + BATCH_SIZE)) {
      batch.delete(d.ref);
      deleted++;
    }
    await batch.commit();
  }
  console.info(`\n[cleanup] ✓ ${deleted} docs borrados de ${WORK_ORDERS_COLLECTION}.`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[cleanup] Error fatal:', message);
  exit(1);
});
