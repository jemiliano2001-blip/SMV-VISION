/**
 * scripts/diagnoseMissingOrders.ts
 *
 * Diagnóstico: compara qué órdenes de Odoo existen en Firestore vs cuáles
 * se muestran en la UI (filtro: invoice_status in ['to invoice', 'upselling']).
 *
 * Muestra el conteo por estado de facturación y lista las órdenes "ocultas"
 * (activas pero con invoice_status diferente).
 *
 * Uso:
 *   npx tsx scripts/diagnoseMissingOrders.ts
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: resolvePath(process.cwd(), '.env.local'), override: true });

import {
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ODOO_COLLECTION = 'odooSaleOrders';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Variable de entorno requerida no definida: ${key}`);
  }
  return value.trim();
}

async function run(): Promise<void> {
  const serviceAccountPath = requireEnv('FIREBASE_SERVICE_ACCOUNT_PATH');

  if (getApps().length === 0) {
    const resolved = resolvePath(serviceAccountPath);
    const serviceAccount = JSON.parse(readFileSync(resolved, 'utf8')) as ServiceAccount;
    initializeApp({ credential: cert(serviceAccount) });
  }

  const db = getFirestore();

  console.info('[diagnose] Leyendo TODAS las órdenes en odooSaleOrders…');
  const snap = await db.collection(ODOO_COLLECTION).get();

  const byStatus = new Map<string, { count: number; orders: string[] }>();
  const allOrders: Array<{ name: string; partner: string; invoice_status: string; lines: number; pendingLines: number }> = [];

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const name = typeof data['name'] === 'string' ? data['name'] : doc.id;
    const partner = typeof data['partner'] === 'string' ? data['partner'] : '?';
    const status = typeof data['invoice_status'] === 'string' ? data['invoice_status'] : '(sin estado)';
    const lines = Array.isArray(data['order_lines']) ? data['order_lines'] : [];
    
    // Contar líneas con cantidad pendiente > 0
    const pendingLines = lines.filter((l: unknown) => {
      if (typeof l !== 'object' || l === null) return false;
      const line = l as Record<string, unknown>;
      const qty = typeof line['qty'] === 'number' ? line['qty'] : 0;
      const qtyDelivered = typeof line['qty_delivered'] === 'number' ? line['qty_delivered'] : 0;
      return (qty - qtyDelivered) > 0;
    }).length;

    if (!byStatus.has(status)) {
      byStatus.set(status, { count: 0, orders: [] });
    }
    const entry = byStatus.get(status)!;
    entry.count++;
    if (entry.orders.length < 10) entry.orders.push(name); // max 10 ejemplos por estado

    allOrders.push({ name, partner, invoice_status: status, lines: lines.length, pendingLines });
  }

  console.info('\n══════════════════════════════════════════════════════');
  console.info('RESUMEN POR invoice_status:');
  console.info('══════════════════════════════════════════════════════');
  for (const [status, { count, orders }] of [...byStatus.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const shown = (status === 'to invoice' || status === 'upselling') ? '✅ SE MUESTRA' : '❌ OCULTA';
    console.info(`  ${shown} | "${status}": ${count} órdenes`);
    console.info(`    Ejemplos: ${orders.slice(0, 5).join(', ')}`);
  }

  // Órdenes ocultas CON líneas pendientes (las más importantes)
  const hiddenWithPending = allOrders.filter(
    (o) => o.invoice_status !== 'to invoice' && o.invoice_status !== 'upselling' && o.pendingLines > 0
  );

  if (hiddenWithPending.length > 0) {
    console.info('\n══════════════════════════════════════════════════════');
    console.info(`ÓRDENES OCULTAS CON LÍNEAS PENDIENTES (${hiddenWithPending.length} total):`);
    console.info('══════════════════════════════════════════════════════');
    for (const o of hiddenWithPending.slice(0, 30)) {
      console.info(`  ${o.name} | estado: "${o.invoice_status}" | ${o.pendingLines}/${o.lines} líneas pendientes | cliente: ${o.partner}`);
    }
    if (hiddenWithPending.length > 30) {
      console.info(`  … y ${hiddenWithPending.length - 30} más`);
    }
  } else {
    console.info('\n✅ No hay órdenes ocultas con líneas pendientes.');
  }

  console.info('\n══════════════════════════════════════════════════════');
  console.info(`Total en Firestore: ${snap.size} documentos`);
  const visibleCount = (byStatus.get('to invoice')?.count ?? 0) + (byStatus.get('upselling')?.count ?? 0);
  console.info(`Visibles en la UI (to invoice + upselling): ${visibleCount}`);
  console.info(`Ocultas: ${snap.size - visibleCount}`);
}

run().catch((err) => {
  console.error('[diagnose] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
