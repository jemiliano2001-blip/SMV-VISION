import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDocsMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({ id: 'x' })),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  limit: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(),
}));
vi.mock('../firebase/client', () => ({ getFirestoreClient: () => ({}) }));
vi.mock('../firebase/auth', () => ({ getCurrentUserUid: () => 'uid-1' }));
vi.mock('../firebase/env', () => ({ isToolcribDebugUnauthAllowed: () => false }));

function snapshotOf(ids: string[]) {
  const docs = ids.map((id) => ({
    id,
    data: () => ({
      nombre: `Juego ${id}`,
      tipo: 'par',
      miembros: [
        { partNumber: `${id}-A`, rol: 'a', orden: 1, cantidadPorJuego: 1 },
        { partNumber: `${id}-B`, rol: 'b', orden: 2, cantidadPorJuego: 1 },
      ],
    }),
  }));
  return { forEach: (cb: (d: (typeof docs)[number]) => void) => docs.forEach(cb) };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function load() {
  vi.resetModules();
  return import('../firebase/toolcribSets');
}

describe('ensureActiveSets', () => {
  beforeEach(() => {
    getDocsMock.mockReset();
  });

  it('un llamado forzado durante una carga en vuelo hace una segunda lectura', async () => {
    const { ensureActiveSets } = await load();
    const first = deferred<unknown>();
    getDocsMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(snapshotOf(['new']));

    const background = ensureActiveSets();
    const forced = ensureActiveSets(true);
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    first.resolve(snapshotOf(['old']));
    const result = await forced;
    await background;

    expect(getDocsMock).toHaveBeenCalledTimes(2);
    expect(result.map((s) => s.id)).toEqual(['new']);
  });

  it('un llamado normal dentro de 60 s usa la caché y reutiliza la carga en vuelo', async () => {
    const { ensureActiveSets } = await load();
    getDocsMock.mockResolvedValue(snapshotOf(['a']));

    const p1 = ensureActiveSets();
    const p2 = ensureActiveSets();
    await Promise.all([p1, p2]);
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    await ensureActiveSets();
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('una lectura fallida no sella la caché: el siguiente llamado vuelve a leer', async () => {
    const { ensureActiveSets } = await load();
    getDocsMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(snapshotOf(['a']));

    await expect(ensureActiveSets()).resolves.toEqual([]);
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    const result = await ensureActiveSets();
    expect(getDocsMock).toHaveBeenCalledTimes(2);
    expect(result.map((s) => s.id)).toEqual(['a']);
  });
});
