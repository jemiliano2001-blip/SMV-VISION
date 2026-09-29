import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, deletePreset, loadPresets, PRESETS_STORAGE_KEY, savePreset, type PresetStorage } from '../printPresets';

function memoryStorage(initial: Record<string, string> = {}): PresetStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
  };
}

const input = { nombre: 'Mi preset', modo: 'blueprint' as const, headerStyle: 'classic' as const, incluirNotasPermanentes: false, juego: 'unificado' as const };

describe('printPresets', () => {
  it('sin storage o vacío devuelve los 3 de fábrica', () => {
    expect(loadPresets(null).map((p) => p.nombre)).toEqual(['OT estándar', 'Solo pizarrón', 'Plano limpio']);
    expect(loadPresets(memoryStorage())).toHaveLength(BUILTIN_PRESETS.length);
  });

  it('el defecto de juego es una impresión por pieza', () => {
    expect(BUILTIN_PRESETS.every((p) => p.juego === 'separadas')).toBe(true);
  });

  it('guarda un preset propio y lo vuelve a cargar', () => {
    const storage = memoryStorage();
    const after = savePreset(input, storage);
    expect(after.at(-1)?.nombre).toBe('Mi preset');
    expect(loadPresets(storage).at(-1)?.juego).toBe('unificado');
  });

  it('guardar con el mismo nombre reemplaza en vez de duplicar', () => {
    const storage = memoryStorage();
    savePreset(input, storage);
    const after = savePreset({ ...input, nombre: 'mi PRESET', modo: 'both' }, storage);
    expect(after.filter((p) => !p.builtin)).toHaveLength(1);
    expect(after.at(-1)?.modo).toBe('both');
  });

  it('borra propios pero nunca los de fábrica', () => {
    const storage = memoryStorage();
    const saved = savePreset(input, storage).at(-1);
    expect(deletePreset(saved.id, storage).some((p) => p.id === saved.id)).toBe(false);
    expect(deletePreset(BUILTIN_PRESETS[0].id, storage)).toHaveLength(BUILTIN_PRESETS.length);
  });

  it('JSON corrupto o entradas inválidas caen a los de fábrica', () => {
    expect(loadPresets(memoryStorage({ [PRESETS_STORAGE_KEY]: '{no es json' }))).toHaveLength(BUILTIN_PRESETS.length);
    const bad = memoryStorage({ [PRESETS_STORAGE_KEY]: JSON.stringify([{ id: 'x', nombre: '', modo: 'raro' }, 7]) });
    expect(loadPresets(bad)).toHaveLength(BUILTIN_PRESETS.length);
  });

  it('un storage que lanza no rompe nada', () => {
    const throwing: PresetStorage = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    expect(loadPresets(throwing)).toHaveLength(BUILTIN_PRESETS.length);
    expect(() => savePreset(input, throwing)).not.toThrow();
  });
});
