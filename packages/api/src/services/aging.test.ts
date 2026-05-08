import { describe, it, expect } from 'vitest';
import {
  parseSimDate,
  calculateAge,
  birthDateForAge,
  advanceDateByTicks,
} from '@hansard/shared';

describe('parseSimDate', () => {
  it('parses ISO dates', () => {
    expect(parseSimDate('1923-06-15')).toEqual({
      format: 'iso', year: 1923, month: 6, day: 15,
    });
  });

  it('parses freeform "Year X, Month Y"', () => {
    expect(parseSimDate('Year 5, Month 3')).toEqual({
      format: 'freeform', year: 5, month: 3, day: 1,
    });
  });

  it('returns null on garbage', () => {
    expect(parseSimDate('blah')).toBeNull();
  });
});

describe('calculateAge', () => {
  it('subtracts birth year from current year for ISO dates', () => {
    expect(calculateAge('1990-01-01', '2026-05-09')).toBe(36);
  });

  it('subtracts a year if birthday has not yet occurred this year', () => {
    expect(calculateAge('1990-12-25', '2026-05-09')).toBe(35);
  });

  it('handles same-day birthday correctly', () => {
    expect(calculateAge('1990-05-09', '2026-05-09')).toBe(36);
  });

  it('works for freeform dates (year-only diff)', () => {
    expect(calculateAge('Year 1, Month 1', 'Year 31, Month 6')).toBe(30);
  });

  it('returns 0 for negative results (birth in the future)', () => {
    expect(calculateAge('2030-01-01', '2026-05-09')).toBe(0);
  });

  it('returns null when either date is missing', () => {
    expect(calculateAge(null, '2026-05-09')).toBeNull();
    expect(calculateAge('1990-01-01', null)).toBeNull();
  });
});

describe('birthDateForAge', () => {
  it('anchors birthDate to ISO sim date', () => {
    expect(birthDateForAge('1923-06-15', 30)).toBe('1893-01-01');
  });

  it('anchors birthDate to freeform sim date', () => {
    expect(birthDateForAge('Year 10, Month 4', 30)).toBe('Year -20, Month 1');
  });
});

describe('advanceDateByTicks', () => {
  it('advances ISO date by year', () => {
    expect(advanceDateByTicks('1923-06-15', 5, 'year')).toBe('1928-06-15');
  });

  it('advances ISO date by month', () => {
    expect(advanceDateByTicks('1923-06-15', 8, 'month')).toBe('1924-02-15');
  });

  it('advances ISO date by day', () => {
    expect(advanceDateByTicks('1923-06-15', 10, 'day')).toBe('1923-06-25');
  });

  it('advances freeform date by month with rollover', () => {
    expect(advanceDateByTicks('Year 5, Month 11', 3, 'month')).toBe('Year 6, Month 2');
  });

  it('advances freeform date by year', () => {
    expect(advanceDateByTicks('Year 5, Month 3', 2, 'year')).toBe('Year 7, Month 3');
  });

  it('throws when freeform date asked to advance by day', () => {
    expect(() => advanceDateByTicks('Year 5, Month 3', 7, 'day')).toThrow(/freeform/i);
  });

  it('throws when freeform date asked to advance by week', () => {
    expect(() => advanceDateByTicks('Year 5, Month 3', 2, 'week')).toThrow(/freeform/i);
  });
});

describe('age progression integration', () => {
  it('advancing a year then computing age yields exactly +1', () => {
    const start = '1923-06-15';
    const next = advanceDateByTicks(start, 1, 'year');
    expect(calculateAge('1893-06-15', start)).toBe(30);
    expect(calculateAge('1893-06-15', next)).toBe(31);
  });

  it('advancing 11 monthly ticks then computing age yields the same year', () => {
    // Regression for the Math.floor bug: previously the cached currentAge
    // never advanced under sub-year ticks. Now age comes from birthDate
    // vs sim date directly, so 11 monthly ticks = no birthday yet.
    let date = '1923-06-15';
    for (let i = 0; i < 11; i++) date = advanceDateByTicks(date, 1, 'month');
    expect(date).toBe('1924-05-15');
    expect(calculateAge('1893-06-15', date)).toBe(30); // birthday is later in May 15 < Jun 15
  });

  it('advancing 12 monthly ticks rolls over the birthday', () => {
    let date = '1923-06-15';
    for (let i = 0; i < 12; i++) date = advanceDateByTicks(date, 1, 'month');
    expect(date).toBe('1924-06-15');
    expect(calculateAge('1893-06-15', date)).toBe(31);
  });
});
