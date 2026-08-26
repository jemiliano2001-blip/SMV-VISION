import { describe, it, expect, beforeEach, vi } from 'vitest';

const memoryStore = new Map<string, any>();

vi.mock('idb-keyval', () => ({
  createStore: () => 'mock-store',
  get: vi.fn(async (key: string) => memoryStore.get(key)),
  set: vi.fn(async (key: string, val: any) => {
    memoryStore.set(key, val);
  }),
  del: vi.fn(async (key: string) => {
    memoryStore.delete(key);
  }),
}));

import {
  saveLatestAuditSession,
  loadLatestAuditSession,
  clearLatestAuditSession,
} from '../documentAnalysis/cache';
import type { AnalysisRunSummary } from '../../types';

describe('Audit Session Persistence (IndexedDB)', () => {
  beforeEach(async () => {
    memoryStore.clear();
    await clearLatestAuditSession();
  });

  it('saves and restores audit session successfully', async () => {
    const mockResults = [
      {
        orden: 'SO1234',
        pieza: 'PIVOT PIN',
        numero_parte: '90-1012-05',
        cantidad: '50',
        fecha: '2026-08-26',
        haSidoAuditada: true,
      },
    ];
    const mockSummary: AnalysisRunSummary = {
      totalLoaded: 1,
      totalAnalyzed: 1,
      totalAudited: 1,
      totalNonMatching: 0,
      totalOrders: 1,
    };

    await saveLatestAuditSession({
      results: mockResults as any,
      summary: mockSummary,
    });

    const loaded = await loadLatestAuditSession<any, AnalysisRunSummary>();
    expect(loaded).not.toBeNull();
    expect(loaded?.results).toHaveLength(1);
    expect((loaded?.results[0] as any)?.pieza).toBe('PIVOT PIN');
    expect(loaded?.summary?.totalAudited).toBe(1);
  });

  it('clears saved audit session on demand', async () => {
    await saveLatestAuditSession({
      results: [{ orden: 'SO9999' }] as any,
      summary: null,
    });

    let loaded = await loadLatestAuditSession();
    expect(loaded).not.toBeNull();

    await clearLatestAuditSession();
    loaded = await loadLatestAuditSession();
    expect(loaded).toBeNull();
  });
});
