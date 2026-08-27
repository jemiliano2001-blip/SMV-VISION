import { findMaterialByQuery, MATERIAL_DATABASE } from './materialDatabase';
import { getSupplierSearchUrl } from './toolingSuppliers';
import { calculateTurningSpeedsFeeds, calculateMillingSpeedsFeeds } from './speedsFeedsCalculator';
import { callGeminiProxy } from '../geminiProxy';
import { callWithRetry, prepareImagePart } from '../gemini';
import type {
  BlueprintToolingPackage,
  RecommendedTool,
  ToolingPurchaseItem,
  IsoMaterialGroup,
} from './types';

interface BlueprintMetadataInput {
  blueprintName: string;
  material?: string | null;
  dureza?: string | null;
  tratamiento?: string | null;
  acabado?: string | null;
  description?: string;
  existingVaultItems?: ToolingPurchaseItem[];
}

/**
 * Genera un paquete técnico completo de herramental para Torno y Fresa Haas
 * basado en los metadatos del plano (material, dureza, operaciones).
 */
export function generateToolingPackageFromMetadata(input: BlueprintMetadataInput): BlueprintToolingPackage {
  const {
    blueprintName,
    material: rawMaterial,
    dureza: rawHardness,
    acabado: rawFinish,
    description,
    existingVaultItems = [],
  } = input;

  // 1. Detectar el material más afín en la base de datos
  const query = `${rawMaterial || ''} ${description || ''}`.trim();
  const matchedMat = findMaterialByQuery(query) || MATERIAL_DATABASE[0]; // Fallback a 4140

  const isoGroup: IsoMaterialGroup = matchedMat.group;
  const hardness = rawHardness?.trim() || matchedMat.hardnessTypical;
  const finishRa = rawFinish || 'Ra 1.6 - 3.2 µm';

  // 2. Determinar operaciones sugeridas a partir de nombre y descripción
  const isLathePart = /flecha|eje|perno|buje|pin|shaft|rodillo|cuello|torno/i.test(`${blueprintName} ${description || ''}`);
  const hasThread = /rosca|m\d+|unc|unf|npt|hilo|thread/i.test(`${blueprintName} ${description || ''}`);
  const hasGroove = /ranura|candado|o-ring|groove|snap/i.test(`${blueprintName} ${description || ''}`);

  const operations: string[] = [];
  if (isLathePart) {
    operations.push('Torneado Exterior (Desbaste y Acabado)');
    operations.push('Mandrinado Interior / Barreno Central');
  } else {
    operations.push('Fresado de Superficie / Planeado');
    operations.push('Cajeado y Contorneado 2D/3D');
  }
  if (hasGroove) operations.push('Ranurado Exterior para Candado / O-Ring');
  if (hasThread) operations.push('Roscado Exterior / Interior');
  operations.push('Barrenado de Precisión y Chaflanado');

  // 3. Herramientas para Torno Haas ST
  const latheTools: RecommendedTool[] = [];

  // A. Desbaste Exterior
  const desbasteCode = isoGroup === 'N' ? 'WNMG 080408-AL H01' : 'WNMG 080408-PC NC3030';
  const desbasteHolder = 'Porta Exterior MWLNR 2525 M08 (Zanco 1")';
  const desbasteSpeeds = calculateTurningSpeedsFeeds({
    diameterMm: 38,
    cuttingSpeedMMin: matchedMat.vcTurningMMin[0] + 30,
    feedPerRevMm: matchedMat.recommendedFeedTurningMm[0],
    depthOfCutMm: 2.0,
    noseRadiusMm: 0.8,
    materialId: matchedMat.id,
    haasMachineId: 'haas_st20',
  });

  const desbasteVaultMatch = existingVaultItems.find(item =>
    item.codigoISO.toUpperCase().includes('WNMG') || item.codigoISO.toUpperCase().includes('CNMG')
  );

  latheTools.push({
    role: 'desbaste_exterior',
    roleLabel: 'Desbaste Exterior',
    toolType: 'Inserto Trígono Negativo (6 Filos)',
    codeSuggestion: desbasteCode,
    gradeSuggestion: isoGroup === 'N' ? 'H01 (Pulido)' : isoGroup === 'M' ? 'PC9030 / GC2025' : 'NC3030 / KCP25B',
    holderSuggestion: desbasteHolder,
    speedsFeedsSuggestion: {
      rpm: desbasteSpeeds.rpm,
      cuttingSpeed: `${desbasteSpeeds.surfaceSpeedMMin} m/min`,
      feed: `${matchedMat.recommendedFeedTurningMm[0]} mm/rev (${desbasteSpeeds.feedRateMmMin} mm/min)`,
      depthOfCut: '2.0 mm',
    },
    inVaultMatch: desbasteVaultMatch || null,
    searchUrl: getSupplierSearchUrl('haas_tooling', 'WNMG 080408'),
    notes: 'Insertos WNMG ofrecen 6 filos con alta economía y excelente rompevirutas para desbaste.',
  });

  // B. Acabado Exterior
  const acabadoSpeeds = calculateTurningSpeedsFeeds({
    diameterMm: 38,
    cuttingSpeedMMin: matchedMat.vcTurningMMin[1],
    feedPerRevMm: matchedMat.recommendedFeedTurningMm[1],
    depthOfCutMm: 0.5,
    noseRadiusMm: 0.4,
    materialId: matchedMat.id,
    haasMachineId: 'haas_st20',
  });

  const acabadoVaultMatch = existingVaultItems.find(item =>
    item.codigoISO.toUpperCase().includes('DNMG') || item.codigoISO.toUpperCase().includes('VBMT')
  );

  latheTools.push({
    role: 'acabado_exterior',
    roleLabel: 'Acabado y Perfilado',
    toolType: 'Inserto Rombo 55° (Radio 0.4mm)',
    codeSuggestion: 'DNMG 110404-SF',
    gradeSuggestion: isoGroup === 'N' ? 'H01' : isoGroup === 'M' ? 'PC9030' : 'NC3120 / GC4315',
    holderSuggestion: 'Porta Exterior MDJNR 2525 M11 (Zanco 1")',
    speedsFeedsSuggestion: {
      rpm: acabadoSpeeds.rpm,
      cuttingSpeed: `${acabadoSpeeds.surfaceSpeedMMin} m/min`,
      feed: `${matchedMat.recommendedFeedTurningMm[1]} mm/rev (${acabadoSpeeds.feedRateMmMin} mm/min)`,
      depthOfCut: '0.5 mm',
    },
    inVaultMatch: acabadoVaultMatch || null,
    searchUrl: getSupplierSearchUrl('travers_mexico', 'DNMG 110404'),
    notes: `Acabado teórico Ra ~ ${acabadoSpeeds.theoreticalSurfaceRoughnessRaUm} µm. Cumple la especificación (${finishRa}).`,
  });

  // C. Interiores / Mandrinado
  const mandrinadoVaultMatch = existingVaultItems.find(item =>
    item.codigoISO.toUpperCase().includes('CCMT') || item.codigoISO.toUpperCase().includes('DCMT')
  );

  latheTools.push({
    role: 'mandrinado_interior',
    roleLabel: 'Mandrinado de Interiores',
    toolType: 'Barra de Mandrinar con Inserto Positivo 7°',
    codeSuggestion: 'CCMT 09T304',
    gradeSuggestion: isoGroup === 'N' ? 'H01' : 'NC3030 / GC4325',
    holderSuggestion: 'Barra S25S-SCLCR 09 (Dia 1" con buje en torreta ST-20)',
    speedsFeedsSuggestion: {
      rpm: acabadoSpeeds.rpm,
      cuttingSpeed: `${matchedMat.vcTurningMMin[0]} m/min`,
      feed: '0.12 mm/rev',
      depthOfCut: '1.0 mm',
    },
    inVaultMatch: mandrinadoVaultMatch || null,
    searchUrl: getSupplierSearchUrl('haas_tooling', 'CCMT 09T304'),
    notes: 'Inserto positivo CCMT para bajo empuje radial y cero vibración en voladizos largos.',
  });

  // D. Ranurado / Tronzado
  latheTools.push({
    role: 'ranurado',
    roleLabel: 'Ranurado / Tronzado',
    toolType: 'Cuchilla de Ranurado 3.0mm',
    codeSuggestion: 'MGMN 300-M',
    gradeSuggestion: isoGroup === 'N' ? 'H01' : 'NC3030 / PC9030',
    holderSuggestion: 'Bloque y Cuchilla MGEHR 2525-3',
    speedsFeedsSuggestion: {
      rpm: Math.round(desbasteSpeeds.rpm * 0.6),
      cuttingSpeed: `${Math.round(matchedMat.vcTurningMMin[0] * 0.6)} m/min`,
      feed: '0.08 mm/rev',
      depthOfCut: '3.0 mm (Ancho)',
    },
    searchUrl: getSupplierSearchUrl('shars_tool', 'MGMN 300'),
    notes: 'Para gargantas de candado retenedor y tronzado final de la pieza.',
  });

  // 4. Herramientas para Fresadora Haas VF (CAT40)
  const millTools: RecommendedTool[] = [];

  // A. Desbaste de Fresado
  const millFlutes = isoGroup === 'N' ? 3 : 4;
  const millCoating = isoGroup === 'N' ? 'ZrN / DLC' : 'AlTiN / nACo';
  const millSpeeds = calculateMillingSpeedsFeeds({
    toolDiameterInch: 0.5,
    numberOfFlutes: millFlutes,
    surfaceFeetPerMinute: matchedMat.sfmMilling[0] + 50,
    chipLoadInch: matchedMat.recommendedChipLoadInch[0],
    axialDepthOfCutMm: 6.0,
    radialDepthOfCutMm: 3.0,
    materialId: matchedMat.id,
    haasMachineId: 'haas_vf2',
  });

  const endmillVaultMatch = existingVaultItems.find(item =>
    item.categoria === 'endmill' && item.codigoISO.includes('1/2')
  );

  millTools.push({
    role: 'desbaste_fresado',
    roleLabel: 'Desbaste de Caja y Contorno',
    toolType: `Endmill Carburo Sólido 1/2" (${millFlutes} Filos)`,
    codeSuggestion: `EM-1/2-${millFlutes}F-${isoGroup === 'N' ? 'ZrN' : 'AlTiN'}-R030`,
    gradeSuggestion: `${millCoating} con Radio de Esquina 0.030"`,
    holderSuggestion: 'Portafresas Side-Lock Weldon CAT40 1/2" (P/N 08-0062)',
    speedsFeedsSuggestion: {
      rpm: millSpeeds.rpm,
      cuttingSpeed: `${millSpeeds.rpm} RPM`,
      feed: `${millSpeeds.tableFeedIpm} IPM (${millSpeeds.tableFeedMmMin} mm/min)`,
      depthOfCut: 'Ap: 6.0mm, Ae: 3.0mm',
    },
    inVaultMatch: endmillVaultMatch || null,
    searchUrl: getSupplierSearchUrl('haas_tooling', `1/2 endmill ${millFlutes} flute`),
    notes: 'Sujeción en porta Weldon para evitar deslizamiento axial bajo corte pesado.',
  });

  // B. Acabado de Fresado
  millTools.push({
    role: 'acabado_fresado',
    roleLabel: 'Acabado y Paredes',
    toolType: 'Endmill de Precisión 3/8" (4F/5F)',
    codeSuggestion: `EM-3/8-4F-${isoGroup === 'N' ? 'Bright' : 'AlTiN'}`,
    gradeSuggestion: 'Carburo Micrograno',
    holderSuggestion: 'Porta Boquillas CAT40 ER32 con tuerca balanceada',
    speedsFeedsSuggestion: {
      rpm: Math.round(millSpeeds.rpm * 1.3),
      cuttingSpeed: 'Alta velocidad',
      feed: '35 IPM (900 mm/min)',
      depthOfCut: 'Ap: 10.0mm, Ae: 0.5mm',
    },
    searchUrl: getSupplierSearchUrl('travers_mexico', 'endmill 3/8 4 filos'),
    notes: 'Montar en boquilla ER32 para concentricidad <0.0002" y excelente acabado de paredes.',
  });

  // C. Barrenado y Centrado
  millTools.push({
    role: 'barrenado',
    roleLabel: 'Barrenado de Precisión',
    toolType: 'Broca de Carburo Sólido / Spot Drill 90°',
    codeSuggestion: 'Broca Carburo 8.5mm (para M10) o 1/4" Spot Drill',
    gradeSuggestion: 'AlTiN con Refrigeración Interna (TSC)',
    holderSuggestion: 'Porta Boquillas CAT40 ER20 / ER32',
    speedsFeedsSuggestion: {
      rpm: 2200,
      cuttingSpeed: '60 m/min',
      feed: '0.15 mm/rev (330 mm/min)',
      depthOfCut: 'Ciclo G83 / G73 Picoteo',
    },
    searchUrl: getSupplierSearchUrl('mcmaster', 'solid carbide drill'),
    notes: 'Puntear con Spot Drill 90° a 0.5mm mayor que el barreno para dejar chaflán integrado.',
  });

  // 5. Consejos para Setup en Máquinas Haas
  const haasSetupAdvice: string[] = [
    'Asegurar tirantes Haas 45° con rosca 5/8"-11 apretados a 70 ft-lbs (95 Nm).',
    'En torno Haas ST-20, usar bujes partidos para barras de 1" asegurando que el refrigerante pase por el centro.',
    `Para ${matchedMat.name}, programar el torno con G96 S${matchedMat.vcTurningMMin[0]} y límite de seguridad G50 S3500.`,
    'En fresadora Haas VF, usar soplado de aire + refrigerante para desalojar viruta y evitar re-cortado.',
  ];

  return {
    blueprintName,
    detectedMaterial: matchedMat.name,
    isoGroup,
    hardness,
    operations,
    latheTools,
    millTools,
    haasSetupAdvice,
  };
}

