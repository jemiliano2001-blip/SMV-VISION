import { config } from 'dotenv';
config({ path: '.env.local' });
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function run() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH!;
  if (getApps().length === 0) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(resolve(path), 'utf8'))) });
  }
  const db = getFirestore();
  const snap = await db.collection('workOrders').where('soNumber', '==', '2026/S00662').get();
  console.log(`OTs para 662: ${snap.docs.length}`);
  snap.docs.forEach(d => {
    const data = d.data();
    console.log(`  so="${data.soNumber}" | pieza="${data.pieza}" | arch=${data.archived}`);
  });
}
run().catch(console.error);
