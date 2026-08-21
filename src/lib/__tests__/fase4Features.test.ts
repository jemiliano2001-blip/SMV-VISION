import { describe, it, expect } from 'vitest';
import { normalizePurchaseItem } from '../firebase/purchaseValidators';
import { parseOdooLineLabels } from '../orderDrawingBridge';

describe('Phase 4: Purchase item and line requisition parsing', () => {
  it('normalizes a purchase item created from order requisition', () => {
    const raw = {
      nombre: 'Redondo D2 1.5 pulg (para SO 2026/S00781)',
      tipo: 'metal',
      sku: '90-1012-05',
      proveedor: 'Aceros y Metales',
      link: 'https://ejemplo.com/d2',
      notas: 'SO: 2026/S00781 · PO: 4500123 · Cantidad requerida: 10 pzas',
    };

    const item = normalizePurchaseItem('test-purchase-123', raw);
    expect(item).not.toBeNull();
    expect(item?.id).toBe('test-purchase-123');
    expect(item?.nombre).toBe('Redondo D2 1.5 pulg (para SO 2026/S00781)');
    expect(item?.tipo).toBe('metal');
    expect(item?.sku).toBe('90-1012-05');
    expect(item?.proveedor).toBe('Aceros y Metales');
    expect(item?.notas).toContain('2026/S00781');
  });

  it('correctly parses Odoo product lines for purchase requisition defaults', () => {
    const parsed = parseOdooLineLabels(
      '[90-1012-05] PUNZON DE CORTE',
      'PUNZON DE CORTE D2 58-60 HRC',
    );

    expect(parsed.numeroParte).toBe('90-1012-05');
    expect(parsed.pieza).toContain('PUNZON DE CORTE');
  });
});
