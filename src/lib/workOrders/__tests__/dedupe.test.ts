import { describe, it, expect } from 'vitest';
import { buildDedupeKey, mergeUpsert } from '../dedupe';
import type { UpsertMutableFields } from '../dedupe';

describe('buildDedupeKey', () => {
  it('genera clave SO::parte cuando hay SO y número de parte', () => {
    const key = buildDedupeKey({
      soNumber: 'SO-001',
      poNumber: 'PO-100',
      numeroParte: 'WCD01-1824',
      pieza: 'HEX SWAGE BLOCK',
    });
    expect(key).toBe('SO-001::WCD01-1824');
  });

  it('usa la pieza como fallback si no hay número de parte', () => {
    const key = buildDedupeKey({
      soNumber: 'SO-001',
      poNumber: '',
      numeroParte: '',
      pieza: 'HEX SWAGE BLOCK',
    });
    expect(key).toBe('SO-001::HEX SWAGE BLOCK');
  });

  it('usa PO como fallback si no hay SO', () => {
    const key = buildDedupeKey({
      soNumber: '',
      poNumber: 'PO-100',
      numeroParte: 'WCD-001',
      pieza: 'PIEZA',
    });
    expect(key).toBe('PO-100::WCD-001');
  });

  it('usa SIN-ORDEN cuando no hay SO ni PO', () => {
    const key = buildDedupeKey({
      soNumber: '',
      poNumber: '',
      numeroParte: 'WCD-001',
      pieza: 'PIEZA',
    });
    expect(key).toBe('SIN-ORDEN::WCD-001');
  });

  it('usa SIN-PIEZA cuando no hay numeroParte ni pieza', () => {
    const key = buildDedupeKey({
      soNumber: 'SO-001',
      poNumber: 'PO-100',
      numeroParte: '',
      pieza: '',
    });
    expect(key).toBe('SO-001::SIN-PIEZA');
  });

  it('toma solo la primera línea de SO multi-línea', () => {
    const key = buildDedupeKey({
      soNumber: 'SO-001\nSO-002',
      poNumber: '',
      numeroParte: 'WCD-001',
      pieza: '',
    });
    expect(key).toBe('SO-001::WCD-001');
  });

  it('toma solo la primera línea de PO multi-línea', () => {
    const key = buildDedupeKey({
      soNumber: '',
      poNumber: 'PO-100\r\nPO-101',
      numeroParte: 'PART-X',
      pieza: '',
    });
    expect(key).toBe('PO-100::PART-X');
  });

  it('genera la misma clave para el mismo input (idempotente)', () => {
    const input = {
      soNumber: 'SO-001',
      poNumber: 'PO-100',
      numeroParte: 'WCD-001',
      pieza: 'HEX',
    };
    expect(buildDedupeKey(input)).toBe(buildDedupeKey(input));
  });

  it('normaliza diacríticos', () => {
    const key1 = buildDedupeKey({
      soNumber: 'SO-001',
      poNumber: '',
      numeroParte: 'CAFÉ',
      pieza: '',
    });
    const key2 = buildDedupeKey({
      soNumber: 'SO-001',
      poNumber: '',
      numeroParte: 'CAFE',
      pieza: '',
    });
    expect(key1).toBe(key2);
    expect(key1).toBe('SO-001::CAFE');
  });

  it('maneja strings vacíos y null-like values', () => {
    const key = buildDedupeKey({
      soNumber: '',
      poNumber: '',
      numeroParte: '',
      pieza: '',
    });
    expect(key).toBe('SIN-ORDEN::SIN-PIEZA');
  });
});

describe('mergeUpsert', () => {
  const fields: UpsertMutableFields = {
    cantidad: '5\nPieza',
    prioridad: 'Normal',
    matchedDrawingId: 'draw-1',
    matchedPartId: 'part-1',
    matchScore: 95,
    otDate: '2025-06-01',
    poNumber: 'PO-100',
    soNumber: 'SO-001',
  };

  it('identifica nuevas llaves como toCreate', () => {
    const result = mergeUpsert(new Map(), [{ key: 'SO-001::WCD-001', fields }]);
    expect(result.toCreate).toContain('SO-001::WCD-001');
    expect(result.toUpdate).toHaveLength(0);
  });

  it('identifica llaves existentes como toUpdate con su id', () => {
    const existing = new Map([['SO-001::WCD-001', { id: 'doc-abc' }]]);
    const result = mergeUpsert(existing, [{ key: 'SO-001::WCD-001', fields }]);
    expect(result.toCreate).toHaveLength(0);
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0].id).toBe('doc-abc');
    expect(result.toUpdate[0].fields).toEqual(fields);
  });

  it('colapsa duplicados dentro del mismo lote (misma key dos veces)', () => {
    const result = mergeUpsert(new Map(), [
      { key: 'SO-001::WCD-001', fields },
      { key: 'SO-001::WCD-001', fields },
    ]);
    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0]).toBe('SO-001::WCD-001');
  });

  it('mezcla creaciones y actualizaciones en un solo lote', () => {
    const existing = new Map([['SO-001::WCD-001', { id: 'doc-abc' }]]);
    const fields2: UpsertMutableFields = {
      ...fields,
      soNumber: 'SO-002',
      poNumber: 'PO-101',
    };
    const result = mergeUpsert(existing, [
      { key: 'SO-001::WCD-001', fields },
      { key: 'SO-002::WCD-002', fields: fields2 },
    ]);
    expect(result.toCreate).toHaveLength(1);
    expect(result.toCreate[0]).toBe('SO-002::WCD-002');
    expect(result.toUpdate).toHaveLength(1);
    expect(result.toUpdate[0].id).toBe('doc-abc');
  });

  it('nunca marca nada para eliminar', () => {
    const existing = new Map([
      ['SO-001::WCD-001', { id: 'doc-abc' }],
      ['SO-002::WCD-002', { id: 'doc-def' }],
    ]);
    const result = mergeUpsert(existing, []); // sin incoming
    expect(result.toCreate).toHaveLength(0);
    expect(result.toUpdate).toHaveLength(0);
  });

  it('preserva el orden del lote incoming en toCreate', () => {
    const result = mergeUpsert(new Map(), [
      { key: 'SO-001::WCD-001', fields },
      { key: 'SO-002::WCD-002', fields },
      { key: 'SO-003::WCD-003', fields },
    ]);
    expect(result.toCreate).toEqual(['SO-001::WCD-001', 'SO-002::WCD-002', 'SO-003::WCD-003']);
  });

  it('acepta ReadonlyMap', () => {
    const existing: ReadonlyMap<string, { id: string }> = new Map([
      ['SO-001::WCD-001', { id: 'doc-abc' }],
    ]);
    const result = mergeUpsert(existing, [{ key: 'SO-002::WCD-002', fields }]);
    expect(result.toCreate).toHaveLength(1);
    expect(result.toUpdate).toHaveLength(0);
  });

  it('acepta ReadonlyArray de incoming', () => {
    const incoming: ReadonlyArray<{ key: string; fields: UpsertMutableFields }> = [
      { key: 'SO-001::WCD-001', fields },
    ];
    const result = mergeUpsert(new Map(), incoming);
    expect(result.toCreate).toHaveLength(1);
  });
});
