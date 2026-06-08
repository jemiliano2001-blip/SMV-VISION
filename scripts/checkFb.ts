import * as admin from 'firebase-admin';
import 'dotenv/config';

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(process.env.FIREBASE_SERVICE_ACCOUNT_PATH!) });
}

async function run() {
  const db = admin.firestore();
  for (const so of ['2026_S00662', '2026_S00781', '2026_S00826']) {
    const doc = await db.collection('odooSaleOrders').doc(so).get();
    if (!doc.exists) { console.log(so, 'not found'); continue; }
    const data = doc.data()!;
    console.log(`\nSO: ${so}`);
    for (const l of data.order_lines) {
      console.log(`  - ${l.product} | Qty: ${l.qty} | Del: ${l.qty_delivered}`);
    }
  }
}
run().catch(console.error);
