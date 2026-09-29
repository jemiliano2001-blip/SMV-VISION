/**
 * Detección y emparejamiento de planos complementarios, piezas en par y planos de múltiples hojas.
 *
 * Resuelve:
 * 1. Múltiples hojas de un mismo plano (ej. 90-1012-06 y 90-1012-06-2).
 * 2. Piezas que se fabrican/venden en par o mitades (ej. 1012-05-chico y 1012-05-grande).
 * 3. Variantes en par o juegos (ej. 4150-06-corto y 4150-06-largo / -A y -B).
 * 4. Navajas y ensambles con complementos (ej. Navaja Artos 143272 y 143272 Complemento).
 */

import type { ToolcribActiveDrawingView } from '../types';
import { isIsoDrawingView } from './matching';
import { canonicalPartNumber } from './toolcribCatalog';
import { companionsFromSet, getActiveSets, type ToolcribSet } from './toolcribSets';

export type CompanionType = 'sheet' | 'pair' | 'complement' | 'variant';

export interface CompanionInfo {
  drawing: ToolcribActiveDrawingView;
  type: CompanionType;
  label: string;
  order: number;
  /** Piezas de este plano por cada juego pedido (solo juegos guardados; por defecto 1). */
  cantidadPorJuego?: number;
}

/** Reglas explícitas de emparejamiento para piezas conocidas del taller. */
interface KnownCompanionRule {
  /** Patrón de la pieza base o de cualquiera del grupo */
  match: RegExp;
  /** Identificador de grupo para asociar las partes hermanas */
  groupKey: string;
  type: CompanionType;
  /** Deduce la etiqueta para el plano complementario */
  getLabel: (partNumber: string, isBase: boolean) => string;
  /** Orden preferido de visualización / impresión */
  getOrder: (partNumber: string) => number;
}

const KNOWN_RULES: KnownCompanionRule[] = [
  // 1. 90-1012-06 (Punzón de corte - 2 hojas de blueprints)
  {
    match: /^(90-)?1012-0?6(-2)?$/i,
    groupKey: '90-1012-06',
    type: 'sheet',
    getLabel: (p, isBase) => (p.includes('-2') || !isBase ? 'Hoja 2 (Componente secundario)' : 'Hoja 1 (Plano base)'),
    getOrder: (p) => (p.includes('-2') ? 2 : 1),
  },

  // 2. 90-1012-05 (Hex Swage Block - Chico y Grande)
  {
    match: /^(90-)?1012-0?5(-(chico|grande|001))?$/i,
    groupKey: '90-1012-05',
    type: 'pair',
    getLabel: (p) => {
      const upper = p.toUpperCase();
      if (upper.includes('CHICO')) return 'Par: Mitad Chica';
      if (upper.includes('GRANDE')) return 'Par: Mitad Grande';
      return 'Juego 1012-05';
    },
    getOrder: (p) => {
      const upper = p.toUpperCase();
      if (upper.includes('CHICO') || !upper.includes('GRANDE')) return 1;
      return 2;
    },
  },

  // 3. 90-4150-06 (Gavilanes en set - Corto y Largo / Variante A y B)
  {
    match: /^(90-)?4150-0?6(\s*[-_ ]\s*(corto|largo|[ab]))?$/i,
    groupKey: '90-4150-06',
    type: 'pair',
    getLabel: (p) => {
      const upper = p.toUpperCase();
      if (upper.includes('CORTO') || upper.includes('-A') || upper.includes(' -A')) return 'Par: Gavilán Corto (-A)';
      if (upper.includes('LARGO') || upper.includes('-B') || upper.includes(' -B')) return 'Par: Gavilán Largo (-B)';
      return 'Gavilán 4150-06';
    },
    getOrder: (p) => {
      const upper = p.toUpperCase();
      if (upper.includes('CORTO') || upper.includes('-A')) return 1;
      return 2;
    },
  },

  // 4. Navajas Artos 143272 (Base y Complemento)
  {
    match: /(143272|NAVAJA\s*ARTOS)/i,
    groupKey: 'NAVAJA-ARTOS-143272',
    type: 'complement',
    getLabel: (p) => (p.toUpperCase().includes('COMPLEMENTO') ? 'Cuchilla Complemento' : 'Cuchilla Base'),
    getOrder: (p) => (p.toUpperCase().includes('COMPLEMENTO') ? 2 : 1),
  },
];

/** groupKey de la regla fija que aplica a la pieza (O(4)); sirve para la insignia de la Biblioteca. */
export function knownRuleGroupKey(partNumber: string): string | null {
  const canonical = canonicalPartNumber(partNumber).toUpperCase().trim();
  return KNOWN_RULES.find((rule) => rule.match.test(canonical))?.groupKey ?? null;
}

/**
 * Normaliza un número de parte para extraer la raíz común antes de sufijos de hojas o pares.
 * Ej: "90-1012-06-2" -> "90-1012-06", "4150-06-CORTO" -> "4150-06".
 */
