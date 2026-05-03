import { useDashboardOverview, useDashboardActivity } from '../api/hooks/useDashboard';
import { ActivityFeed } from '../components/dashboard/ActivityFeed';
import { formatTrendDelta } from '../components/dashboard/trendFormat';
import { PageSkeleton } from '../components/shared/SkeletonLoader';

interface MetricDef {
  key: string;
  label: string;
  current: number;
  prev: number | null;
  color: string;
  borderColor: string;
  fallback?: string;
}

export function Dashboard() {
  const { data: overview, isLoading: overviewLoading } = useDashboardOverview();
  const { data: activity, isLoading: activityLoading } = useDashboardActivity();

  if (overviewLoading || activityLoading) return <PageSkeleton />;
  if (!overview) return null;

  const metrics: MetricDef[] = [
    {
      key: 'tickets', label: 'Active Tickets',
      current: overview.activeTickets, prev: overview.prevWeek?.activeTickets ?? null,
      color: 'text-accent-tickets', borderColor: 'border-l-accent-tickets',
    },
    {
      key: 'bills', label: 'Open Bills',
      current: overview.activeBills, prev: overview.prevWeek?.activeBills ?? null,
      color: 'text-accent-bills', borderColor: 'border-l-accent-bills',
    },
    {
      key: 'votes', label: 'Upcoming Votes',
      current: overview.upcomingVotes, prev: overview.prevWeek?.upcomingVotes ?? null,
      color: 'text-accent-voting', borderColor: 'border-l-accent-voting',
    },
    {
      key: 'players', label: 'Active Players',
      current: overview.playerCount, prev: overview.prevWeek?.playerCount ?? null,
      color: 'text-accent-players', borderColor: 'border-l-accent-players',
    },
    {
      key: 'moderation', label: 'Active Mod Actions',
      current: overview.activeModActions, prev: overview.prevWeek?.activeModActions ?? null,
      color: 'text-accent-moderation', borderColor: 'border-l-accent-moderation',
    },
    {
      key: 'sim', label: 'Simulation Tick',
      current: overview.currentSimTick, prev: null,    // sim tick gets sim-date instead
      color: 'text-accent-simulation', borderColor: 'border-l-accent-simulation',
      fallback: overview.currentSimDate ?? '',
    },
  ];

  return (
    <div className="p-8">
      <h1 className="text-display mb-2">Dashboard</h1>
      <p className="text-body-sm text-text-tertiary mb-8 italic">The morning briefing.</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
        {metrics.map((m) => {
          const trend = formatTrendDelta(m.current, m.prev);
          return (
            <div key={m.key} className={`card ${m.borderColor} border-l-[3px]`}>
              <p className="text-label text-text-tertiary mb-2 uppercase">{m.label}</p>
              <p className={`text-mono text-2xl font-normal ${m.color}`}>{m.current}</p>
              <p className="text-mono text-xs text-text-tertiary mt-1">
                {trend ?? m.fallback ?? ''}
              </p>
            </div>
          );
        })}
      </div>

      <hr className="rule" />

      <div className="max-w-3xl">
        <h2 className="text-heading-1 mb-4">Recent Activity</h2>
        <ActivityFeed items={activity ?? []} />
      </div>
    </div>
  );
}
