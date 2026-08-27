import type { CarbideGradeEntry, IsoMaterialGroup } from './types';

export const CARBIDE_GRADES_MATRIX: CarbideGradeEntry[] = [
  {
    isoGroup: 'P',
    subGroup: 'P15 (Acabado Acero)',
    application: 'Acero al carbón y aleado — Acabado fino, altas velocidades, corte continuo.',
    sandvik: 'GC4315',
    kennametal: 'KCP10B',
    iscar: 'IC9025',
    korloy: 'NC3120',
    haasTooling: 'HT-P15',
    mitsubishi: 'UE6110',
    walter: 'WPP10S',
    kyocera: 'CA5515',
    seco: 'TP1501',
    yg1: 'YG3010',
  },
  {
    isoGroup: 'P',
    subGroup: 'P25 (Medio / General)',
    application: 'Acero 4140/1045 — Desbaste medio a pesado, versatilidad universal.',
    sandvik: 'GC4325',
    kennametal: 'KCP25B',
    iscar: 'IC9250',
    korloy: 'NC3020 / NC3030',
    haasTooling: 'HT-P25',
    mitsubishi: 'UE6020',
    walter: 'WPP20S',
    kyocera: 'CA5525',
    seco: 'TP2501',
    yg1: 'YG3020',
  },
  {
    isoGroup: 'P',
    subGroup: 'P35 (Desbaste Pesado)',
    application: 'Acero — Corte interrumpido, forja, cascarilla y desbaste agresivo.',
    sandvik: 'GC4335',
    kennametal: 'KCP40',
    iscar: 'IC9350',
    korloy: 'NC3225',
    haasTooling: 'HT-P35',
    mitsubishi: 'UE6035',
    walter: 'WPP30S',
    kyocera: 'CA5535',
    seco: 'TP3501',
    yg1: 'YG3030',
  },
  {
    isoGroup: 'M',
    subGroup: 'M20 (Inox General)',
    application: 'Acero Inoxidable 304/316 — Tenacidad contra calor y adhesión de cromo-níquel.',
    sandvik: 'GC2025 / GC2220',
    kennametal: 'KCS10B / KCP25B',
    iscar: 'IC907 / IC807',
    korloy: 'PC9030 / NC9125',
    haasTooling: 'HT-M20',
    mitsubishi: 'VP15TF / MP7035',
    walter: 'WSM20S',
    kyocera: 'PR1125',
    seco: 'TS2000',
    yg1: 'YG213',
  },
  {
    isoGroup: 'M',
    subGroup: 'M35 (Inox Corte Interrumpido)',
    application: 'Inoxidable 316L/Duplex — Desbaste pesado y corte interrumpido.',
    sandvik: 'GC2035',
    kennametal: 'KCS20B',
    iscar: 'IC830',
    korloy: 'NC9135',
    haasTooling: 'HT-M35',
    mitsubishi: 'US735',
    walter: 'WSM30S',
    kyocera: 'PR1135',
    seco: 'TS2500',
    yg1: 'YG214',
  },
  {
    isoGroup: 'K',
    subGroup: 'K15 (Fundición Gris)',
    application: 'Hierro gris y fundición nodular — Alta resistencia al desgaste abrasivo.',
    sandvik: 'GC3210',
    kennametal: 'KC5010',
    iscar: 'IC9150',
    korloy: 'NC305K',
    haasTooling: 'HT-K15',
    mitsubishi: 'UC5115',
    walter: 'WAK10',
    kyocera: 'CA4515',
    seco: 'TK1001',
    yg1: 'YG10',
  },
  {
    isoGroup: 'N',
    subGroup: 'N10 (Aluminio Pulido)',
    application: 'Aluminio 6061/7075 y metales no ferrosos — Carburo micrograno pulido sin recubrimiento.',
    sandvik: 'H10 / H13A',
    kennametal: 'K313',
    iscar: 'IC08',
    korloy: 'H01',
    haasTooling: 'HT-N10',
    mitsubishi: 'HTi10',
    walter: 'WXN10',
    kyocera: 'KW10',
    seco: 'HX',
    yg1: 'YG-1 ALU',
  },
  {
    isoGroup: 'S',
    subGroup: 'S15 (Titanio / Inconel)',
    application: 'Superaleaciones resistentes al calor (HRSA) y Titanio Ti-6Al-4V.',
    sandvik: 'GC1105 / GC1115',
    kennametal: 'KCU10 / KCS10B',
    iscar: 'IC806 / IC907',
    korloy: 'PC8110',
    haasTooling: 'HT-S15',
    mitsubishi: 'VP05RT',
    walter: 'WSM10S',
    kyocera: 'PR1225',
    seco: 'TS2000',
    yg1: 'YG-S',
  },
  {
    isoGroup: 'H',
    subGroup: 'H15 (Aceros Duros >50 HRC)',
    application: 'Aceros templados D2/A2/H13 — Carburo CBN (Borazón) o recubrimiento nano.',
    sandvik: 'CB7015 (CBN) / GC7015',
    kennametal: 'KB1630 (CBN)',
    iscar: 'IB20H (CBN) / IC908',
    korloy: 'KB9610',
    haasTooling: 'HT-H10',
    mitsubishi: 'MB8025 (CBN)',
    walter: 'WBH20',
    kyocera: 'KBN05M',
    seco: 'CBN060K',
    yg1: 'YG-H',
  },
];

export function getGradesByGroup(group: IsoMaterialGroup): CarbideGradeEntry[] {
  return CARBIDE_GRADES_MATRIX.filter(g => g.isoGroup === group);
}

export function searchGrades(query: string): CarbideGradeEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return CARBIDE_GRADES_MATRIX;
  return CARBIDE_GRADES_MATRIX.filter(g =>
    g.subGroup.toLowerCase().includes(q) ||
    g.application.toLowerCase().includes(q) ||
    g.sandvik.toLowerCase().includes(q) ||
    g.korloy.toLowerCase().includes(q) ||
    g.kennametal.toLowerCase().includes(q) ||
    g.iscar.toLowerCase().includes(q) ||
    g.haasTooling.toLowerCase().includes(q) ||
    g.mitsubishi.toLowerCase().includes(q) ||
    g.walter.toLowerCase().includes(q) ||
    g.kyocera.toLowerCase().includes(q)
  );
}
