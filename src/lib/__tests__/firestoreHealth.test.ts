import { beforeEach, describe, expect, it, vi } from 'vitest';

const onSnapshotMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
}));
vi.mock('../firebase/client', () => ({ getFirestoreClient: () => ({}) }));

import {
  __resetFirestoreHealthForTests,
  isFirestoreClientDead,
  isFirestoreClientDeadError,
  subscribeFirestoreHealth,
  watchFirestoreClientHealth,
} from '../firebase/firestoreHealth';
import { subscribeToOdooSyncMeta } from '../firebase/syncMeta';

const DEAD_ERROR = new Error(
  'FIRESTORE (12.12.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) CONTEXT: {"Pc":"ca9"}',
);

function eventWith(type: string, fields: Record<string, unknown>): Event {
  return Object.assign(new Event(type), fields);
}

describe('isFirestoreClientDeadError', () => {
  it('reconoce la aserción interna del SDK', () => {
    expect(isFirestoreClientDeadError(DEAD_ERROR)).toBe(true);
  });

  it('no confunde otros errores', () => {
    expect(isFirestoreClientDeadError(new Error('Missing or insufficient permissions.'))).toBe(false);
    expect(isFirestoreClientDeadError(new Error('INTERNAL ASSERTION FAILED en otra librería'))).toBe(false);
    expect(isFirestoreClientDeadError('texto')).toBe(false);
    expect(isFirestoreClientDeadError(undefined)).toBe(false);
  });
});

describe('watchFirestoreClientHealth', () => {
  beforeEach(() => __resetFirestoreHealthForTests());

  it('marca el cliente como muerto con un rechazo sin manejar y avisa una vez', () => {
    const target = new EventTarget();
    const listener = vi.fn();
    subscribeFirestoreHealth(listener);
    watchFirestoreClientHealth(target);

    target.dispatchEvent(eventWith('unhandledrejection', { reason: DEAD_ERROR }));
    target.dispatchEvent(eventWith('unhandledrejection', { reason: DEAD_ERROR }));

    expect(isFirestoreClientDead()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('marca el cliente como muerto con un error sin capturar', () => {
    const target = new EventTarget();
    watchFirestoreClientHealth(target);
    target.dispatchEvent(eventWith('error', { error: DEAD_ERROR }));
    expect(isFirestoreClientDead()).toBe(true);
  });

  it('ignora errores ajenos a Firestore', () => {
    const target = new EventTarget();
    watchFirestoreClientHealth(target);
    target.dispatchEvent(eventWith('unhandledrejection', { reason: new Error('otra cosa') }));
    target.dispatchEvent(eventWith('error', { error: new Error('otra cosa') }));
    expect(isFirestoreClientDead()).toBe(false);
  });
});

describe('subscribeToOdooSyncMeta con el cliente muerto', () => {
  beforeEach(() => {
    __resetFirestoreHealthForTests();
    onSnapshotMock.mockReset();
  });

  it('el cleanup no lanza aunque el unsubscribe del SDK lance (crash original)', () => {
    onSnapshotMock.mockReturnValue(() => {
      throw DEAD_ERROR;
    });
    const unsubscribe = subscribeToOdooSyncMeta(() => {});

    expect(() => unsubscribe()).not.toThrow();
    expect(isFirestoreClientDead()).toBe(true);
  });

  it('suscribirse no lanza si el SDK ya está muerto y reporta estado error', () => {
    onSnapshotMock.mockImplementation(() => {
      throw DEAD_ERROR;
    });
    const cb = vi.fn();

    expect(() => subscribeToOdooSyncMeta(cb)()).not.toThrow();
    expect(cb).toHaveBeenCalledWith(null, 'error');
    expect(isFirestoreClientDead()).toBe(true);
  });

  it('un fallo ajeno al desuscribir tampoco tumba la app ni marca el cliente como muerto', () => {
    onSnapshotMock.mockReturnValue(() => {
      throw new Error('otra cosa');
    });
    const unsubscribe = subscribeToOdooSyncMeta(() => {});

    expect(() => unsubscribe()).not.toThrow();
    expect(isFirestoreClientDead()).toBe(false);
  });
});
