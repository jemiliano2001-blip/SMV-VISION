/* Correr: npx tsx scripts/verify/workOrderValidators.ts */
import { normalizeWorkOrder, normalizeTornero, sanitizeTorneroName } from '../../src/lib/firebase/workOrderValidators';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { failures += 1; console.error('  FAIL:', msg); }
  else { console.log('  ok:', msg); }
}

assert(normalizeWorkOrder('', { pieza: 'X' }) === null, 'rechaza id vacío');
assert(normalizeWorkOrder('w1', { pieza: '' }) === null, 'rechaza pieza vacía');

const w = normalizeWorkOrder('w1', {
  pieza: 'BUJE', poNumber: 'PO-1', soNumber: 'SO-1', otDate: '2026-05-01',
  cantidad: '2', prioridad: 'URGENTE', status: 'entregada', matchScore: 95,
  deliveredToTornero: 'Juan', deliveredByUid: 'uid-1',
});
assert(w !== null && w.status === 'entregada' && w.prioridad === 'URGENTE', 'normaliza estado/prioridad');
assert(w !== null && w.customer === 'SUPRAJIT', 'customer default SUPRAJIT');
assert(w !== null && w.matchScore === 95 && w.matchedDrawingId === null, 'numéricos y opcionales');

const def = normalizeWorkOrder('w2', { pieza: 'X' });
assert(def !== null && def.status === 'pendiente' && def.archived === false, 'defaults pendiente/no-archivado');

assert(normalizeTornero('t1', { name: '' }) === null, 'tornero sin nombre => null');
const t = normalizeTornero('t1', { name: ' Juan  Pérez ' });
assert(t !== null && t.name === 'Juan Pérez' && t.active === true, 'tornero normaliza nombre/active');

assert(sanitizeTorneroName('   ') === null, 'nombre en blanco inválido');
assert(sanitizeTorneroName('  Ana   Lopez ') === 'Ana Lopez', 'colapsa espacios');

if (failures > 0) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('\nTODO OK');
