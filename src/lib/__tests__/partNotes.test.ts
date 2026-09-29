import { describe, expect, it } from 'vitest';
import { composeOtNotes, MAX_NOTE_LENGTH, MAX_NOTES_PER_PART, noteDocId, normalizePartNotes } from '../partNotes';

describe('partNotes', () => {
  it('normaliza notas válidas y descarta basura', () => {
    const notes = normalizePartNotes([
      { id: 'a', texto: '  Rebabear  ', imprimirEnOT: true },
      { id: 'b', texto: '', imprimirEnOT: true },
      { id: 'c', texto: 'Sin flag' },
      null,
      42,
    ]);
    expect(notes).toEqual([
      { id: 'a', texto: 'Rebabear', imprimirEnOT: true },
      { id: 'c', texto: 'Sin flag', imprimirEnOT: false },
    ]);
  });

  it('recorta el texto a 300 caracteres y limita a 10 notas', () => {
    const long = normalizePartNotes([{ id: 'a', texto: 'x'.repeat(500), imprimirEnOT: true }]);
    expect(long[0].texto).toHaveLength(MAX_NOTE_LENGTH);
    const many = normalizePartNotes(Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, texto: `t${i}`, imprimirEnOT: true })));
    expect(many).toHaveLength(MAX_NOTES_PER_PART);
  });

  it('entrada que no es arreglo devuelve []', () => {
    expect(normalizePartNotes(undefined)).toEqual([]);
    expect(normalizePartNotes('hola')).toEqual([]);
  });

  it('composeOtNotes une con " · " y omite vacíos', () => {
    expect(composeOtNotes(['Rebabear', ' Rectificar '], 'Urgente')).toBe('Rebabear · Rectificar · Urgente');
    expect(composeOtNotes([], '  ')).toBe('');
    expect(composeOtNotes([], 'Solo corrida')).toBe('Solo corrida');
  });

  it('noteDocId es determinista y seguro para Firestore', () => {
    expect(noteDocId('1012-05-chico')).toBe('1012_05_CHICO');
    expect(noteDocId('90-1012-06.ISO')).toBe('90_1012_06');
  });
});
