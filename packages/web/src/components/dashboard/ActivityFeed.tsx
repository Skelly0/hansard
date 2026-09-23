import { Link } from '@tanstack/react-router';
import type { DashboardActivityItem } from '../../api/hooks/useDashboard';
import { PlayerAvatar } from '../shared/PlayerAvatar';
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
    <div className="space-y-6">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h3 className="text-label-ui text-text-tertiary mb-2">{day.label}</h3>
          <ol className="relative border-l border-border-subtle ml-2.5 space-y-0.5">
            {day.items.map((item, idx) => {
              const meta = SYSTEM_META[item.system] ?? { label: item.system, dot: 'bg-border-strong', text: 'text-text-tertiary' };
              const actorKey = item.actorId ?? item.actorName ?? 'unknown';
              const body = (
                <>
                  <PlayerAvatar
                    player={{ id: actorKey, characterName: item.actorName, discordUsername: item.actorName ?? '?' }}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm text-text-primary leading-snug break-words">{item.description}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                      <span className={`font-mono uppercase tracking-wider ${meta.text}`}>{meta.label}</span>
                      {item.actorName && <span className="text-text-tertiary">· {item.actorName}</span>}
                    </p>
                  </div>
                  <time
                    dateTime={item.timestamp}
                    title={formatDateTime(item.timestamp)}
                    className="text-mono text-xs text-text-tertiary whitespace-nowrap pt-0.5"
                  >
                    {relativeTime(item.timestamp)}
                  </time>
                </>
              );
              return (
                <li key={`${item.timestamp}-${idx}`} className="relative pl-5">
                  <span className={`absolute -left-[4.5px] top-4 w-2 h-2 rounded-full ring-4 ring-page ${meta.dot}`} aria-hidden="true" />
                  {item.href ? (
                    <Link
                      to={item.href}
                      className="flex items-start gap-3 rounded-card px-3 py-2.5 -mx-1 hover:bg-hover transition-colors"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-3 py-2.5 -mx-1">{body}</div>
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