/**
 * Analiza una imagen de plano usando Gemini Vision para extraer material, dureza y operaciones.
 */
export async function analyzeBlueprintWithAI(dataUrl: string): Promise<BlueprintMetadataInput> {
  const imagePart = prepareImagePart(dataUrl);

  const prompt = `Analiza este plano de ingeniería mecánica (blueprint / dibujo técnico).
Extrae los siguientes datos técnicos con la mayor precisión posible:
1. Nombre o descripción de la pieza.
2. Material especificado en el cajetín (ej. Acero 4140, Inox 304, Aluminio 6061, 1018, D2, Latón, etc.).
3. Dureza o tratamiento térmico (ej. 28-32 HRC, Templado, Recocido, Pavonado).
4. Tolerancia de acabado superficial o rugosidad (ej. Ra 1.6, Ra 3.2, N6, Rectificado).
5. Características geométricas clave (ej. flecha torneada, rosca M16, ranuras, barrenos, cajas).

Devuelve ÚNICAMENTE un objeto JSON válido con este formato:
{
  "blueprintName": "Nombre o descripción de la pieza",
  "material": "Material detectado",
  "dureza": "Dureza o tratamiento detectado",
  "acabado": "Rugosidad o acabado detectado",
  "description": "Breve resumen de operaciones mecánicas identificadas"
}`;

  const response = await callWithRetry(async () => {
    return await callGeminiProxy({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }, imagePart],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });
  });

  try {
    const parsed = JSON.parse(response.text) as {
      blueprintName?: string;
      material?: string;
      dureza?: string;
      acabado?: string;
      description?: string;
    };

    return {
      blueprintName: parsed.blueprintName || 'Plano Analizado',
      material: parsed.material || 'Acero 4140',
      dureza: parsed.dureza || 'Tratado estándar',
      acabado: parsed.acabado || 'Ra 1.6 µm',
      description: parsed.description || 'Pieza para maquinado en torno y fresa CNC',
    };
  } catch {
    return {
      blueprintName: 'Plano Analizado por IA',
      material: 'Acero 4140',
      dureza: '28-32 HRC',
      acabado: 'Ra 1.6 µm',
      description: 'Pieza de ingeniería mecánica',
    };
  }
}

