import { describe, expect, it } from 'vitest';
import { parseSimDate, planFix, type PlayerRow } from './fix-character-birth-dates.js';

const SIM_CLOCK = parseSimDate('2075-01-01')!;
const AGE_GAP_THRESHOLD = 40;

function makePlayer(over: Partial<PlayerRow> = {}): PlayerRow {
  return {
    id: 'player-1',
    discord_username: 'user',
    character_name: 'Sofia Kostornaia',
    is_alive: true,
    starting_age: 44,
    current_age: 94,
    birth_date: '1981-01-01',
    death_date: null,
    ...over,
  };
}

describe('fix-character-birth-dates / planFix', () => {
  it('flags an alive character whose implied age exceeds intended age by 40+', () => {
    const plan = planFix(makePlayer(), SIM_CLOCK, AGE_GAP_THRESHOLD, null);
    expect(plan).not.toBeNull();
    expect(plan!.oldBirthDate).toBe('1981-01-01');
    // Sim clock 2075-01-01, starting_age 44, birthday is Jan 1 → has passed
    // on the 1st by the "≥ day" inclusive check, so birth year = 2075 − 44 = 2031.
    expect(plan!.newBirthDate).toBe('2031-01-01');
    expect(plan!.newCurrentAge).toBe(44);
  });

  it('recomputes age against the death date for dead characters', () => {
    const deathClock = parseSimDate('2075-06-15');
    const plan = planFix(
      makePlayer({
        is_alive: false,
        starting_age: 44,
        current_age: 94,
        birth_date: '1981-07-09',
        death_date: '2075-06-15',
      }),
      SIM_CLOCK,
      AGE_GAP_THRESHOLD,
      deathClock,
    );
    expect(plan).not.toBeNull();
    // Death on June 15; birthday July 9 hasn't passed yet that year → birth = 2075 − 44 − 1 = 2030
    expect(plan!.newBirthDate).toBe('2030-07-09');
    expect(plan!.newCurrentAge).toBe(44);
  });

  it('does NOT flag a correctly-aged 30-year-old (birth_year 2045)', () => {
    const plan = planFix(
      makePlayer({ starting_age: 30, current_age: 30, birth_date: '2045-04-12' }),
      SIM_CLOCK,
      AGE_GAP_THRESHOLD,
      null,
    );
    expect(plan).toBeNull();
  });

  it('does NOT flag a correctly-aged 70-year-old (birth_year 2005)', () => {
    const plan = planFix(
      makePlayer({ starting_age: 70, current_age: 70, birth_date: '2005-01-01' }),
      SIM_CLOCK,
      AGE_GAP_THRESHOLD,
      null,
    );
    expect(plan).toBeNull();
  });

  it('does NOT flag a character who has aged 5 sim years legitimately', () => {
    const plan = planFix(
      makePlayer({ starting_age: 30, current_age: 35, birth_date: '2045-04-12' }),
      parseSimDate('2080-04-12')!,
      AGE_GAP_THRESHOLD,
      null,
    );
    expect(plan).toBeNull();
  });

  it('returns null for freeform birth dates (the bug never produced these)', () => {
    const plan = planFix(makePlayer({ birth_date: 'Year 4, Month 3' }), SIM_CLOCK, AGE_GAP_THRESHOLD, null);
    expect(plan).toBeNull();
  });

  it('returns null when both starting_age and current_age are missing', () => {
    const plan = planFix(
      makePlayer({ starting_age: null, current_age: null }),
      SIM_CLOCK,
      AGE_GAP_THRESHOLD,
      null,
    );
    expect(plan).toBeNull();
  });

  it('falls back to current_age when starting_age is missing', () => {
    const plan = planFix(
      makePlayer({ starting_age: null, current_age: 44 }),
      SIM_CLOCK,
      AGE_GAP_THRESHOLD,
      null,
    );
    expect(plan).not.toBeNull();
    expect(plan!.newCurrentAge).toBe(44);
  });

  it('preserves the original month/day when snapping the birth year', () => {
    const plan = planFix(
      makePlayer({ birth_date: '1981-07-09', starting_age: 44 }),
      SIM_CLOCK,
      AGE_GAP_THRESHOLD,
      null,
    );
    // Sim clock 2075-01-01; July 9 has NOT yet passed → birth year = 2075 − 44 − 1 = 2030
    expect(plan!.newBirthDate).toBe('2030-07-09');
  });

  it('uses sim clock for dead rows when death_date is missing', () => {
    const plan = planFix(
      makePlayer({
        is_alive: false,
        starting_age: 70,
        current_age: 119,
        birth_date: '1956-01-01',
        death_date: null,
      }),
      SIM_CLOCK,
      AGE_GAP_THRESHOLD,
      null,
    );
    expect(plan!.newBirthDate).toBe('2005-01-01');
    expect(plan!.newCurrentAge).toBe(70);
  });
});

describe('fix-character-birth-dates / parseSimDate', () => {
  it('parses ISO dates', () => {
    expect(parseSimDate('2075-04-12')).toEqual({ format: 'iso', year: 2075, month: 4, day: 12 });
  });

  it('parses freeform dates', () => {
    expect(parseSimDate('Year 4, Month 3')).toEqual({ format: 'freeform', year: 4, month: 3, day: 1 });
  });

  it('returns null for unparseable input', () => {
    expect(parseSimDate('garbage')).toBeNull();
    expect(parseSimDate(null)).toBeNull();
  });
});
