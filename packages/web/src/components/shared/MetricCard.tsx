import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';

export interface Metric {
  label: string;
  value: ReactNode;
  /** Tailwind text colour class for the figure (e.g. "text-accent-bills"). */
  color?: string;
  /** Small line under the figure: a trend, a date, a qualifier. */
  hint?: ReactNode;
  /** Makes the cell a link. */
  to?: string;
}

/**
 * A row of figures on one sheet, divided by hairlines — the ledger strip at
 * the top of a report. The hairlines come from a 1px gap over the border
 * colour, so they stay correct however the grid wraps.
 */
export function MetricStrip({
  metrics,
  className = 'grid-cols-2 md:grid-cols-4',
  size = 'lg',
}: {
  metrics: Metric[];
  /** Grid column classes. */
  className?: string;
  /** `lg` for figures; `sm` for short text values (a party, a status). */
  size?: 'lg' | 'sm';
}) {
  return (
    <div
      className={`grid gap-px bg-border-subtle border border-border-subtle rounded-card overflow-hidden shadow-card ${className}`}
    >
      {metrics.map((m) => {
        const body = (
          <>
            <p className="text-label-ui text-text-tertiary group-hover:text-text-secondary transition-colors">{m.label}</p>
            <p
              className={`${
                size === 'lg' ? 'figure text-[2.125rem] sm:text-[2.5rem] mt-2.5' : 'font-display text-[1.1875rem] font-semibold leading-snug mt-1.5'
              } ${m.color ?? 'text-text-primary'}`}
            >
              {m.value}
            </p>
            {m.hint !== undefined && m.hint !== null && m.hint !== '' && (
              <p className="font-mono text-xs text-text-tertiary mt-2 truncate">{m.hint}</p>
            )}
          </>
        );
        const cell = 'bg-card px-4 py-4 sm:px-5 sm:py-5 min-w-0';
        return m.to ? (
          <Link key={m.label} to={m.to} className={`${cell} group block transition-colors hover:bg-hover/60`}>
            {body}
          </Link>
        ) : (
          <div key={m.label} className={cell}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
