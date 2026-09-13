import { describe, it, expect } from 'vitest';
import {
  CARBIDE_GRADES_SOURCE,
  ENDMILL_GUIDE_SOURCE,
  HAAS_TOOLING_SPECS_SOURCE,
  TOOLING_SUPPLIERS_SOURCE,
  BLUEPRINT_ADVISOR_SOURCE,
  VAULT_DATA_SOURCE,
} from '../sources';
import { CARBIDE_GRADES_MATRIX } from '../carbideGrades';
import { HAAS_TOOLING_SPECS } from '../haasToolingSpecs';
import { TOOLING_SUPPLIERS } from '../toolingSuppliers';
import type { DataSourceRef } from '../types';

const ALL_MODULE_SOURCES: Record<string, DataSourceRef> = {
  CARBIDE_GRADES_SOURCE,
  ENDMILL_GUIDE_SOURCE,
  HAAS_TOOLING_SPECS_SOURCE,
  TOOLING_SUPPLIERS_SOURCE,
  BLUEPRINT_ADVISOR_SOURCE,
  VAULT_DATA_SOURCE,
};

describe('Tooling data source attribution (Fase 3)', () => {
  it('every module-level DataSourceRef has a non-empty label and a valid verifiedOn date', () => {
    for (const [name, source] of Object.entries(ALL_MODULE_SOURCES)) {
      expect(source.label.length, `${name}.label should not be empty`).toBeGreaterThan(0);
      expect(source.verifiedOn, `${name}.verifiedOn should be YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('CARBIDE_GRADES_MATRIX: every entry declares a source', () => {
    expect(CARBIDE_GRADES_MATRIX.length).toBeGreaterThan(0);
    for (const entry of CARBIDE_GRADES_MATRIX) {
      expect(entry.source, `${entry.subGroup} should have a source`).toBeTruthy();
    }
  });

  it('CARBIDE_GRADES_SOURCE explicitly flags equivalences as unverified 1:1', () => {
    expect(CARBIDE_GRADES_SOURCE.label.toLowerCase()).toContain('no verificad');
  });

  it('HAAS_TOOLING_SPECS: entries flagged partNumberVerified=true must carry a real haasPartNumber', () => {
    expect(HAAS_TOOLING_SPECS.length).toBeGreaterThan(0);
    const verifiedEntries = HAAS_TOOLING_SPECS.filter((s) => s.partNumberVerified);
    expect(verifiedEntries.length).toBeGreaterThan(0);
    for (const entry of verifiedEntries) {
      expect(entry.haasPartNumber, `${entry.name} is marked verified but has no haasPartNumber`).toBeTruthy();
    }
  });

  it('HAAS_TOOLING_SPECS: entries without a haasPartNumber must NOT claim partNumberVerified', () => {
    const unverifiedByDesign = HAAS_TOOLING_SPECS.filter((s) => !s.haasPartNumber);
    expect(unverifiedByDesign.length).toBeGreaterThan(0);
    for (const entry of unverifiedByDesign) {
      expect(entry.partNumberVerified, `${entry.name} has no P/N and must not be marked verified`).toBe(false);
    }
  });

  it('HAAS_TOOLING_SPECS: every entry declares a source string', () => {
    for (const entry of HAAS_TOOLING_SPECS) {
      expect(entry.source, `${entry.name} should have a source`).toBeTruthy();
    }
  });

  it('TOOLING_SUPPLIERS: at least one supplier is flagged as an indirect (site:) search', () => {
    const siteSuppliers = TOOLING_SUPPLIERS.filter((s) => s.searchType === 'site');
    expect(siteSuppliers.length).toBeGreaterThan(0);
    for (const supplier of siteSuppliers) {
      expect(supplier.searchUrlTemplate).toContain('site:');
    }
  });

  it('TOOLING_SUPPLIERS: at least one supplier is flagged as a direct search', () => {
    const directSuppliers = TOOLING_SUPPLIERS.filter((s) => s.searchType === 'direct');
    expect(directSuppliers.length).toBeGreaterThan(0);
  });
});
