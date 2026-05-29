/* Verificación pura de dedupe. Correr: npx tsx scripts/verify/workOrdersDedupe.ts */
import { buildDedupeKey, mergeUpsert, type UpsertMutableFields } from '../../src/lib/workOrders/dedupe';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { failures += 1; console.error('  FAIL:', msg); }
  else { console.log('  ok:', msg); }
}

const f: UpsertMutableFields = {
  cantidad: '2', prioridad: 'Normal', matchedDrawingId: null, matchedPartId: null,
  matchScore: null, otDate: '2026-05-01', poNumber: 'PO-1', soNumber: 'SO-1',
};

// buildDedupeKey
assert(
  buildDedupeKey({ soNumber: 'SO-100', poNumber: 'PO-9', numeroParte: '90-1012-05', pieza: 'X' })
    === 'SO-100::90-1012-05',
  'usa SO + número de parte',
);
assert(
  buildDedupeKey({ soNumber: '', poNumber: 'PO-9', numeroParte: '', pieza: 'Buje 3/8' })
    === 'PO-9::BUJE 3/8',
  'cae a PO + pieza cuando faltan SO y parte',
);
assert(
  buildDedupeKey({ soNumber: 'SO 200\nSO 201', poNumber: '', numeroParte: 'A1', pieza: 'X' })
    === 'SO 200::A1',
  'toma la primera línea del SO multi-línea',
);

// mergeUpsert: create vs update + preserva (no marca borrados) + colapsa lote
const existing = new Map([['SO-1::A1', { id: 'doc-1' }]]);
const res = mergeUpsert(existing, [
  { key: 'SO-1::A1', fields: f },   // existe -> update
  { key: 'SO-2::B2', fields: f },   // nuevo  -> create
  { key: 'SO-2::B2', fields: f },   // duplicado en lote -> ignorado
]);
assert(res.toUpdate.length === 1 && res.toUpdate[0].id === 'doc-1', 'actualiza el existente por id');
assert(res.toCreate.length === 1 && res.toCreate[0] === 'SO-2::B2', 'crea solo el nuevo, una vez');

if (failures > 0) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('\nTODO OK');
