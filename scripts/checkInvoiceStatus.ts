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
  
  let toInvoice = 0;
  let invoiced = 0;
  let noInvoice = 0;
  let upselling = 0;
  
  let noInvoiceWithPending = 0;
  let toInvoiceWithPending = 0;
  let invoicedWithPending = 0;
  
  snap.forEach(doc => {
    const data = doc.data();
    const status = data.invoice_status;
    const lines = data.order_lines || [];
    const hasPending = lines.some((l: any) => (l.qty - l.qty_delivered) > 0);
    
    if (status === 'to invoice') {
      toInvoice++;
      if (hasPending) toInvoiceWithPending++;
    } else if (status === 'invoiced') {
      invoiced++;
      if (hasPending) invoicedWithPending++;
    } else if (status === 'no') {
      noInvoice++;
      if (hasPending) noInvoiceWithPending++;
    } else if (status === 'upselling') {
      upselling++;
    }
  });
  
  console.log(`to invoice: ${toInvoice} (with pending lines: ${toInvoiceWithPending})`);
  console.log(`invoiced: ${invoiced} (with pending lines: ${invoicedWithPending})`);
  console.log(`no: ${noInvoice} (with pending lines: ${noInvoiceWithPending})`);
  console.log(`upselling: ${upselling}`);
}
run();
