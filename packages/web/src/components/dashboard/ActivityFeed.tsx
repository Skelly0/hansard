import { Link } from '@tanstack/react-router';
import type { DashboardActivityItem } from '../../api/hooks/useDashboard';
import { Icon } from '../shared/Icon';
import { EmptyState } from '../shared/PageHeader';
import { formatDateTime, relativeTime } from '../../lib/format';

interface ActivityFeedProps {
  items: DashboardActivityItem[];
}

const SYSTEM_META: Record<string, { label: string; dot: string; text: string }> = {
  bills:      { label: 'Legislature', dot: 'bg-accent-bills',      text: 'text-accent-bills' },
  tickets:    { label: 'Tickets',     dot: 'bg-accent-tickets',    text: 'text-accent-tickets' },
  players:    { label: 'Players',     dot: 'bg-accent-players',    text: 'text-accent-players' },
  moderation: { label: 'Moderation',  dot: 'bg-accent-moderation', text: 'text-accent-moderation' },
};

function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toDateString();
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Undated';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * Chronological record of recent proceedings, grouped by day like a sitting
 * of the chamber. Each entry is tagged with its system and links to the
 * record it concerns when the API supplies one.
 */
export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return <EmptyState title="All quiet on the chamber floor." />;
  }

  const days: { key: string; label: string; items: DashboardActivityItem[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.timestamp);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: dayLabel(item.timestamp), items: [] };
      days.push(day);
    }
    day.items.push(item);
  }

  return (
    <div className="space-y-7">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <div className="section-head mb-1">
            <h3 className="text-label-ui text-text-secondary">{day.label}</h3>
          </div>
          <ol className="divide-y divide-border-subtle/70">
            {day.items.map((item, idx) => {
              const meta = SYSTEM_META[item.system] ?? { label: item.system, dot: 'bg-border-strong', text: 'text-text-tertiary' };
              const body = (
                <>
                  <time
                    dateTime={item.timestamp}
                    title={`${formatDateTime(item.timestamp)} · ${relativeTime(item.timestamp)}`}
                    className="font-mono text-xs text-text-tertiary w-11 flex-shrink-0 pt-[3px]"
                  >
                    {clockTime(item.timestamp)}
                  </time>
                  <span className={`mt-[7px] w-1.5 h-1.5 rotate-45 flex-shrink-0 ${meta.dot}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm text-text-primary leading-snug break-words">{item.description}</p>
                    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className={`text-label-ui text-[0.6875rem] ${meta.text}`}>{meta.label}</span>
                      {item.actorName && <span className="text-text-tertiary">{item.actorName}</span>}
                    </p>
                  </div>
                  {item.href && (
                    <Icon
                      name="arrow-right"
                      size={16}
                      className="self-center text-text-tertiary opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
                    />
                  )}
                </>
              );
              return (
                <li key={`${item.timestamp}-${idx}`}>
                  {item.href ? (
                    <Link
                      to={item.href}
                      className="group flex items-start gap-3 rounded-card px-2 py-3 -mx-2 hover:bg-hover/60 transition-colors"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-2 py-3 -mx-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