export function extractBasePartRoot(partNumber: string): string {
  let clean = canonicalPartNumber(partNumber).toUpperCase().trim();
  clean = clean.replace(/[-_ ]+(MOD|REV).*$/i, '').trim();
  if (/[-_ ]+(COMPLEMENTO|COMPLEMENT)$/i.test(clean)) {
    return clean.replace(/[-_ ]+(COMPLEMENTO|COMPLEMENT)$/i, '').trim();
  }
  return clean
    .replace(/[-_ ]+(CHICO|GRANDE|CHICA|MAYOR|MENOR)$/i, '')
    .replace(/[-_ ]+(CORTO|LARGO|CORTA|LARGA)$/i, '')
    .replace(/[-_ ]+([AB])$/i, '')
    .replace(/[-_ ]+([2-5])$/i, '')
    .trim();
}

/**
 * Encuentra todos los planos complementarios (hojas secundarias, pares o complementos)
 * para un plano base dado dentro del catálogo.
 *
 * @param base Dibujo activo base o número de parte
 * @param library Catálogo activo de dibujos
 * @param sets Juegos guardados; por defecto getActiveSets()
 * @returns Lista ordenada de planos complementarios (excluyendo el plano base)
 */
export function findCompanionDrawings(
  base: ToolcribActiveDrawingView | string,
  library: readonly ToolcribActiveDrawingView[],
  sets: readonly ToolcribSet[] = getActiveSets(),
): CompanionInfo[] {
  // 0. Un juego guardado por el operador siempre gana sobre las reglas fijas.
  const saved = companionsFromSet(base, library, sets);
  if (saved) return saved;

  const basePart = typeof base === 'string' ? base : base.partNumber;
  const baseDrawingId = typeof base === 'string' ? null : base.drawingId;
  const canonicalBase = canonicalPartNumber(basePart).toUpperCase().trim();

  // 1. Revisar si aplica alguna regla de pieza conocida
  const matchedRule = KNOWN_RULES.find((r) => r.match.test(canonicalBase));
  const companions: CompanionInfo[] = [];

  if (matchedRule) {
    for (const view of library) {
      if (baseDrawingId && view.drawingId === baseDrawingId) continue;
      // Los compañeros para impresión de OT deben ser planos de taller (no ISOs)
      if (isIsoDrawingView(view)) continue;

      const viewPart = canonicalPartNumber(view.partNumber).toUpperCase().trim();
      // Si la pieza candidata no es la base pero coincide con la misma regla
      if (matchedRule.match.test(viewPart) && viewPart !== canonicalBase) {
        companions.push({
          drawing: view,
          type: matchedRule.type,
          label: matchedRule.getLabel(view.partNumber, false),
          order: matchedRule.getOrder(view.partNumber),
        });
      }
    }

    if (companions.length > 0) {
      companions.sort((a, b) => a.order - b.order || a.drawing.partNumber.localeCompare(b.drawing.partNumber));
      return companions;
    }
  }

  // 2. Reglas genéricas basadas en prefijos y convenciones estándar de SolidWorks/Taller
  const baseRoot = extractBasePartRoot(canonicalBase);
  if (!baseRoot || baseRoot.length < 4) return [];

  for (const view of library) {
    if (baseDrawingId && view.drawingId === baseDrawingId) continue;
    if (isIsoDrawingView(view)) continue;

    const viewPart = canonicalPartNumber(view.partNumber).toUpperCase().trim();
    if (viewPart === canonicalBase) continue;

    const viewRoot = extractBasePartRoot(viewPart);
    if (viewRoot === baseRoot) {
      // Determinar el tipo de relación
      let type: CompanionType = 'variant';
      let label = view.partNumber;
      let order = 2;

      if (/[-_ ](2|3|4|5)$/i.test(viewPart) || /HOJA\s*2/i.test(view.description || '')) {
        type = 'sheet';
        const sheetNum = viewPart.match(/[-_ ]([2-5])$/)?.[1] ?? '2';
        label = `Hoja ${sheetNum}`;
        order = Number(sheetNum);
      } else if (/CHICO|GRANDE/i.test(viewPart)) {
        type = 'pair';
        label = viewPart.includes('CHICO') ? 'Par: Chico' : 'Par: Grande';
        order = viewPart.includes('CHICO') ? 1 : 2;
      } else if (/CORTO|LARGO/i.test(viewPart) || /[-_ ][AB]$/i.test(viewPart)) {
        type = 'pair';
        label = viewPart.includes('CORTO') || viewPart.endsWith('-A') ? 'Par: Corto (-A)' : 'Par: Largo (-B)';
        order = viewPart.includes('CORTO') || viewPart.endsWith('-A') ? 1 : 2;
      } else if (/COMPLEMENTO/i.test(viewPart) || /COMPLEMENTO/i.test(view.description || '')) {
        type = 'complement';
        label = 'Complemento';
        order = 2;
      }

      companions.push({
        drawing: view,
        type,
        label,
        order,
      });
    }
  }

  companions.sort((a, b) => a.order - b.order || a.drawing.partNumber.localeCompare(b.drawing.partNumber));
  return companions;
}

/**
 * Resumen legible para el usuario de los planos que componen una orden o pieza.
 * Ej: "2 planos: 90-1012-06 (Hoja 1) + 90-1012-06-2 (Hoja 2)"
 */
export function formatCompanionsSummary(basePart: string, companions: readonly CompanionInfo[]): string {
  if (companions.length === 0) return basePart;
  const parts = [basePart, ...companions.map((c) => `${c.drawing.partNumber} (${c.label})`)];
  return `${companions.length + 1} planos: ${parts.join(' + ')}`;
}
