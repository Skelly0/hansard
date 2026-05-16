import type { DashboardActivityItem } from '../../api/hooks/useDashboard';
import { PlayerAvatar } from '../shared/PlayerAvatar';

interface ActivityFeedProps {
  items: DashboardActivityItem[];
}

const SYSTEM_LABELS: Record<string, { label: string; color: string }> = {
  bills:      { label: 'Legislature',  color: 'border-accent-bills      text-accent-bills' },
  tickets:    { label: 'Tickets',      color: 'border-accent-tickets    text-accent-tickets' },
  players:    { label: 'Players',      color: 'border-accent-players    text-accent-players' },
  moderation: { label: 'Moderation',   color: 'border-accent-moderation text-accent-moderation' },
};

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return rtf.format(diffSec, 'second');
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (absSec < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-2xl text-accent-primary mb-2">✦</div>
        <p className="text-body-sm italic text-text-secondary">
          All quiet on the chamber floor.
        </p>
      </div>
    );
  }

  // Group by system, preserving order within each group
  const groups = new Map<string, DashboardActivityItem[]>();
  for (const item of items) {
    const key = item.system;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([system, sectionItems]) => {
        const meta = SYSTEM_LABELS[system] ?? { label: system, color: 'border-border-default text-text-secondary' };
        const [borderClass, textClass] = meta.color.split(/\s+/);
        return (
          <section key={system}>
            <div className={`border-l-2 ${borderClass} pl-2 mb-2`}>
              <span className={`text-mono text-xs uppercase tracking-wider font-semibold ${textClass}`}>
                {meta.label}
              </span>
            </div>
            <div className="space-y-1">
              {sectionItems.map((item, idx) => {
                // Activity feed items only carry actorName (no UUID), so we hash by
                // name. Consequence: same player may show different color in
                // feed vs in pages that hash by player.id. Acceptable.
                const actorKey = item.actorName ?? 'unknown';
                return (
                  <div
                    key={`${item.timestamp}-${idx}`}
                    className="card flex items-center gap-3 px-3 py-2 transition-colors duration-150 ease-out"
                  >
                    <PlayerAvatar
                      player={{
                        id: actorKey,
                        characterName: null,
                        discordUsername: actorKey,
                      }}
                      size="sm"
                    />
                    <div className="flex-1 text-body-sm text-text-secondary">{item.description}</div>
                    <div className="text-mono text-xs text-text-tertiary">{relativeTime(item.timestamp)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
