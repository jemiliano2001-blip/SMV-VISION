import { config } from 'dotenv';
config({ path: '.env.local' });
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { buildDedupeKey } from '../src/lib/workOrders/dedupe';

const serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

function isServiceLine(product: string): boolean {
  return /servicio/i.test(product);
}

function parseOdooProduct(product: string): { numeroParte: string; pieza: string } {
  const match = /^\[([^\]]+)\]\s*(.*)/.exec(product.trim());
  if (match) {
    return { numeroParte: match[1].trim(), pieza: match[2].trim() || product.trim() };
  }
  return { numeroParte: '', pieza: product.trim() };
}

async function run() {
  const snap = await db.collection('odooSaleOrders').where('toInvoice', '==', true).get();
  let seenKeys = new Set<string>();
  let duplicateCount = 0;
  
  snap.forEach(doc => {
    const order = doc.data();
    const lines = order.order_lines || [];
    
    lines.forEach((line: any) => {
      if (line.qty <= 0) return;
      
      const effectiveProduct = isServiceLine(line.product)
        ? (line.description || line.product)
        : line.product;
        
      if (!effectiveProduct.trim()) return;
      
      const { numeroParte, pieza } = parseOdooProduct(effectiveProduct);
      const key = buildDedupeKey({
        soNumber: order.name,
        poNumber: order.client_order_ref ?? '',
        numeroParte,
        pieza,
      });
      
      if (seenKeys.has(key)) {
        duplicateCount++;
        console.log(`Duplicate found: ${key}`);
      } else {
        seenKeys.add(key);
      }
    });
  });
  console.log(`Total unique keys: ${seenKeys.size}`);
  console.log(`Duplicates collapsed: ${duplicateCount}`);
}
run();
