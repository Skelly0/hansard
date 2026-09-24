import { useEffect, useState } from 'react';
import { formatDateTime } from '../../lib/format';

/** "2d 4h", "3h 12m", "8m", "under a minute" — coarse enough to read at a glance. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** Ticking "closes in …" label for an open vote. */
export function Countdown({
  to,
  prefix = 'closes in',
  endedLabel = 'closing now',
  className = '',
}: {
  to: string;
  prefix?: string;
  endedLabel?: string;
  className?: string;
}) {
  const target = new Date(to).getTime();
  const [now, setNow] = useState(() => Date.now());
  const remaining = target - now;

  useEffect(() => {
    if (Number.isNaN(target) || remaining <= 0) return;
    // Tick every 15s; plenty for minute precision without churn.
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [target, remaining <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (Number.isNaN(target)) return null;
  const urgent = remaining > 0 && remaining < 6 * 60 * 60 * 1000;
  return (
    <time
      dateTime={to}
      title={formatDateTime(to)}
      className={`${urgent ? 'text-status-pending' : ''} ${className}`}
    >
      {remaining > 0 ? `${prefix} ${formatRemaining(remaining)}` : endedLabel}
    </time>
  );
}
