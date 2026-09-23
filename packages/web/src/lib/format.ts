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
