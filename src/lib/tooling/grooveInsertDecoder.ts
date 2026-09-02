import type { DecodedGrooveInsert, GrooveStyle } from './types';

interface WidthDef {
  mm: number;
  inch: number;
  fraction: string;
  defaultRadiusMm: number;
  maxDepthMm: number;
}

const MGMN_WIDTHS: Record<string, WidthDef> = {
  '150': { mm: 1.5, inch: 0.059, fraction: '0.059" (~1/16")', defaultRadiusMm: 0.2, maxDepthMm: 12 },
  '200': { mm: 2.0, inch: 0.079, fraction: '0.079" (5/64")', defaultRadiusMm: 0.2, maxDepthMm: 16 },
  '250': { mm: 2.5, inch: 0.098, fraction: '0.098" (~3/32")', defaultRadiusMm: 0.2, maxDepthMm: 18 },
  '300': { mm: 3.0, inch: 0.118, fraction: '0.118" (~1/8")', defaultRadiusMm: 0.4, maxDepthMm: 22 },
  '400': { mm: 4.0, inch: 0.157, fraction: '0.157" (5/32")', defaultRadiusMm: 0.4, maxDepthMm: 25 },
  '500': { mm: 5.0, inch: 0.197, fraction: '0.197" (3/16")', defaultRadiusMm: 0.4, maxDepthMm: 28 },
};

const GTN_WIDTHS: Record<string, WidthDef> = {
  '2': { mm: 2.2, inch: 0.087, fraction: '0.087" (~5/64")', defaultRadiusMm: 0.2, maxDepthMm: 16 },
  '3': { mm: 3.1, inch: 0.122, fraction: '0.122" (~1/8")', defaultRadiusMm: 0.2, maxDepthMm: 20 },
  '4': { mm: 4.1, inch: 0.161, fraction: '0.161" (~5/32")', defaultRadiusMm: 0.24, maxDepthMm: 25 },
  '5': { mm: 5.1, inch: 0.208, fraction: '0.208" (~13/64")', defaultRadiusMm: 0.3, maxDepthMm: 30 },
};

function mmToFractionInch(mm: number): string {
  const inches = mm / 25.4;
  if (inches < 0.02) return `${inches.toFixed(4)}" (R 1/64")`;
  if (inches < 0.04) return `${inches.toFixed(4)}" (R 1/32")`;
  if (inches < 0.06) return `${inches.toFixed(4)}" (R 3/64")`;
  return `${inches.toFixed(4)}"`;
}

/**
 * Decodifica códigos de insertos de ranurado y tronzado (MGMN, MRMN, MGGN, GTN, GFN).
 * Devuelve null si no coincide con ninguna designación de ranurado reconocida.
 */
export function decodeGrooveInsertCode(rawInput: string): DecodedGrooveInsert | null {
  if (!rawInput) return null;
  const clean = rawInput.trim().toUpperCase().replace(/[\s_]+/g, '');

  // 1. Serie MGMN / MRMN / MGGN
  const mMatch = clean.match(/^(MGMN|MRMN|MGGN)(\d{3})(?:-?([A-Z0-9]+))?$/);
  if (mMatch) {
    const [, seriesRaw, widthCode, chipbreaker] = mMatch;
    const series = seriesRaw as 'MGMN' | 'MRMN' | 'MGGN';
    const widthDef = MGMN_WIDTHS[widthCode];
    if (!widthDef) return null;

    let style: GrooveStyle = 'parting_grooving';
    let styleLabel = 'Ranurado y Tronzado Plano Estándar';
    let cornerRadiusMm = widthDef.defaultRadiusMm;

    if (series === 'MRMN') {
      style = 'full_radius';
      styleLabel = 'Radio Completo (Full Radius) para Copiado y Gargantas';
      cornerRadiusMm = widthDef.mm / 2;
    } else if (series === 'MGGN') {
      style = 'polished_aluminum';
      styleLabel = 'Filo Vivo Pulido Espejo (Aluminio y Plásticos)';
    }

    const holders: string[] = [
      `Porta Exterior MGEHR 16-${widthCode.charAt(0)}D (Zanco 1" Haas ST)`,
      `Porta Exterior MGEHR 2020-${widthCode.charAt(0)} (Zanco 3/4" / 20mm)`,
      `Barra Interior MGIVR 2016-${widthCode.charAt(0)} (Barreno mín. Ø20mm)`,
    ];

    const feedIpr = widthDef.inch <= 0.08 ? '0.002" - 0.004" IPR' : '0.003" - 0.006" IPR';

    return {
      rawCode: rawInput,
      series,
      widthMm: widthDef.mm,
      widthInch: widthDef.inch,
      widthFraction: widthDef.fraction,
      cornerNoseRadiusMm: cornerRadiusMm,
      cornerNoseRadiusInch: mmToFractionInch(cornerRadiusMm),
      style,
      styleLabel,
      maxDepthCutMm: widthDef.maxDepthMm,
      maxDepthCutInch: `${(widthDef.maxDepthMm / 25.4).toFixed(3)}"`,
      recommendedFeedIpr: feedIpr,
      chipbreaker: chipbreaker || 'M (Uso General)',
      compatibleHolders: holders,
    };
  }

  // 2. Serie GTN / GFN (Self-Grip estilo Iscar / Kennametal)
  const gMatch = clean.match(/^(GTN|GFN)-?(\d)(?:-?([A-Z0-9]+))?$/);
  if (gMatch) {
    const [, seriesRaw, sizeCode, chipbreaker] = gMatch;
    const series = seriesRaw as 'GTN' | 'GFN';
    const widthDef = GTN_WIDTHS[sizeCode];
    if (!widthDef) return null;

    const holders: string[] = [
      `Lama de Tronzado SGIH 26-${sizeCode} / SGIH 32-${sizeCode}`,
      `Bloque Porta-Lamas para Torno Haas (Zanco 1" / 3/4")`,
    ];

    return {
      rawCode: rawInput,
      series,
      widthMm: widthDef.mm,
      widthInch: widthDef.inch,
      widthFraction: widthDef.fraction,
      cornerNoseRadiusMm: widthDef.defaultRadiusMm,
      cornerNoseRadiusInch: mmToFractionInch(widthDef.defaultRadiusMm),
      style: 'parting_grooving',
      styleLabel: `${series === 'GTN' ? 'Self-Grip Estándar' : 'Self-Grip Rectificado'} de Tronzado Rápido`,
      maxDepthCutMm: widthDef.maxDepthMm,
      maxDepthCutInch: `${(widthDef.maxDepthMm / 25.4).toFixed(3)}"`,
      recommendedFeedIpr: '0.002" - 0.005" IPR',
      chipbreaker: chipbreaker || 'W (Uso General)',
      compatibleHolders: holders,
    };
  }

  return null;
}
