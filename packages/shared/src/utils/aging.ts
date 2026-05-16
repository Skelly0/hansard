// ============================================================
// Aging / sim-date helpers — single source of truth for the
// simulation's date arithmetic and age computation.
// ============================================================

import { DEFAULT_SIMULATION_CURRENT_DATE } from '../constants/config.js';

export type SimDateFormat = 'iso' | 'freeform';

export interface ParsedSimDate {
  format: SimDateFormat;
  year: number;
  month: number;            // 1..12
  day: number;              // 1..31 (always 1 for freeform)
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FREEFORM_RE = /^Year\s+(\d+),?\s*Month\s+(\d+)$/i;

export function parseSimDate(dateStr: string): ParsedSimDate | null {
  const iso = dateStr.match(ISO_RE);
  if (iso) {
    return {
      format: 'iso',
      year: parseInt(iso[1]!, 10),
      month: parseInt(iso[2]!, 10),
      day: parseInt(iso[3]!, 10),
    };
  }

  const freeform = dateStr.match(FREEFORM_RE);
  if (freeform) {
    return {
      format: 'freeform',
      year: parseInt(freeform[1]!, 10),
      month: parseInt(freeform[2]!, 10),
      day: 1,
    };
  }

  return null;
}

export function formatSimDate(parts: ParsedSimDate): string {
  if (parts.format === 'iso') {
    const yyyy = String(parts.year).padStart(4, '0');
    const mm = String(parts.month).padStart(2, '0');
    const dd = String(parts.day).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return `Year ${parts.year}, Month ${parts.month}`;
}

/**
 * Advance a sim date by N ticks of the given unit.
 * Throws on day/week ticks against freeform dates (no day-resolution).
 */
export function advanceDateByTicks(
  dateStr: string,
  ticks: number,
  tickUnit: 'day' | 'week' | 'month' | 'year' | string,
): string {
  const parsed = parseSimDate(dateStr);
  if (!parsed) {
    // Throw rather than silently corrupting the simulation clock with a
    // labelled fallback like "garbage +5 months". Callers should catch this
    // and surface a useful staff-facing error.
    throw new Error(
      `Cannot advance unparseable sim date "${dateStr}" — expected ISO (YYYY-MM-DD) ` +
      `or freeform ("Year X, Month Y"). The simulation clock must hold a parseable date.`,
    );
  }

  if (parsed.format === 'freeform' && (tickUnit === 'day' || tickUnit === 'week')) {
    throw new Error(
      `Cannot advance freeform sim date "${dateStr}" by ${tickUnit} ticks — ` +
      `freeform dates have month resolution. Use ISO dates (YYYY-MM-DD) or change tickUnit to month/year.`,
    );
  }

  if (parsed.format === 'iso') {
    const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
    switch (tickUnit) {
      case 'day': date.setUTCDate(date.getUTCDate() + ticks); break;
      case 'week': date.setUTCDate(date.getUTCDate() + ticks * 7); break;
      case 'month': date.setUTCMonth(date.getUTCMonth() + ticks); break;
      case 'year': date.setUTCFullYear(date.getUTCFullYear() + ticks); break;
      default: date.setUTCFullYear(date.getUTCFullYear() + ticks);
    }
    return formatSimDate({
      format: 'iso',
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  }

  // Freeform: month or year resolution only.
  let { year, month } = parsed;
  if (tickUnit === 'year') {
    year += ticks;
  } else {
    // month
    month += ticks;
    while (month > 12) { month -= 12; year++; }
    while (month < 1) { month += 12; year--; }
  }
  return formatSimDate({ format: 'freeform', year, month, day: 1 });
}

/**
 * Calculate a player's whole-year age at a given sim date, using birthDate
 * as the source of truth. Returns null if either date is unparseable or
 * formats are incompatible.
 */
export function calculateAge(birthDate: string | null, currentDate: string | null): number | null {
  if (!birthDate || !currentDate) return null;

  const birth = parseSimDate(birthDate);
  const now = parseSimDate(currentDate);
  if (!birth || !now) return null;

  // Mixed formats: best-effort year-only diff.
  if (birth.format !== now.format) {
    return Math.max(0, now.year - birth.year);
  }

  let age = now.year - birth.year;
  // Subtract a year if the birthday hasn't yet occurred in the current year.
  if (now.month < birth.month || (now.month === birth.month && now.day < birth.day)) {
    age -= 1;
  }
  return Math.max(0, age);
}

/**
 * Build a birthDate string anchored to the simulation clock's currentDate.
 * For ISO clocks the birthday is anchored to the clock's current month/day
 * so that `calculateAge(birthDateForAge(clock, N), clock) === N` at any
 * month/day. Freeform clocks have month resolution only and so anchor to
 * month=1, day=1 of the resulting birth year.
 */
export function birthDateForAge(currentDate: string, ageYears: number): string {
  const parsed = parseSimDate(currentDate);
  if (!parsed) {
    // Fallback to the canonical season date. Shouldn't happen in practice;
    // callers should pass the simulation clock's currentDate.
    return birthDateForAge(DEFAULT_SIMULATION_CURRENT_DATE, ageYears);
  }

  const birthYear = parsed.year - ageYears;
  if (parsed.format === 'iso') {
    return formatSimDate({
      format: 'iso',
      year: birthYear,
      month: parsed.month,
      day: parsed.day,
    });
  }
  return formatSimDate({ format: 'freeform', year: birthYear, month: 1, day: 1 });
}

/**
 * Convert a tick-unit string into the fractional years-per-tick.
 * Used for previews / displays — the authoritative age comes from
 * calculateAge(birthDate, currentDate).
 */
export function ageIncrementPerTick(tickUnit: string): number {
  switch (tickUnit) {
    case 'year': return 1;
    case 'month': return 1 / 12;
    case 'week': return 1 / 52;
    case 'day': return 1 / 365;
    default: return 1;
  }
}
