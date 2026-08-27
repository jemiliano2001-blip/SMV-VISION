export interface ToolingSupplier {
  id: string;
  name: string;
  country: 'USA' | 'MEX';
  category: string;
  description: string;
  specialty: string;
  websiteUrl: string;
  searchUrlTemplate: string; // {q} se reemplaza por el término codificado
  badge: 'Oficial Haas' | 'Factura México CFDI' | 'Entrega Rápida 24h' | 'Mejor Precio' | 'Alta Precisión';
}

export const TOOLING_SUPPLIERS: ToolingSupplier[] = [
  // ── EE.UU. ──
  {
    id: 'haas_tooling',
    name: 'Haas Tooling (Oficial)',
    country: 'USA',
    category: 'Fabricante de Máquina',
    description: 'Herramental oficial diseñado para fresadoras Haas (CAT40) y tornos ST. Precios transparentes y modelos 3D.',
    specialty: 'Conos CAT40, Tirantes Haas 45°, Endmills 3F/4F, Insertos HT-P/HT-M.',
    websiteUrl: 'https://www.haastooling.com',
    searchUrlTemplate: 'https://www.haastooling.com/search?query={q}',
    badge: 'Oficial Haas',
  },
  {
    id: 'mcmaster',
    name: 'McMaster-Carr',
    country: 'USA',
    category: 'Distribuidor Industrial',
    description: 'El estándar de oro para entregas de emergencia, tornillería Torx, refacciones, carburo y materiales.',
    specialty: 'Tornillos Torx, brocas de cobalto, metales especiales, envíos express.',
    websiteUrl: 'https://www.mcmaster.com',
    searchUrlTemplate: 'https://www.mcmaster.com/{q}',
    badge: 'Entrega Rápida 24h',
  },
  {
    id: 'shars_tool',
    name: 'Shars Tool',
    country: 'USA',
    category: 'Distribuidor / Marca Propia',
    description: 'La mejor relación costo/beneficio para portaherramientas CAT40, boquillas ER, barras de mandrinar y accesorios.',
    specialty: 'Conos CAT40 ER32 a bajo costo, juegos de boquillas, mordazas de torno.',
    websiteUrl: 'https://www.shars.com',
    searchUrlTemplate: 'https://www.shars.com/catalogsearch/result/?q={q}',
    badge: 'Mejor Precio',
  },
  {
    id: 'maritool',
    name: 'MariTool USA',
    country: 'USA',
    category: 'Fabricante de Portaherramientas',
    description: 'Fabricante estadounidense de conos CAT40 y boquillas ER de ultra precisión (<0.0001" TIR) y balanceo fino.',
    specialty: 'Porta boquillas balanceados a 20,000 RPM, tirantes de alta calidad.',
    websiteUrl: 'https://www.maritool.com',
    searchUrlTemplate: 'https://www.maritool.com/advanced_search_result.php?keywords={q}',
    badge: 'Alta Precisión',
  },
  {
    id: 'harvey_tool',
    name: 'Harvey Tool & Helical Solutions',
    country: 'USA',
    category: 'Fabricante Especializado',
    description: 'Líder en fresas miniatura, radios de esquina, colas de milano y fresas de alto rendimiento (5F/7F) para Inox y Titanio.',
    specialty: 'Micro-endmills, fresas de roscar, chaflanadores de precisión.',
    websiteUrl: 'https://www.harveyperformance.com',
    searchUrlTemplate: 'https://www.harveyperformance.com/?s={q}',
    badge: 'Alta Precisión',
  },
  {
    id: 'travers_usa',
    name: 'Travers Tool USA',
    country: 'USA',
    category: 'Distribuidor Industrial',
    description: 'Amplio catálogo para talleres de maquinado con marcas como Korloy, OTMT, TTC, Micro 100.',
    specialty: 'Insertos de torneado, fresas de carburo, instrumentos de medición.',
    websiteUrl: 'https://www.travers.com',
    searchUrlTemplate: 'https://www.travers.com/search/{q}',
    badge: 'Mejor Precio',
  },
  {
    id: 'msc_direct',
    name: 'MSC Industrial Direct',
    country: 'USA',
    category: 'Distribuidor Industrial Masivo',
    description: 'Uno de los mayores distribuidores de EE.UU. con marcas como Kennametal, Accupro, Widia, Hertel.',
    specialty: 'Herramientas de corte de marca, contratos de volumen.',
    websiteUrl: 'https://www.mscdirect.com',
    searchUrlTemplate: 'https://www.mscdirect.com/browse?searchterm={q}',
    badge: 'Entrega Rápida 24h',
  },
  {
    id: 'lakeshore_carbide',
    name: 'Lakeshore Carbide',
    country: 'USA',
    category: 'Fabricante Directo',
    description: 'Endmills de carburo sólido hechos en EE.UU. a precio directo de fábrica.',
    specialty: 'Fresas de desbaste variable para acero y fresas 3F para aluminio.',
    websiteUrl: 'https://www.lakeshorecarbide.com',
    searchUrlTemplate: 'https://www.lakeshorecarbide.com/search.aspx?find={q}',
    badge: 'Mejor Precio',
  },

  // ── México (Facturación CFDI) ──
  {
    id: 'travers_mexico',
    name: 'Travers Tool México',
    country: 'MEX',
    category: 'Distribuidor Nacional',
    description: 'Portal en línea con precios en pesos mexicanos, facturación CFDI directa y marcas como Korloy y YG-1.',
    specialty: 'Insertos de carburo, cortadores, machuelos y tornillería con facturación local.',
    websiteUrl: 'https://www.travers.com.mx',
    searchUrlTemplate: 'https://www.travers.com.mx/search/{q}',
    badge: 'Factura México CFDI',
  },
  {
    id: 'grainger_mexico',
    name: 'Grainger México',
    country: 'MEX',
    category: 'Distribuidor Industrial',
    description: 'Logística en todo México, sucursales locales, facturación CFDI y entrega rápida de consumibles de taller.',
    specialty: 'Consumibles MRO, machuelos, brocas, fluidos de corte y herramientas.',
    websiteUrl: 'https://www.grainger.com.mx',
    searchUrlTemplate: 'https://www.grainger.com.mx/grainger/en/search?searchBar=true&searchType=all&searchTerm={q}',
    badge: 'Factura México CFDI',
  },
  {
    id: 'tezatools_mexico',
    name: 'Tezatools México',
    country: 'MEX',
    category: 'Distribuidor Autorizado',
    description: 'Distribuidor oficial de Kennametal, Widia y Hanita en México con asesoría técnica para procesos CNC.',
    specialty: 'Insertos Kennametal, cortadores de alto rendimiento y brocas de carburo.',
    websiteUrl: 'https://www.tezatools.com.mx',
    searchUrlTemplate: 'https://www.google.com/search?q=site:tezatools.com.mx+{q}',
    badge: 'Factura México CFDI',
  },
  {
    id: 'dihcsa_mexico',
    name: 'DIHCSA México',
    country: 'MEX',
    category: 'Distribuidor Técnico',
    description: 'Especialistas en herramientas de corte, sistemas de sujeción y optimización para maquiladoras en el norte de México.',
    specialty: 'Insertos para torneado y fresado, conos y soportes técnicos.',
    websiteUrl: 'https://www.dihcsa.com.mx',
    searchUrlTemplate: 'https://www.google.com/search?q=site:dihcsa.com.mx+{q}',
    badge: 'Factura México CFDI',
  },
  {
    id: 'yamazen_mexico',
    name: 'Yamazen Mexicana',
    country: 'MEX',
    category: 'Distribuidor Premium',
    description: 'Especialista en marcas japonesas de altísima precisión (Sumitomo, Kyocera, OSG, Mitsubishi, BIG Daishowa).',
    specialty: 'Maquinado aeroespacial y automotriz, insertos de CBN y conos de ultra precisión.',
    websiteUrl: 'https://www.yamazen.com.mx',
    searchUrlTemplate: 'https://www.google.com/search?q=site:yamazen.com.mx+{q}',
    badge: 'Alta Precisión',
  },
];

/**
 * Genera la URL de búsqueda directa en un proveedor usando el término de búsqueda codificado.
 */
export function getSupplierSearchUrl(supplierId: string, query: string): string {
  const supplier = TOOLING_SUPPLIERS.find(s => s.id === supplierId);
  if (!supplier) {
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }
  const cleanQ = encodeURIComponent(query.trim());
  return supplier.searchUrlTemplate.replace('{q}', cleanQ);
}
