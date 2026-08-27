export interface HaasToolHolderSpec {
  category: 'fresado_cat40' | 'torno_st_exterior' | 'torno_st_interior' | 'boquilla_er' | 'refaccion_torx';
  name: string;
  haasPartNumber?: string;
  description: string;
  taperOrShank: string;
  toolCapacity: string;
  pullStudOrClamp: string;
  notes: string;
}

export const HAAS_TOOLING_SPECS: HaasToolHolderSpec[] = [
  // ── Fresado CAT40 ──
  {
    category: 'fresado_cat40',
    name: 'Porta Boquillas CAT40 ER32 (Gage 2.76" / 70mm)',
    haasPartNumber: '08-0050',
    description: 'Porta boquillas estándar de máxima versatilidad para fresado y barrenado.',
    taperOrShank: 'CAT40',
    toolCapacity: 'Boquillas ER32 (Diámetros de 2 mm a 20 mm / 3/32" a 3/4")',
    pullStudOrClamp: 'Tirante Haas 45° Rosca 5/8"-11 UNC (P/N 08-0125)',
    notes: 'Balanceado a 15,000 RPM G2.5. Runout < 0.0002" (5 µm). Tuerca ER32 par de apriete: 100 ft-lb (135 Nm).',
  },
  {
    category: 'fresado_cat40',
    name: 'Porta Boquillas CAT40 ER20 (Gage 2.76" / 70mm)',
    haasPartNumber: '08-0046',
    description: 'Porta boquillas compacto para herramientas pequeñas y acceso a cavidades.',
    taperOrShank: 'CAT40',
    toolCapacity: 'Boquillas ER20 (Diámetros de 1 mm a 13 mm / 1/16" a 1/2")',
    pullStudOrClamp: 'Tirante Haas 45° Rosca 5/8"-11 UNC',
    notes: 'Ideal para brocas pequeñas y fresas de 1/8" a 3/8" con mínima interferencia.',
  },
  {
    category: 'fresado_cat40',
    name: 'Portafresas Side-Lock Weldon CAT40 1/2" (Gage 2.50")',
    haasPartNumber: '08-0062',
    description: 'Portafresas de opresor lateral para desbaste pesado con endmills con plano Weldon.',
    taperOrShank: 'CAT40',
    toolCapacity: 'Endmills de zanco 1/2" (12.7 mm)',
    pullStudOrClamp: 'Tirante Haas 45° Rosca 5/8"-11 UNC',
    notes: 'Cero deslizamiento axial bajo altas cargas de desbaste en acero 4140. Tornillo opresor 1/4"-28.',
  },
  {
    category: 'fresado_cat40',
    name: 'Portafresas de Plato / Face Mill Arbor CAT40 3/4" (Gage 1.75")',
    haasPartNumber: '08-0070',
    description: 'Porta planeador para cortadores indexables de 2" (50 mm) y 2.5" (63 mm).',
    taperOrShank: 'CAT40',
    toolCapacity: 'Cortadores con barreno central de 3/4" (19.05 mm)',
    pullStudOrClamp: 'Tirante Haas 45° Rosca 5/8"-11 UNC',
    notes: 'Incluye cuña de arrastre y tornillo central M10/M12. Para cabezales SEKT 45° o BAP400R.',
  },
  {
    category: 'fresado_cat40',
    name: 'Tirante de Retención Haas 45° CAT40 (Pull Stud / Retention Knob)',
    haasPartNumber: '08-0125',
    description: 'Tirante oficial estándar con ángulo de cabeza de 45° y rosca 5/8"-11 UNC.',
    taperOrShank: 'Rosca 5/8"-11 UNC',
    toolCapacity: 'Compatible con todos los conos CAT40 en máquinas Haas VF, Mini Mill y EC',
    pullStudOrClamp: 'Diámetro de cabeza: 0.590" (15 mm), Cuello: 0.392" (9.95 mm)',
    notes: 'Torque de apriete requerido: 70 ft-lbs (95 Nm). ¡Revisar periódicamente por micro-grietas!',
  },

  // ── Torno Haas ST ──
  {
    category: 'torno_st_exterior',
    name: 'Portaherramientas Exterior MWLNR 2525 M08 (Zanco 1" / 25x25mm)',
    description: 'Porta exterior para insertos trigono WNMG 080408 / WNMG 432.',
    taperOrShank: 'Zanco cuadrado 1" (25.4 mm) / 25x25 mm',
    toolCapacity: 'Insertos WNMG 0804xx (6 filos de corte económicos)',
    pullStudOrClamp: 'Brida superior / Clamp tipo M con tornillo M5x16',
    notes: 'Ángulo de ataque 95°. Estándar de batalla para desbaste y acabado en Haas ST-20/ST-25/ST-30.',
  },
  {
    category: 'torno_st_exterior',
    name: 'Portaherramientas Exterior MWLNR 2020 K08 (Zanco 3/4" / 19.05mm)',
    description: 'Porta exterior para torreta compacta Haas ST-10 / ST-15.',
    taperOrShank: 'Zanco cuadrado 3/4" (19.05 mm) / 20x20 mm',
    toolCapacity: 'Insertos WNMG 0804xx / WNMG 432',
    pullStudOrClamp: 'Clamp tipo M con tornillo M5x16',
    notes: 'Diseñado específicamente para la torreta BOT de tornos compactos Haas ST-10.',
  },
  {
    category: 'torno_st_exterior',
    name: 'Portaherramientas Exterior MCLNR 2525 M12 (Zanco 1")',
    description: 'Porta para insertos rombo 80° CNMG 120408 / CNMG 432.',
    taperOrShank: 'Zanco cuadrado 1" (25.4 mm)',
    toolCapacity: 'Insertos CNMG 1204xx (4 filos de máxima robustez)',
    pullStudOrClamp: 'Brida CL-06 + Calza de carburo SC-1204',
    notes: 'Máxima resistencia en desbaste pesado y corte interrumpido.',
  },
  {
    category: 'torno_st_interior',
    name: 'Barra de Mandrinar de Interiores S25S-SCLCR 09 (Dia 1" / 25mm)',
    description: 'Barra de acero con refrigeración interna para torneado interior y careado de agujeros.',
    taperOrShank: 'Zanco cilíndrico de 1" (25.4 mm) o 25 mm',
    toolCapacity: 'Insertos positivos CCMT 09T304 / CCMT 32.51',
    pullStudOrClamp: 'Tornillo Torx cónico M3.5 x 8',
    notes: 'Diámetro mínimo de barreno: 32 mm. Requiere buje partido de 1" a 1" en torreta Haas.',
  },
  {
    category: 'torno_st_interior',
    name: 'Barra de Mandrinar S20S-SDUCR 11 (Dia 3/4" / 20mm)',
    description: 'Barra para perfilado interior con insertos DCMT 11T304 a 93°.',
    taperOrShank: 'Zanco cilíndrico de 3/4" (19.05 mm) o 20 mm',
    toolCapacity: 'Insertos DCMT 11T304 / DCMT 32.51',
    pullStudOrClamp: 'Tornillo Torx M3.5',
    notes: 'Ideal para interiores estrechos y perfilado de gargantas y chaflanes interiores.',
  },

  // ── Refacciones Torx ──
  {
    category: 'refaccion_torx',
    name: 'Tornillo Torx M3.5 x 8mm para Insertos CCMT/DCMT',
    description: 'Tornillo avellanado cónico para fijar insertos en barras de mandrinar.',
    taperOrShank: 'Rosca M3.5 paso 0.6mm, Largo 8mm',
    toolCapacity: 'Insertos CCMT 09T3 / DCMT 11T3 / APKT 1003',
    pullStudOrClamp: 'Cabeza Torx T15',
    notes: 'Usar pasta anti-aferrante (anti-seize) para evitar que el tornillo se pegue con el calor.',
  },
  {
    category: 'refaccion_torx',
    name: 'Tornillo Torx M2.5 x 6mm para Insertos CCMT 0602 / DCMT 0702',
    description: 'Tornillo miniatura para barras de mandrinar delgadas (Dia 8mm a 12mm).',
    taperOrShank: 'Rosca M2.5 paso 0.45mm, Largo 6mm',
    toolCapacity: 'Insertos CCMT 060204 / DCMT 070204',
    pullStudOrClamp: 'Cabeza Torx T8',
    notes: '¡No apretar en exceso! Par recomendado: 0.9 Nm para evitar barrer la cabeza.',
  },
  {
    category: 'refaccion_torx',
    name: 'Brida de Sujeción (Clamp CL-06) + Tornillo M5x16 para Portas MWLNR/MCLNR',
    description: 'Kit de clamp superior para insertos negativos WNMG y CNMG.',
    taperOrShank: 'Tornillo M5 con rosca doble diferencial',
    toolCapacity: 'Portas de zanco 20x20 y 25x25 mm',
    pullStudOrClamp: 'Llave hexagonal / Torx T20',
    notes: 'Sujeta simultáneamente el agujero y la cara superior del inserto (sistema M).',
  }
];
