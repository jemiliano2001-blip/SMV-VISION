import { describe, expect, it } from 'vitest';
import type { Order } from '../../types';
import { consolidateHotStamps } from '../hotStamp';
import { formatOrdenPoCell, formatPoLabel } from '../reportFormat';
import { isRequesterFromNotes, odooDatetimeToLocalDate, orderRequester } from '../firebase/odooOrders';
import { requesterKey } from '../../hooks/useOdooOrdersFilters';
import type { OdooOrderView } from '../firebase/odooOrders';

const order = (over: Partial<Order>): Order => ({
  pieza: 'PIEZA',
  cantidad: '1',
  orden: '2026/S01925',
  fecha: '2026-09-18',
  prioridad: 'Normal',
  ...over,
});

describe('PO en el reporte', () => {
  it('celda SO / PO: la PO va debajo de la SO y se omite si no hay', () => {
    expect(formatOrdenPoCell(order({ poNumber: '00089314' }))).toBe('2026/S01925\nPO 00089314');
    expect(formatOrdenPoCell(order({}))).toBe('2026/S01925');
    expect(formatOrdenPoCell(order({ orden: 'S1\nS2', poNumber: 'A\nB' }))).toBe('S1\nS2\nPO A\nPO B');
  });

  it('etiqueta de una línea: une varias PO y usa S/N sin PO', () => {
    expect(formatPoLabel('00089314')).toBe('00089314');
    expect(formatPoLabel('A\nB')).toBe('A / B');
    expect(formatPoLabel('  ')).toBe('S/N');
    expect(formatPoLabel(undefined)).toBe('S/N');
  });

  it('hot stamp consolidado conserva TODAS las PO, sin repetir', () => {
    const [synthetic] = consolidateHotStamps([
      order({ pieza: 'LETTER M, HOT STAMP', orden: 'S1', poNumber: '111' }),
      order({ pieza: 'LETTER X, HOT STAMP', orden: 'S2', poNumber: '222' }),
      order({ pieza: 'LETTER Y, HOT STAMP', orden: 'S3', poNumber: '111' }),
      order({ pieza: 'LETTER Z, HOT STAMP', orden: 'S4' }),
    ]);
    expect(synthetic.poNumber).toBe('111\n222');
  });
});

describe('ingeniero / requisitor', () => {
  const view = (over: Partial<OdooOrderView>) => ({
    requisitor: null,
    engineer: null,
    engineerSource: null,
    ...over,
  }) as OdooOrderView;

  it('prefiere el ingeniero resuelto y cae al requisitor en docs viejos', () => {
    expect(orderRequester(view({ requisitor: 'MIGUEL SANTILLAN', engineer: 'Miguel Santillan' }))).toBe('Miguel Santillan');
    expect(orderRequester(view({ requisitor: 'ING. CARLOS' }))).toBe('ING. CARLOS');
    expect(requesterKey(view({}))).toBe('Sin Requisitor');
  });

  it('marca cuándo el ingeniero salió de las notas', () => {
    expect(isRequesterFromNotes(view({ engineerSource: 'note' }))).toBe(true);
    expect(isRequesterFromNotes(view({ engineerSource: 'line_note' }))).toBe(true);
    expect(isRequesterFromNotes(view({ engineerSource: 'field' }))).toBe(false);
  });
});

describe('odooDatetimeToLocalDate', () => {
  it('convierte el datetime UTC de Odoo a la fecha local y tolera vacíos', () => {
    const utc = '2026-09-23 15:06:58';
    const local = new Date(Date.UTC(2026, 8, 23, 15, 6, 58));
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(odooDatetimeToLocalDate(utc))
      .toBe(`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`);
    expect(odooDatetimeToLocalDate(null)).toBeNull();
    expect(odooDatetimeToLocalDate('no es fecha')).toBeNull();
  });
});
