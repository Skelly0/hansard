import { describe, expect, it } from 'vitest';
import { formatRemaining } from './Countdown';

describe('formatRemaining', () => {
  const m = 60_000;
  it('uses the two most significant units', () => {
    expect(formatRemaining(2 * 1440 * m + 4 * 60 * m + 30 * m)).toBe('2d 4h');
    expect(formatRemaining(3 * 60 * m + 12 * m)).toBe('3h 12m');
    expect(formatRemaining(8 * m + 20_000)).toBe('8m');
  });
  it('drops zero minor units and handles the edges', () => {
    expect(formatRemaining(1440 * m)).toBe('1d');
    expect(formatRemaining(120 * m)).toBe('2h');
    expect(formatRemaining(30_000)).toBe('under a minute');
    expect(formatRemaining(0)).toBe('now');
  });
});
