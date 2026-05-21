import { describe, expect, it } from 'vitest';

import {
  advanceDateByTicks,
  birthDateForAge,
  calculateAge,
  formatSimDate,
  parseSimDate,
} from './aging.js';

describe('birthDateForAge', () => {
  it('anchors month/day to the ISO sim clock', () => {
    expect(birthDateForAge('2075-06-15', 30)).toBe('2045-06-15');
  });

  it('uses month=1, day=1 for freeform sim clocks', () => {
    expect(birthDateForAge('Year 2075, Month 6', 30)).toBe('Year 2045, Month 1');
  });

  it('falls back to the canonical season date when the clock is unparseable', () => {
    // DEFAULT_SIMULATION_CURRENT_DATE = '2075-01-01' — month/day anchor to that.
    expect(birthDateForAge('not-a-date', 30)).toBe('2045-01-01');
  });

  it('round-trips with calculateAge for ISO clocks at various months/days', () => {
    const clocks = [
      '2075-01-01',
      '2075-06-15',
      '2075-12-31',
      '2080-03-09',
      '2099-11-30',
      '2100-02-28',
    ];
    for (const clock of clocks) {
      for (const age of [0, 1, 18, 30, 65, 100]) {
        const birth = birthDateForAge(clock, age);
        expect(calculateAge(birth, clock)).toBe(age);
      }
    }
  });
});

describe('advanceDateByTicks', () => {
  it('advances ISO dates by months correctly', () => {
    expect(advanceDateByTicks('2075-06-15', 5, 'month')).toBe('2075-11-15');
  });

  it('clamps ISO month and year advances to the target month', () => {
    expect(advanceDateByTicks('2026-01-31', 1, 'month')).toBe('2026-02-28');
    expect(advanceDateByTicks('2026-01-31', 12, 'month')).toBe('2027-01-31');
    expect(advanceDateByTicks('2024-02-29', 1, 'year')).toBe('2025-02-28');
  });

  it('throws on unparseable dates rather than corrupting the clock', () => {
    expect(() => advanceDateByTicks('garbage', 5, 'month')).toThrow();
  });

  it('still throws on day/week ticks for freeform dates', () => {
    expect(() => advanceDateByTicks('Year 2075, Month 6', 3, 'day')).toThrow();
    expect(() => advanceDateByTicks('Year 2075, Month 6', 3, 'week')).toThrow();
  });
});

describe('parseSimDate + formatSimDate round-trip', () => {
  it('round-trips ISO dates', () => {
    const parsed = parseSimDate('2075-06-15');
    expect(parsed).not.toBeNull();
    expect(formatSimDate(parsed!)).toBe('2075-06-15');
  });
});
