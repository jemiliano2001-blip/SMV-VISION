import { describe, expect, it } from 'vitest';
import { extractResponseText } from '../geminiProxy';

describe('extractResponseText', () => {
  it('returns empty string for no candidates', () => {
    expect(extractResponseText([])).toBe('');
  });

  it('returns empty string when the candidate has no parts', () => {
    expect(extractResponseText([{ content: {} }])).toBe('');
    expect(extractResponseText([{}])).toBe('');
  });

  it('concatenates text parts from the first candidate', () => {
    const candidates = [
      { content: { parts: [{ text: 'hello ' }, { text: 'world' }] } },
    ];
    expect(extractResponseText(candidates)).toBe('hello world');
  });

  it('skips "thought" parts', () => {
    const candidates = [
      {
        content: {
          parts: [
            { text: 'reasoning...', thought: true },
            { text: 'final answer' },
          ],
        },
      },
    ];
    expect(extractResponseText(candidates)).toBe('final answer');
  });

  it('skips non-text parts (e.g. inlineData) without throwing', () => {
    const candidates = [
      {
        content: {
          parts: [
            { inlineData: { data: 'abc123', mimeType: 'image/png' } },
            { text: '{"box":[1,2,3,4]}' },
          ],
        },
      },
    ];
    expect(extractResponseText(candidates)).toBe('{"box":[1,2,3,4]}');
  });

  it('only reads the first candidate, ignoring the rest', () => {
    const candidates = [
      { content: { parts: [{ text: 'first' }] } },
      { content: { parts: [{ text: 'second' }] } },
    ];
    expect(extractResponseText(candidates)).toBe('first');
  });
});
