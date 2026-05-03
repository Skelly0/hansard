import { describe, it, expect } from 'vitest';
import { formatTrendDelta } from './trendFormat';

describe('formatTrendDelta', () => {
  it('formats positive deltas with + prefix', () => {
    expect(formatTrendDelta(7, 5)).toBe('+2 this week');
    expect(formatTrendDelta(1, 0)).toBe('+1 this week');
  });

  it('formats negative deltas with real minus glyph', () => {
    expect(formatTrendDelta(3, 8)).toBe('−5 this week');
    expect(formatTrendDelta(0, 1)).toBe('−1 this week');
  });

  it('formats zero delta as "no change"', () => {
    expect(formatTrendDelta(5, 5)).toBe('— no change');
    expect(formatTrendDelta(0, 0)).toBe('— no change');
  });

  it('returns null when prevWeek is missing', () => {
    expect(formatTrendDelta(5, undefined)).toBeNull();
    expect(formatTrendDelta(5, null)).toBeNull();
  });
});
