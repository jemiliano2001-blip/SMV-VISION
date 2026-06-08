import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: resolvePath(process.cwd(), '.env.local'), override: true });
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function run() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH!;
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(resolvePath(path), 'utf8')) as ServiceAccount) });
  }
  const db = getFirestore();
  const snap = await db.collection('odooSaleOrders').get();
  const orders = snap.docs.map(d => d.data());
  const ordersToInvoice = orders.filter((o: any) => o.toInvoice === true);
  console.log(`Órdenes con toInvoice=true: ${ordersToInvoice.length}`);
  for (const o of ordersToInvoice) {
    console.log(`  ${o.name} | invoice_status=${o.invoice_status} | lines=${(o.order_lines as unknown[])?.length ?? 0}`);
    if (o.name === '2026/S00662') {
      console.log('Order lines 662:', JSON.stringify(o.order_lines, null, 2));
    }
  }
}
run().catch(console.error);
