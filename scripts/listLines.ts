import { config } from 'dotenv';
config({ path: '.env.local' });
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
  const snap = await db.collection('odooSaleOrders').where('toInvoice', '==', true).get();
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`Order: ${data.name}`);
    const lines = data.order_lines || [];
    lines.forEach((l: any) => {
      console.log(`  - Product: ${l.product}, Qty: ${l.qty}, Delivered: ${l.qty_delivered}`);
    });
  });
}
run();
