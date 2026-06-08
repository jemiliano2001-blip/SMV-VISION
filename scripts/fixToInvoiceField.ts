/**
 * scripts/fixToInvoiceField.ts
 *
 * Parche de un solo uso: recorre todos los documentos en `odooSaleOrders` y
 * recalcula el campo `toInvoice` basándose en si hay al menos una línea con
 * `qty_pending > 0`, en lugar de depender solo de `invoice_status`.
 *
 * Antes del fix:
 *   toInvoice = invoice_status in ['to invoice', 'upselling']
 *
 * Después del fix:
 *   toInvoice = cualquier línea tiene qty - qty_delivered > 0
 *
 * Uso:
 *   npx tsx scripts/fixToInvoiceField.ts
 *   npx tsx scripts/fixToInvoiceField.ts --dry-run
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { argv } from 'node:process';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: resolvePath(process.cwd(), '.env.local'), override: true });

import {
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const ODOO_COLLECTION = 'odooSaleOrders';
const BATCH_SIZE = 450;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Variable de entorno requerida no definida: ${key}`);
  }
  return value.trim();
}

function hasPendingLines(orderLines: unknown[]): boolean {
  return orderLines.some((l) => {
    if (typeof l !== 'object' || l === null) return false;
    const line = l as Record<string, unknown>;
    const qty = typeof line['qty'] === 'number' ? line['qty'] : 0;
    const qtyDelivered = typeof line['qty_delivered'] === 'number' ? line['qty_delivered'] : 0;
    return (qty - qtyDelivered) > 0;
  });
}

async function run(): Promise<void> {
  const dryRun = argv.includes('--dry-run') || argv.includes('--dryRun');
  if (dryRun) {
    console.info('[fixToInvoice] Modo DRY RUN — no se escribirá en Firestore.');
  }

  const serviceAccountPath = requireEnv('FIREBASE_SERVICE_ACCOUNT_PATH');

  if (getApps().length === 0) {
    const resolved = resolvePath(serviceAccountPath);
    const serviceAccount = JSON.parse(readFileSync(resolved, 'utf8')) as ServiceAccount;
    initializeApp({ credential: cert(serviceAccount) });
  }

  const db = getFirestore();

  console.info('[fixToInvoice] Leyendo todos los documentos en odooSaleOrders…');
  const snap = await db.collection(ODOO_COLLECTION).get();
  console.info(`[fixToInvoice] ${snap.size} documentos encontrados.`);

  let toUpdate = 0;
  let alreadyCorrect = 0;
  let wouldEnable = 0;
  let wouldDisable = 0;

  const docsToUpdate: Array<{ id: string; newValue: boolean }> = [];

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const orderLines = Array.isArray(data['order_lines']) ? data['order_lines'] : [];
    const currentToInvoice = data['toInvoice'] === true;
    const shouldBeToInvoice = hasPendingLines(orderLines);

    if (currentToInvoice !== shouldBeToInvoice) {
      docsToUpdate.push({ id: doc.id, newValue: shouldBeToInvoice });
      if (shouldBeToInvoice) wouldEnable++;
      else wouldDisable++;

      if (dryRun && docsToUpdate.length <= 20) {
        const name = typeof data['name'] === 'string' ? data['name'] : doc.id;
        const status = typeof data['invoice_status'] === 'string' ? data['invoice_status'] : '?';
        console.info(
          `  ${shouldBeToInvoice ? '✅ ACTIVAR' : '🚫 DESACTIVAR'} toInvoice | ${name} | invoice_status="${status}" | ${orderLines.length} líneas`
        );
      }
    } else {
      alreadyCorrect++;
    }
  }

  console.info(`\n[fixToInvoice] Documentos a actualizar: ${docsToUpdate.length}`);
  console.info(`  ✅ Se activará toInvoice (tenían pendientes pero estaban ocultas): ${wouldEnable}`);
  console.info(`  🚫 Se desactivará toInvoice (no tienen pendientes): ${wouldDisable}`);
  console.info(`  ⟳ Ya correctos (sin cambio): ${alreadyCorrect}`);

  if (dryRun) {
    console.info('\n[fixToInvoice] Dry run completado. Ejecuta sin --dry-run para aplicar cambios.');
    return;
  }

  if (docsToUpdate.length === 0) {
    console.info('[fixToInvoice] Nada que actualizar.');
    return;
  }

  // Aplicar en batches
  for (let i = 0; i < docsToUpdate.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docsToUpdate.slice(i, i + BATCH_SIZE);
    for (const { id, newValue } of chunk) {
      const ref = db.collection(ODOO_COLLECTION).doc(id);
      batch.update(ref, {
        toInvoice: newValue,
        updatedAtUTC: FieldValue.serverTimestamp(),
      });
      toUpdate++;
    }
    await batch.commit();
    console.info(`[fixToInvoice] Batch ${Math.floor(i / BATCH_SIZE) + 1} completado (${Math.min(i + BATCH_SIZE, docsToUpdate.length)}/${docsToUpdate.length}).`);
  }

  console.info(`\n[fixToInvoice] ✓ Actualización completada. ${toUpdate} documentos modificados.`);
  console.info('[fixToInvoice] La UI ahora mostrará las órdenes con líneas pendientes independientemente de invoice_status.');
}

run().catch((err) => {
  console.error('[fixToInvoice] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
