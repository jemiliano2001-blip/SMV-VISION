import type { HaasMachineProfile } from './types';

/**
 * Perfiles de REFERENCIA del catálogo Haas (haas.co.uk / haascnc.com).
 *
 * Todos los números fueron verificados contra la página oficial de cada modelo
 * el 2026-09-11 (ver `source`). Son la generación actual del catálogo: si el
 * taller tiene una máquina de otra generación (p. ej. la Mini Mill clásica de
 * 6,000 rpm / 16×12×10"), hay que ajustar el perfil a la placa de la máquina.
 *
 * `inTaller: true` = máquina física del taller SMV (confirmado 2026-09-11:
 * Mini Mill, VF-2, VF-3). La UI las lista primero con badge "Taller SMV".
 */
const VERIFIED_ON = '2026-09-11';

export const HAAS_MACHINE_PROFILES: HaasMachineProfile[] = [
  // ─── Tornos ST ────────────────────────────────────────────────────────────
  {
    id: 'haas_st10',
    name: 'Haas ST-10 (Torno CNC Compacto)',
    model: 'ST-10',
    type: 'lathe',
    description: 'Torno CNC compacto: chuck 6.5", barra 1.75", corte máx. 12" × 12".',
    maxRpm: 6000,
    horsepower: 15,
    kw: 11.2,
    maxTorqueNm: 102,
    maxTorqueAtRpm: 1300,
    taperOrSpindle: 'A2-5',
    chuckOrTableSize: 'Chuck 6.5" (165 mm)',
    barCapacityInch: 1.75,
    maxCuttingDiaInch: 12.0,
    workEnvelope: 'Corte máx. 12.0" Ø × 12.0" largo',
    toolStations: 12,
    rapidsIpm: 1200,
    notes: 'Torreta BOT de 12 estaciones. Par máximo 75 ft-lb a 1,300 rpm: buen torno para piezas chicas y latón/aluminio a alta velocidad.',
    source: { url: 'https://www.haas.co.uk/lathes/st-10/', verifiedOn: VERIFIED_ON },
  },
  {
    id: 'haas_st20',
    name: 'Haas ST-20 (Torno CNC de Producción)',
    model: 'ST-20',
    type: 'lathe',
    description: 'Torno CNC estándar de taller: chuck 8.3", barra 2.5", corte máx. 13" × 22.5".',
    maxRpm: 4000,
    horsepower: 20,
    kw: 14.9,
    maxTorqueNm: 203,
    maxTorqueAtRpm: 500,
    taperOrSpindle: 'A2-6',
    chuckOrTableSize: 'Chuck 8.3" (210 mm)',
    barCapacityInch: 2.5,
    maxCuttingDiaInch: 13.0,
    workEnvelope: 'Corte máx. 13.0" Ø × 22.5" largo · volteo 21"',
    toolStations: 12,
    rapidsIpm: 945,
    notes: 'Torreta BOT de 12 estaciones; zancos de 1" (25 mm). Par máximo 150 ft-lb a 500 rpm: ideal para desbaste de 4140 en diámetros grandes.',
    source: { url: 'https://www.haas.co.uk/lathes/st-20/', verifiedOn: VERIFIED_ON },
  },
  {
    id: 'haas_st30',
    name: 'Haas ST-30 (Torno CNC Pesado)',
    model: 'ST-30',
    type: 'lathe',
    description: 'Torno CNC de alta capacidad: chuck 10", barra 3", corte máx. 15" × 32.5".',
    maxRpm: 3400,
    horsepower: 30,
    kw: 22.4,
    maxTorqueNm: 407,
    maxTorqueAtRpm: 500,
    taperOrSpindle: 'A2-6',
    chuckOrTableSize: 'Chuck 10" (254 mm)',
    barCapacityInch: 3.0,
    maxCuttingDiaInch: 15.0,
    workEnvelope: 'Corte máx. 15.0" Ø × 32.5" largo · volteo 20.75"',
    toolStations: 12,
    rapidsIpm: 945,
    notes: 'Par máximo 300 ft-lb a 500 rpm. Rigidez para flechas pesadas y desbaste agresivo con insertos de 1/2" (CNMG 12).',
    source: { url: 'https://www.haas.co.uk/lathes/st-30/', verifiedOn: VERIFIED_ON },
  },
  {
    id: 'haas_tl1',
    name: 'Haas TL-1 (Torno Toolroom)',
    model: 'TL-1',
    type: 'lathe',
    description: 'Torno de cuarto de herramientas: chuck 8", barra 2", 16" Ø × 30" entre puntos.',
    maxRpm: 1800,
    horsepower: 10,
    kw: 7.5,
    maxTorqueNm: 146,
    maxTorqueAtRpm: 355,
    taperOrSpindle: 'A2-5',
    chuckOrTableSize: 'Chuck 8" (203 mm)',
    barCapacityInch: 2.0,
    maxCuttingDiaInch: 16.0,
    workEnvelope: 'Corte máx. 16.0" Ø × 30" entre puntos · X 8" / Z 30"',
    toolStations: 1,
    rapidsIpm: 450,
    notes: 'Sin torreta automática (poste de herramienta manual). Solo 1,800 rpm: en diámetros chicos NO alcanza la Vc de aluminio o latón; se trabaja a la RPM máxima.',
    source: { url: 'https://www.haas.co.uk/lathes/tl-1/', verifiedOn: VERIFIED_ON },
  },

  // ─── Centros de maquinado VF / Mini Mill ─────────────────────────────────
  {
    id: 'haas_vf2',
    name: 'Haas VF-2 (Centro de Maquinado VMC)',
    model: 'VF-2',
    type: 'mill',
    description: 'Centro vertical 3 ejes: recorridos 30" × 16" × 20", mesa 36" × 14".',
    maxRpm: 8100,
    horsepower: 30,
    kw: 22.4,
    maxTorqueNm: 122,
    maxTorqueAtRpm: 2000,
    taperOrSpindle: 'CAT40 / BT40',
    chuckOrTableSize: 'Mesa 36" × 14" (3,000 lb)',
    workEnvelope: 'Recorridos X 30" · Y 16" · Z 20"',
    toolStations: 20,
    toolChangeSec: 4.5,
    rapidsIpm: 1000,
    notes: 'Cambiador carrusel de 20 herramientas (SMTC opcional); chip-a-chip 4.5 s. Par máximo 90 ft-lb a 2,000 rpm. Tirante 45° rosca 5/8"-11.',
    source: { url: 'https://www.haas.co.uk/vertical-mills/vf-2/', verifiedOn: VERIFIED_ON },
    inTaller: true,
  },
  {
    id: 'haas_vf3',
    name: 'Haas VF-3 (Centro de Maquinado VMC)',
    model: 'VF-3',
    type: 'mill',
    description: 'Centro vertical de capacidad extendida: 40" × 20" × 25", mesa 48" × 18".',
    maxRpm: 8100,
    horsepower: 30,
    kw: 22.4,
    maxTorqueNm: 122,
    maxTorqueAtRpm: 2000,
    taperOrSpindle: 'CAT40 / BT40',
    chuckOrTableSize: 'Mesa 48" × 18" (3,500 lb)',
    workEnvelope: 'Recorridos X 40" · Y 20" · Z 25"',
    toolStations: 20,
    toolChangeSec: 4.5,
    rapidsIpm: 1000,
    notes: 'Mismo husillo en línea que la VF-2 (30 hp, 8,100 rpm). Ideal para piezas largas, placas y múltiples prensas en la misma mesa.',
    source: { url: 'https://www.haas.co.uk/vertical-mills/vf-3/', verifiedOn: VERIFIED_ON },
    inTaller: true,
  },
  {
    id: 'haas_mini_mill',
    name: 'Haas Mini Mill (VMC Compacto)',
    model: 'Mini Mill',
    type: 'mill',
    description: 'Fresadora compacta para prototipos y segundas operaciones: 16" × 14" × 15".',
    maxRpm: 8000,
    horsepower: 7.5,
    kw: 5.6,
    maxTorqueNm: 61,
    maxTorqueAtRpm: 500,
    taperOrSpindle: 'CAT40 / BT40',
    chuckOrTableSize: 'Mesa 36" × 12" (500 lb)',
    workEnvelope: 'Recorridos X 16" · Y 14" · Z 15"',
    toolStations: 10,
    toolChangeSec: 5.0,
    rapidsIpm: 800,
    notes: 'Generación actual (2023+). Solo 7.5 hp: mantener ap < 3 mm en acero y preferir fresas de 3/8"–1/2". La Mini Mill clásica era 6,000 rpm y 16" × 12" × 10".',
    source: { url: 'https://www.haas.co.uk/machines/mini-mill/', verifiedOn: VERIFIED_ON },
    inTaller: true,
  },
];

export function findHaasMachineById(id: string): HaasMachineProfile | undefined {
  return HAAS_MACHINE_PROFILES.find(m => m.id === id);
}

/** Máquinas de un tipo, con las confirmadas del taller primero. */
export function listHaasMachinesByType(type: HaasMachineProfile['type']): HaasMachineProfile[] {
  return HAAS_MACHINE_PROFILES
    .filter(m => m.type === type)
    .sort((a, b) => Number(Boolean(b.inTaller)) - Number(Boolean(a.inTaller)));
}
