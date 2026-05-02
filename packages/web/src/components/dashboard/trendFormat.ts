/**
 * Format a trend delta string for the dashboard metric cards.
 * - positive: '+N this week'
 * - negative: '−N this week' (real U+2212 minus, not hyphen)
 * - zero: '— no change'
 * - prevWeek null/undefined: returns null (caller should hide the line)
 */
export function formatTrendDelta(current: number, prev: number | null | undefined): string | null {
  if (prev === null || prev === undefined) return null;
  const delta = current - prev;
  if (delta === 0) return '— no change';
  if (delta > 0) return `+${delta} this week`;
  return `−${Math.abs(delta)} this week`;
}
