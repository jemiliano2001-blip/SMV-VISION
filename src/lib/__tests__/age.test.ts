import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../age';

describe('formatRelativeTime', () => {
  it('returns "hace un momento" for less than 1 minute ago', () => {
    const date = new Date(Date.now() - 30_000); // 30 seconds ago
    expect(formatRelativeTime(date)).toBe('hace un momento');
  });

  it('returns "hace un momento" for a date slightly in the future (clock skew)', () => {
    const date = new Date(Date.now() + 5_000); // 5 seconds in the future
    expect(formatRelativeTime(date)).toBe('hace un momento');
  });

  it('returns "hace N min" for 1–59 minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60_000); // 5 minutes ago
    expect(formatRelativeTime(date)).toBe('hace 5 min');
  });

  it('returns "hace 1 min" for exactly 1 minute ago', () => {
    const date = new Date(Date.now() - 60_000);
    expect(formatRelativeTime(date)).toBe('hace 1 min');
  });

  it('returns "hace Nh" for 1–23 hours ago', () => {
    const date = new Date(Date.now() - 3 * 3_600_000); // 3 hours ago
    expect(formatRelativeTime(date)).toBe('hace 3h');
  });

  it('returns "hace Nd" for 1+ days ago', () => {
    const date = new Date(Date.now() - 2 * 86_400_000); // 2 days ago
    expect(formatRelativeTime(date)).toBe('hace 2d');
  });
});