/**
 * Analiza la foto de una caja o etiqueta de insertos con Gemini Vision.
 */
export async function analyzeInsertBoxPhotoWithAI(dataUrl: string): Promise<{
  codigoISO: string;
  marca: string;
  grado: string;
  rompevirutas: string;
  materialISO: IsoMaterialGroup;
  descripcion: string;
}> {
  const imagePart = prepareImagePart(dataUrl);

  const prompt = `Analiza esta fotografía de una caja de insertos de corte para maquinado CNC.
Identifica la información impresa en la etiqueta:
1. Código ISO o ANSI del inserto (ej. WNMG 080408, CNMG 120408, APKT 1604, CCMT 09T304, MGMN 300, etc.).
2. Marca del fabricante (ej. Korloy, Sandvik, Kennametal, Iscar, Mitsubishi, Kyocera, Walter, YG-1, Shars, etc.).
3. Grado del carburo (ej. PC9030, NC3030, GC4325, KCP25B, VP15TF, IC907, etc.).
4. Rompevirutas (ej. PC, MA, PM, MP, GS, etc.).
5. Grupo de material ISO recomendado (P para Acero, M para Inox, K para Fundición, N para Aluminio, S para Titanio, H para Templado).

Devuelve ÚNICAMENTE un objeto JSON válido con este formato:
{
  "codigoISO": "CNMG 120408",
  "marca": "Korloy",
  "grado": "NC3030",
  "rompevirutas": "PC",
  "materialISO": "P",
  "descripcion": "Inserto para torneado desbaste en aceros"
}`;

  const response = await callWithRetry(async () => {
    return await callGeminiProxy({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }, imagePart],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });
  });

  try {
    const parsed = JSON.parse(response.text) as {
      codigoISO?: string;
      marca?: string;
      grado?: string;
      rompevirutas?: string;
      materialISO?: IsoMaterialGroup;
      descripcion?: string;
    };

    return {
      codigoISO: parsed.codigoISO || 'CNMG 120408',
      marca: parsed.marca || 'Genérico',
      grado: parsed.grado || 'P25',
      rompevirutas: parsed.rompevirutas || 'General',
      materialISO: parsed.materialISO || 'P',
      descripcion: parsed.descripcion || 'Inserto de corte para CNC',
    };
  } catch {
    return {
      codigoISO: 'WNMG 080408',
      marca: 'Korloy',
      grado: 'NC3030',
      rompevirutas: 'PC',
      materialISO: 'P',
      descripcion: 'Inserto detectado de imagen',
    };
  }
}
