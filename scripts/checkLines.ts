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
  console.log(`Found ${snap.size} active orders.`);
  let totalLines = 0;
  let totalQty = 0;
  let noPart = 0;
  let validLines = 0;
  snap.forEach(doc => {
    const data = doc.data();
    const lines = data.order_lines || [];
    totalLines += lines.length;
    lines.forEach(l => {
      if (l.qty <= 0) return;
      
      const isService = /servicio/i.test(l.product);
      const effectiveProduct = isService ? (l.description || l.product) : l.product;
      
      if (!effectiveProduct.trim()) {
        noPart++;
        return;
      }
      
      validLines++;
      totalQty += l.qty;
    });
  });
  console.log(`Total lines in Odoo order_lines array: ${totalLines}`);
  console.log(`Valid lines that should become OTs: ${validLines}`);
  console.log(`Skipped due to empty product: ${noPart}`);
}
run();
