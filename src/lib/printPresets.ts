/** Presets de impresión de OT guardados en localStorage (por navegador). */

import type { PlanoOtHeaderStyle, PlanoOtPrintMode } from './planoOt';

export type SetPrintMode = 'separadas' | 'unificado';

export interface PrintPreset {
  id: string;
  nombre: string;
  modo: PlanoOtPrintMode;
  headerStyle: PlanoOtHeaderStyle;
  incluirNotasPermanentes: boolean;
  juego: SetPrintMode;
  builtin?: boolean;
}

export const PRESETS_STORAGE_KEY = 'smv.printPresets.v1';
export type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const BUILTIN_PRESETS: readonly PrintPreset[] = [
  { id: 'builtin-estandar', nombre: 'OT estándar', modo: 'both', headerStyle: 'slim', incluirNotasPermanentes: true, juego: 'separadas', builtin: true },
  { id: 'builtin-pizarron', nombre: 'Solo pizarrón', modo: 'board_ticket', headerStyle: 'slim', incluirNotasPermanentes: true, juego: 'separadas', builtin: true },
  { id: 'builtin-limpio', nombre: 'Plano limpio', modo: 'blueprint', headerStyle: 'slim', incluirNotasPermanentes: false, juego: 'separadas', builtin: true },
];

const MODES: readonly PlanoOtPrintMode[] = ['blueprint', 'board_ticket', 'both'];
const HEADERS: readonly PlanoOtHeaderStyle[] = ['slim', 'classic'];
const SET_MODES: readonly SetPrintMode[] = ['separadas', 'unificado'];

function defaultStorage(): PresetStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function parseCustom(storage: PresetStorage | null): PrintPreset[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: PrintPreset[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const p = item as Record<string, unknown>;
      const nombre = typeof p.nombre === 'string' ? p.nombre.trim().slice(0, 40) : '';
      if (!nombre || typeof p.id !== 'string' || !p.id) continue;
      if (!MODES.includes(p.modo as PlanoOtPrintMode) || !HEADERS.includes(p.headerStyle as PlanoOtHeaderStyle) || !SET_MODES.includes(p.juego as SetPrintMode)) continue;
      out.push({
        id: p.id,
        nombre,
        modo: p.modo as PlanoOtPrintMode,
        headerStyle: p.headerStyle as PlanoOtHeaderStyle,
        incluirNotasPermanentes: p.incluirNotasPermanentes !== false,
        juego: p.juego as SetPrintMode,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function persist(custom: PrintPreset[], storage: PresetStorage | null): void {
  if (!storage) return;
  try {
    storage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(custom));
  } catch {
    /* storage bloqueado: el preset vive solo esta sesión */
  }
}

export function loadPresets(storage: PresetStorage | null = defaultStorage()): PrintPreset[] {
  return [...BUILTIN_PRESETS, ...parseCustom(storage)];
}

export function savePreset(input: Omit<PrintPreset, 'id' | 'builtin'>, storage: PresetStorage | null = defaultStorage()): PrintPreset[] {
  const nombre = input.nombre.trim().slice(0, 40);
  const custom = parseCustom(storage).filter((p) => p.nombre.toLowerCase() !== nombre.toLowerCase());
  custom.push({ ...input, nombre, id: `custom-${Date.now().toString(36)}` });
  persist(custom, storage);
  return [...BUILTIN_PRESETS, ...custom];
}

export function deletePreset(id: string, storage: PresetStorage | null = defaultStorage()): PrintPreset[] {
  const custom = parseCustom(storage).filter((p) => p.id !== id);
  persist(custom, storage);
  return [...BUILTIN_PRESETS, ...custom];
}
