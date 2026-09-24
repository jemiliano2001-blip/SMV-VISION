import { describe, expect, it } from 'vitest';
import {
  detectFieldsByLabel,
  extractEngineerFromText,
  extractPoFromText,
  htmlToText,
  isPlaceholderPo,
  odooText,
  resolveEngineer,
  resolvePo,
} from '../../../functions/src/odooFields';

describe('odooText', () => {
  it('lee string, número y many2one; false/null → ""', () => {
    expect(odooText('  00089314 ')).toBe('00089314');
    expect(odooText(89314)).toBe('89314');
    expect(odooText([7, 'Juan Pérez'])).toBe('Juan Pérez');
    expect(odooText(false)).toBe('');
    expect(odooText(null)).toBe('');
  });
});

describe('htmlToText', () => {
  it('convierte el HTML de la nota de Odoo en líneas limpias', () => {
    const html = '<p>Orden de compra:&nbsp;00089314</p><p>Ing. Juan&nbsp;P&eacute;rez<br>Tool &amp; Die</p>';
    expect(htmlToText(html)).toBe('Orden de compra: 00089314\nIng. Juan P&eacute;rez\nTool & Die');
  });

  it('decodifica entidades numéricas y no decodifica dos veces &amp;lt;', () => {
    expect(htmlToText('<p>Ram&#243;n &amp;lt;x&amp;gt;</p>')).toBe('Ramón &lt;x&gt;');
  });
});

describe('isPlaceholderPo', () => {
  it('trata como vacío lo que se captura cuando aún no hay OC', () => {
    for (const v of ['', '  ', 'Pendiente', 'FALTA OC', 'sin oc', 'N/A', 'S/N', '-', 'no.']) {
      expect(isPlaceholderPo(v)).toBe(true);
    }
    expect(isPlaceholderPo('00089314')).toBe(false);
  });
});

describe('extractPoFromText', () => {
  it('encuentra la PO en los formatos comunes', () => {
    expect(extractPoFromText('Orden de compra: 00089314')).toBe('00089314');
    expect(extractPoFromText('Entregar con OC 4500123 en almacén')).toBe('4500123');
    expect(extractPoFromText('P.O. #778-1')).toBe('778-1');
    expect(extractPoFromText('orden de compra no. 12345')).toBe('12345');
  });

  it('ignora menciones sin número y palabras que solo contienen "po"/"oc"', () => {
    expect(extractPoFromText('OC pendiente, la manda el lunes')).toBeNull();
    expect(extractPoFromText('Poco material, TOOL CRIB')).toBeNull();
    expect(extractPoFromText('OC no disponible')).toBeNull();
  });
});

describe('resolvePo', () => {
  it('caso real 2026/S01925: la PO vive en origin y client_order_ref viene vacío', () => {
    expect(
      resolvePo({
        orderName: '2026/S01925',
        origin: '00089314',
        clientOrderRef: '',
        noteText: 'Orden de compra: 00089314',
      }),
    ).toEqual({ value: '00089314', source: 'origin', conflict: null });
  });

  it('prioriza campo custom → origin → client_order_ref → nota', () => {
    expect(resolvePo({ orderName: 'X', customFieldValues: ['111'], origin: '222', clientOrderRef: '333' }))
      .toMatchObject({ value: '111', source: 'custom_field' });
    expect(resolvePo({ orderName: 'X', origin: '', clientOrderRef: '333' }))
      .toMatchObject({ value: '333', source: 'client_order_ref' });
    expect(resolvePo({ orderName: 'X', noteText: 'OC: 444' }))
      .toEqual({ value: '444', source: 'note', conflict: null });
  });

  it('descarta placeholders y referencias internas de Odoo en origin', () => {
    expect(resolvePo({ orderName: '2026/S01925', origin: 'Pendiente', clientOrderRef: '555' }))
      .toMatchObject({ value: '555', source: 'client_order_ref' });
    expect(resolvePo({ orderName: '2026/S01925', origin: '2026/S01800' }))
      .toEqual({ value: null, source: null, conflict: null });
    expect(resolvePo({ orderName: '2026/S01925', origin: 'WH/OUT/00123' }).value).toBeNull();
  });

  it('quita el prefijo "OC:" del valor del campo', () => {
    expect(resolvePo({ orderName: 'X', origin: 'OC: 00089314' }).value).toBe('00089314');
    expect(resolvePo({ orderName: 'X', origin: 'POLEA-123' }).value).toBe('POLEA-123');
  });

  it('marca conflicto cuando la nota trae otra PO, ignorando ceros a la izquierda', () => {
    expect(resolvePo({ orderName: 'X', origin: '00089314', noteText: 'OC 89314' }).conflict).toBeNull();
    expect(resolvePo({ orderName: 'X', origin: '00089314', noteText: 'OC 00089999' }).conflict).toBe('00089999');
  });
});

