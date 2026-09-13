import { describe, it, expect } from 'vitest';
import {
  calculateTurningSpeedsFeeds,
  calculateMillingSpeedsFeeds,
  availableSpindleHpAtRpm,
} from '../speedsFeedsCalculator';
import { findHaasMachineById, HAAS_MACHINE_PROFILES } from '../haasProfiles';
import { classifyRa, maxFeedForRa, theoreticalPeakToValleyUm } from '../surfaceFinish';

describe('Perfiles Haas de referencia', () => {
  it('todos tienen fuente oficial y fecha de verificación', () => {
    for (const m of HAAS_MACHINE_PROFILES) {
      expect(m.source.url).toMatch(/^https:\/\/www\.haas(cnc\.com|\.co\.uk)\//);
      expect(m.source.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.model.length).toBeGreaterThan(0);
    }
  });

  it('la Mini Mill actual es 8,000 rpm / 7.5 hp y el ST-20 tiene barra de 2.5"', () => {
    expect(findHaasMachineById('haas_mini_mill')).toMatchObject({ maxRpm: 8000, horsepower: 7.5 });
    expect(findHaasMachineById('haas_st20')).toMatchObject({ barCapacityInch: 2.5, maxRpm: 4000 });
  });

  it('el taller SMV tiene Mini Mill, VF-2 y VF-3 marcadas inTaller', () => {
    expect(findHaasMachineById('haas_mini_mill')?.inTaller).toBe(true);
    expect(findHaasMachineById('haas_vf2')?.inTaller).toBe(true);
    expect(findHaasMachineById('haas_vf3')?.inTaller).toBe(true);
    expect(findHaasMachineById('haas_st20')?.inTaller).toBeFalsy();
  });
});

describe('Curva de par del husillo', () => {
  it('debajo de las RPM de par máximo solo entrega P = T·n/9549', () => {
    const st20 = findHaasMachineById('haas_st20')!; // 203 Nm @ 500 rpm, 20 hp
    // A 250 rpm: 203 * 250 / 9549 = 5.31 kW = 7.13 HP
    expect(availableSpindleHpAtRpm(st20, 250)).toBe(7.13);
    // Arriba del codo entrega la nominal
    expect(availableSpindleHpAtRpm(st20, 1500)).toBe(20);
  });

  it('avisa cuando el corte pide más HP de los disponibles a baja RPM', () => {
    // Diámetro grande + Vc baja → RPM bajísimas en zona de par constante
    const result = calculateTurningSpeedsFeeds({
      diameterMm: 300,
      cuttingSpeedMMin: 150, // rpm = 150000 / (π·300) ≈ 159
      feedPerRevMm: 0.4,
      depthOfCutMm: 5,
      noseRadiusMm: 1.2,
      materialId: 'steel_4140',
      haasMachineId: 'haas_st20',
    });
    expect(result.machine?.usableRpm).toBe(159);
    expect(result.machine?.availableHpAtRpm).toBeLessThan(20);
    expect(result.warnings.some((w) => w.includes('zona de par constante'))).toBe(true);
  });
});

describe('Tope de RPM de la máquina', () => {
  it('el TL-1 (1,800 rpm) topa en aluminio chico y reporta la Vc real', () => {
    const result = calculateTurningSpeedsFeeds({
      diameterMm: 25,
      cuttingSpeedMMin: 400, // rpm = 5093 > 1800
      feedPerRevMm: 0.2,
      depthOfCutMm: 1,
      noseRadiusMm: 0.8,
      materialId: 'aluminum_6061',
      haasMachineId: 'haas_tl1',
    });
    expect(result.machine?.rpmIsCapped).toBe(true);
    expect(result.machine?.usableRpm).toBe(1800);
    // Vc real = π · 25 · 1800 / 1000 = 141.4 m/min
    expect(result.machine?.effectiveSurfaceSpeedMMin).toBe(141.4);
    expect(result.machine?.rpmUtilization).toBe(1);
  });

  it('sin máquina no hay bloque machine', () => {
    const result = calculateTurningSpeedsFeeds({
      diameterMm: 25,
      cuttingSpeedMMin: 200,
      feedPerRevMm: 0.2,
      depthOfCutMm: 1,
      noseRadiusMm: 0.8,
      materialId: 'steel_1045',
    });
    expect(result.machine).toBeUndefined();
  });
});

describe('Ángulo de contacto radial en fresado', () => {
  it('ranurado a todo el diámetro = 180°, medio diámetro = 90°', () => {
    const base = {
      toolDiameterInch: 0.5,
      numberOfFlutes: 4,
      surfaceFeetPerMinute: 350,
      chipLoadInch: 0.003,
      axialDepthOfCutMm: 6,
      materialId: 'steel_1018',
      haasMachineId: 'haas_vf2',
    };
    const slot = calculateMillingSpeedsFeeds({ ...base, radialDepthOfCutMm: 12.7 });
    const half = calculateMillingSpeedsFeeds({ ...base, radialDepthOfCutMm: 6.35 });
    const light = calculateMillingSpeedsFeeds({ ...base, radialDepthOfCutMm: 1.27 }); // 10 %
    expect(slot.engagementAngleDeg).toBe(180);
    expect(half.engagementAngleDeg).toBe(90);
    // arccos(1 - 0.2) = 36.87°
    expect(light.engagementAngleDeg).toBe(36.9);
    expect(light.radialChipThinningFactor).toBeGreaterThan(1.5);
  });
});

describe('Grados de rugosidad ISO 1302', () => {
  it('clasifica el Ra en el grado N que cumple', () => {
    expect(classifyRa(0.5).grade).toBe('N6');
    expect(classifyRa(1.6).grade).toBe('N7');
    expect(classifyRa(1.61).grade).toBe('N8');
    expect(classifyRa(999).grade).toBe('N11');
  });

  it('el avance máximo para un Ra objetivo invierte la fórmula de Ra', () => {
    // Ra(fn=0.25, r=0.8) = 2.44 µm  →  maxFeedForRa(2.44, 0.8) ≈ 0.25
    expect(maxFeedForRa(2.44, 0.8)).toBeCloseTo(0.25, 2);
    // Rt = fn²/(8r) = 0.0625/6.4 = 9.77 µm
    expect(theoreticalPeakToValleyUm(0.25, 0.8)).toBeCloseTo(9.77, 2);
  });
});
