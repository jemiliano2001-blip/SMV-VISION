import { config } from 'dotenv';
config({ path: '.env.local' });
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
  const sos = ['2026/S00806', '2026/S00536', '2026/S00529'];
  for (const so of sos) {
    const doc = await db.collection('odooSaleOrders').doc(so.replace(/\//g, '_')).get();
    if (doc.exists) {
      console.log(`${so}: ${doc.data()?.invoice_status}`);
    } else {
      console.log(`${so}: NOT FOUND`);
    }
  }
}
run();
