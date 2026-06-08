import { config } from 'dotenv';
config({ path: '.env.local' });
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
  const snap = await db.collection('odooSaleOrders').get();
  
  let validOrders = 0;
  let validLines = 0;
  
  snap.forEach(doc => {
    const data = doc.data();
    const status = data.invoice_status;
    const lines = data.order_lines || [];
    
    // Nueva logica propuesta: NO esta facturado Y tiene lineas pendientes
    if (status !== 'invoiced') {
      const hasPending = lines.some((l: any) => (l.qty - l.qty_delivered) > 0);
      if (hasPending) {
        validOrders++;
        lines.forEach((l: any) => {
          if ((l.qty - l.qty_delivered) > 0 && l.qty > 0) {
            validLines++;
          }
        });
      }
    }
  });
  
  console.log(`Orders that are NOT invoiced AND have pending qty: ${validOrders}`);
  console.log(`Lines inside those orders with pending qty: ${validLines}`);
}
run();