describe('extractEngineerFromText', () => {
  it('saca el nombre tras las etiquetas comunes y lo normaliza', () => {
    expect(extractEngineerFromText('Ing. Juan Pérez')).toBe('Juan Pérez');
    expect(extractEngineerFromText('Orden de compra: 1\nREQUISITOR: ING. MARIA DE LA LUZ')).toBe('Maria de la Luz');
    expect(extractEngineerFromText('Solicitado por: carlos ramírez, urgente')).toBe('Carlos Ramírez');
    expect(extractEngineerFromText('Atn. Pedro Gómez 55-1234')).toBe('Pedro Gómez');
  });

  it('caso real 2026/S01937: nombre suelto en la nota, seguido de "Pendiente"', () => {
    expect(extractEngineerFromText(htmlToText('<p>Miguel Santillan</p><p>Pendiente</p>'))).toBe('Miguel Santillan');
    expect(extractEngineerFromText('MARIA DE LA LUZ')).toBe('Maria de la Luz');
  });

  it('no inventa nombres con líneas de taller, frases en minúscula o una sola palabra', () => {
    expect(extractEngineerFromText('Servicio de maquinado\nOrden de compra: 00089314')).toBeNull();
    expect(extractEngineerFromText('Requisitor: 12345')).toBeNull();
    expect(extractEngineerFromText('TOOL CRIB')).toBeNull();
    expect(extractEngineerFromText('Tooling para revisar resorte')).toBeNull();
    expect(extractEngineerFromText('Pendiente')).toBeNull();
    expect(extractEngineerFromText('Entrega Urgente')).toBeNull();
  });
});

describe('resolveEngineer', () => {
  it('campo → nota → notas de línea', () => {
    expect(resolveEngineer({ fieldValues: ['JUAN PEREZ'], noteText: 'Ing. Otro' }))
      .toEqual({ value: 'Juan Perez', source: 'field' });
    expect(resolveEngineer({ fieldValues: [''], noteText: 'Ing. Luis Soto' }))
      .toEqual({ value: 'Luis Soto', source: 'note' });
    expect(resolveEngineer({ noteText: 'nada', lineNotes: ['', 'ing Ana Ruiz'] }))
      .toEqual({ value: 'Ana Ruiz', source: 'line_note' });
    expect(resolveEngineer({})).toEqual({ value: null, source: null });
  });
});

describe('detectFieldsByLabel', () => {
  it('encuentra campos de Studio por etiqueta, sin acentos y filtrando por tipo', () => {
    const meta = {
      x_studio_ingeniero: { string: 'Ingeniero', type: 'char' },
      x_studio_nota_linea: { string: 'Nota de línea', type: 'text' },
      x_studio_fecha: { string: 'Nota fecha', type: 'date' },
      name: { string: 'Descripción', type: 'text' },
    };
    expect(detectFieldsByLabel(meta, ['ingeniero'])).toEqual(['x_studio_ingeniero']);
    expect(detectFieldsByLabel(meta, ['nota de linea'])).toEqual(['x_studio_nota_linea']);
  });
});
