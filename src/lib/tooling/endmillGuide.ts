import type { IsoMaterialGroup, EndmillRecommendation, EndmillTipGeometry } from './types';

export const ENDMILL_RECOMMENDATIONS: Record<IsoMaterialGroup, EndmillRecommendation> = {
  P: {
    materialGroup: 'P',
    idealFlutes: [4, 5],
    idealCoating: 'altin',
    coatingName: 'AlTiN / TiAlN (Violeta / Negro)',
    tipGeometry: 'corner_radius',
    helixAngle: '38° / 41° Hélice Variable (Antivibración)',
    reasons: [
      '4 filos proporcionan un balance óptimo entre resistencia del núcleo y espacio para viruta en acero 1018/4140.',
      'El recubrimiento AlTiN soporta temperaturas de corte de hasta 900°C formando una capa protectora de óxido de aluminio.',
      'Un radio de esquina de 0.030" (0.8mm) previene el despostillamiento de la punta y triplica la vida útil vs esquina viva.',
    ],
    topBrands: ['Haas Tooling 4F', 'YG-1 4G Mills / V7 Plus', 'Lakeshore Carbide', 'Accupro'],
  },
  M: {
    materialGroup: 'M',
    idealFlutes: [5, 6],
    idealCoating: 'naco',
    coatingName: 'AlCrN / nACo (Azul / Morado)',
    tipGeometry: 'corner_radius',
    helixAngle: '38° / 42° Hélice Desigual',
    reasons: [
      '5 o 6 filos permiten mayores velocidades de avance en fresado trocoidal (High Speed Machining) en Inox 304/316.',
      'El recubrimiento nACo ofrece ultra-dureza (3600 HV) contra el desgaste abrasivo y la adhesión de cromo-níquel.',
      'Es indispensable mantener avance continuo para evitar frotamiento y endurecimiento por deformación.',
    ],
    topBrands: ['Helical Solutions (5 Flute)', 'Garr Tool Serie V-5', 'OSG EXOCARB', 'Harvey Tool'],
  },
  K: {
    materialGroup: 'K',
    idealFlutes: [4, 6],
    idealCoating: 'altin',
    coatingName: 'AlTiN / TiAlN Grueso',
    tipGeometry: 'square',
    helixAngle: '30° / 35° Hélice Rígida',
    reasons: [
      'La fundición genera viruta en polvo abrasivo; no requiere grandes canales de desalojo, por lo que 4-6 filos dan máxima rigidez.',
      'Se recomienda corte en seco con soplado de aire para evitar formación de pasta abrasiva con el refrigerante.',
    ],
    topBrands: ['YG-1 4G Mills', 'Haas Tooling', 'Kennametal KOR 5', 'Shars'],
  },
  N: {
    materialGroup: 'N',
    idealFlutes: [2, 3],
    idealCoating: 'zrn',
    coatingName: 'ZrN (Dorado Claro) o DLC / Pulido Espejo',
    tipGeometry: 'square',
    helixAngle: '45° a 55° Alta Hélice',
    reasons: [
      '3 filos (3F) es el estándar de oro en centros Haas para aluminio 6061/7075: máxima rigidez + canales amplios de viruta.',
      'La alta hélice (45°) genera una acción de cizallamiento suave que expulsa la viruta a velocidades de hasta 2,500 SFM.',
      'El recubrimiento ZrN o DLC evita que el aluminio se caliente y se suelde al cortador (Built-Up Edge).',
    ],
    topBrands: ['YG-1 Alu-Power', 'Haas Tooling 3F Aluminum', 'Lakeshore Carbide 3F', 'Harvey Tool'],
  },
  S: {
    materialGroup: 'S',
    idealFlutes: [5, 7],
    idealCoating: 'naco',
    coatingName: 'AlCrN / nACo Nano-compuesto',
    tipGeometry: 'corner_radius',
    helixAngle: '40° Hélice Variable',
    reasons: [
      'En Titanio e Inconel se requiere alto número de filos (5F-7F) para pasadas radiales ligeras (ae < 10%) a alta velocidad.',
      'Es crítico el uso de refrigerante a alta presión dirigido exactamente a la zona de corte para evacuar el calor.',
    ],
    topBrands: ['Helical Solutions Titanium', 'Harvey Tool', 'Guhring RF 100', 'Kennametal HARVI I'],
  },
  H: {
    materialGroup: 'H',
    idealFlutes: [4, 6],
    idealCoating: 'tisin',
    coatingName: 'TiSiN / nACo para Dureza Extrema (>55 HRC)',
    tipGeometry: 'corner_radius',
    helixAngle: '35° Hélice de Alta Resistencia',
    reasons: [
      'Substrato de carburo ultra-micrograno con alta tenacidad para resistir micro-impactos en aceros templados como D2 o A2.',
      'El radio de esquina es obligatorio para evitar concentración de esfuerzos.',
    ],
    topBrands: ['Harvey Tool Hardened Steels', 'YG-1 X5070', 'OSG WXL', 'Mitsubishi VFH'],
  },
};

export const TIP_GEOMETRY_GUIDE: Record<EndmillTipGeometry, { name: string; description: string; bestFor: string }> = {
  square: {
    name: 'Plana / Escuadrada (Square)',
    description: 'Puntas vivas a 90° para fresar ranuras, cajas con fondo plano y escuadras perfectas.',
    bestFor: 'Ranurado 90°, cajeado plano y aluminio.',
  },
  corner_radius: {
    name: 'Radio de Esquina (Bull Nose / Corner Radius)',
    description: 'Bordes reforzados con radio de 0.015", 0.030", 0.060" o métrico R0.5/R1.0mm.',
    bestFor: 'Desbaste de aceros e inoxidables. Triplica la vida útil del cortador.',
  },
  ball_nose: {
    name: 'Cabeza Esférica / Bola (Ball Nose)',
    description: 'Punta semiesférica continua para superficies curvas y moldes en 3D.',
    bestFor: 'Mecanizado 3D, radios de fondo, cavidades y matrices.',
  },
  roughing_corncob: {
    name: 'Desbaste / Ondulada (Roughing / Corncob)',
    description: 'Dientes ondulados que rompen la viruta en fragmentos minúsculos reduciendo la fuerza de corte.',
    bestFor: 'Desbaste agresivo de bloques grandes en máquinas de potencia media.',
  },
  chamfer: {
    name: 'Chaflanador / Biselador (Chamfer Mill 45°/90°)',
    description: 'Herramienta cónica para desbarbar aristas y hacer chaflanes de acabado.',
    bestFor: 'Desbarbado y biseles precisos en todas las caras.',
  },
  thread_mill: {
    name: 'Fresa de Roscar (Thread Mill)',
    description: 'Corte de roscas por interpolación helicoidal en CNC (roscas M y UN derechas e izquierdas).',
    bestFor: 'Roscas en materiales difíciles donde un machuelo podría romperse.',
  },
};
