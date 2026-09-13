import type { DataSourceRef } from './types';

/**
 * Centraliza las cadenas de fuente/atribución (§ HANDOFF-HERRAMENTAL-CNC.md Fase 3)
 * para los módulos de datos que no traían su propio `DataSourceRef` de módulo:
 * Grados de Carburo, Guía de Fresas, Specs Haas y Directorio de Proveedores.
 *
 * Regla dura: nunca marcar un dato como "verificado" si no se confirmó contra el
 * catálogo oficial del fabricante. Donde no hay confirmación, se usa `SRC_UNVERIFIED`
 * o una etiqueta que diga explícitamente "orientativo" / "no verificado 1:1".
 */

export const SRC_GRADE_MATRIX =
  'Compilación multimarca orientativa · equivalencias NO verificadas 1:1 — confirmar con catálogo del fabricante';

export const SRC_ENDMILL_GUIDE =
  'Guías de aplicación Sandvik / Harvey Tool / Helical · rangos conservadores de taller';

export const SRC_HAAS_TOOLING_CATALOG =
  'Haas Tooling catalog (haastooling.com) · P/N CAT40 verificables; holders de torno ISO genéricos';

export const SRC_SUPPLIER_DIRECTORY =
  'URLs oficiales · descripciones editoriales SMV · algunos MX vía búsqueda site:';

export const SRC_BLUEPRINT_HEURISTICS =
  'Reglas locales SMV + materialDatabase + speedsFeeds · no sustituye lectura del plano';

export const SRC_VAULT_USER =
  'Registro de taller SMV · precios/rendimiento no verificados por catálogo';

export const SRC_UNVERIFIED = 'Sin verificar — confirmar con catálogo del fabricante';

export const CARBIDE_GRADES_SOURCE: DataSourceRef = { label: SRC_GRADE_MATRIX, verifiedOn: '2026-09-11' };

export const ENDMILL_GUIDE_SOURCE: DataSourceRef = { label: SRC_ENDMILL_GUIDE, verifiedOn: '2026-09-11' };

export const HAAS_TOOLING_SPECS_SOURCE: DataSourceRef = {
  label: SRC_HAAS_TOOLING_CATALOG,
  url: 'https://www.haastooling.com',
  verifiedOn: '2026-09-11',
};

export const TOOLING_SUPPLIERS_SOURCE: DataSourceRef = { label: SRC_SUPPLIER_DIRECTORY, verifiedOn: '2026-09-11' };

export const BLUEPRINT_ADVISOR_SOURCE: DataSourceRef = { label: SRC_BLUEPRINT_HEURISTICS, verifiedOn: '2026-09-11' };

export const VAULT_DATA_SOURCE: DataSourceRef = { label: SRC_VAULT_USER, verifiedOn: '2026-09-11' };
