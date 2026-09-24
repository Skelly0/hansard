import { describe, expect, it } from 'vitest';
import { compareSimDates, firstSentence, formatSimDate, simYear, simYearsBetween } from './format';

describe('simulation dates', () => {
  it('reads the year from the string, so New Year dates do not slip back a year west of UTC', () => {
    expect(simYear('2050-01-01')).toBe('2050');
    expect(formatSimDate('2050-01-01')).toBe('1 January 2050');
  });

  it('handles freeform dates without going through Date', () => {
    expect(simYear('Year 4, Month 3')).toBe('Year 4');
    expect(formatSimDate('Year 4, Month 3')).toBe('Year 4, Month 3');
    expect(simYear(undefined)).toBe('?');
    expect(simYear('sometime')).toBe('sometime');
  });

  it('counts whole years between dates, stopping short of the anniversary', () => {
    expect(simYearsBetween('2050-01-01', '2077-01-01')).toBe(27);
    expect(simYearsBetween('2050-06-15', '2077-06-14')).toBe(26);
    expect(simYearsBetween('Year 1, Month 5', 'Year 30, Month 5')).toBe(29);
    expect(simYearsBetween('2050-01-01', null)).toBeNull();
  });

  it('orders dates chronologically, unreadable ones first', () => {
    const dates = ['2077-03-01', 'unknown', '2076-12-31', '2077-01-01'];
    expect([...dates].sort(compareSimDates)).toEqual(['unknown', '2076-12-31', '2077-01-01', '2077-03-01']);
  });
});

describe('firstSentence', () => {
  it('stops at the first sentence end followed by a space', () => {
    expect(firstSentence('Born in Leeds. Rose to power.')).toBe('Born in Leeds.');
    expect(firstSentence('Who? Nobody knows.')).toBe('Who?');
    expect(firstSentence('v1.2 is out')).toBe('v1.2 is out');
    expect(firstSentence('')).toBe('');
  });

  it('shortens a long sentence at a word boundary', () => {
    expect(firstSentence('one two three four five', 12)).toBe('one two\u2026');
  });

  it('avoids regex lookbehind, which older Safari cannot compile', () => {
    expect(firstSentence.toString()).not.toContain('?<');
  });
});
