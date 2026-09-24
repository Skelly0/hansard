/**
 * Shared display formatters. British conventions throughout (day-month-year,
 * "Sept"), because the chamber keeps its record in en-GB.
 */

const LOCALE = 'en-GB';

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "23 Sept 2026" (or "23 Sept" with `withYear: false`). Returns "—" for missing/invalid input. */
export function formatDate(
  value: string | number | Date | null | undefined,
  { withYear = true }: { withYear?: boolean } = {},
): string {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** "23 Sept 2026, 14:05" */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 hours ago", "in 2 days", "yesterday". */
export function relativeTime(value: string | number | Date | null | undefined, now = Date.now()): string {
  const date = toDate(value);
  if (!date) return '—';
  const diffSec = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return diffSec < 0 ? 'just now' : 'in a moment';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86_400 * 30) return rtf.format(Math.round(diffSec / 86_400), 'day');
  if (abs < 86_400 * 365) return rtf.format(Math.round(diffSec / (86_400 * 30)), 'month');
  return rtf.format(Math.round(diffSec / (86_400 * 365)), 'year');
}

/**
 * Simulation dates are either ISO (`2075-01-01`) or freeform
 * (`Year 4, Month 3`). ISO dates render as "1 January 2075"; anything else
 * is shown verbatim.
 */
export function formatSimDate(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Year, month and day of a simulation date, read straight from the string.
 * Never `new Date` a simulation date: `2075-01-01` parses as UTC midnight,
 * which is 31 December 2074 anywhere west of Greenwich, and freeform dates
 * do not parse at all. Freeform dates have month resolution (day 0).
 */
function simDateParts(value: string | null | undefined): [number, number, number] | null {
  if (!value) return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  const free = /^Year\s+(\d+)(?:,\s*Month\s+(\d+))?/i.exec(text);
  if (free) return [Number(free[1]), Number(free[2] ?? 0), 0];
  return null;
}

/** "2075", or "Year 4" for a freeform date; the raw text if unrecognised. */
export function simYear(value: string | null | undefined): string {
  if (!value) return '?';
  const parts = simDateParts(value);
  if (!parts) return value;
  return /^\d{4}-/.test(value.trim()) ? String(parts[0]) : `Year ${parts[0]}`;
}

/** Whole years from one simulation date to another, or null if either is unreadable. */
export function simYearsBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = simDateParts(from);
  const b = simDateParts(to);
  if (!a || !b) return null;
  const beforeAnniversary = b[1] < a[1] || (b[1] === a[1] && b[2] < a[2]);
  return b[0] - a[0] - (beforeAnniversary ? 1 : 0);
}

/** Sort comparator for simulation dates, oldest first; unreadable dates sort first. */
export function compareSimDates(a: string | null | undefined, b: string | null | undefined): number {
  const pa = simDateParts(a) ?? [-Infinity, 0, 0];
  const pb = simDateParts(b) ?? [-Infinity, 0, 0];
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

/**
 * The first sentence of some prose, cut at a word boundary to `max`
 * characters. No regex lookbehind: Safari before 16.4 cannot compile it, and
 * the default Vite target still includes Safari 14.
 */
export function firstSentence(text: string, max = Infinity): string {
  const sentence = /^[\s\S]*?[.!?](?=\s)/.exec(text)?.[0] ?? text;
  return sentence.length > max ? `${sentence.slice(0, max - 3).replace(/\s+\S*$/, '')}\u2026` : sentence;
}

/** `player_passed` → "player passed". */
export function humanizeToken(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/_/g, ' ');
}

/** `player_passed` → "Player passed". */
export function sentenceCase(value: string | null | undefined): string {
  const text = humanizeToken(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** Zero-padded bill/ticket number: 7 → "#007". */
export function recordNumber(n: number | null | undefined, width = 3): string {
  if (n === null || n === undefined) return '#—';
  return `#${String(n).padStart(width, '0')}`;
}

/** "1 vote" / "3 votes" */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
