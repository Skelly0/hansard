import { Link } from '@tanstack/react-router';
import { useDashboardOverview, useDashboardActivity } from '../api/hooks/useDashboard';
import { useAwaitingBallots, useElections } from '../api/hooks/useVoting';
import { Countdown } from '../components/shared/Countdown';
import { useBills } from '../api/hooks/useBills';
import { useSimulationClock } from '../api/hooks/useSimulation';
import { useAuth } from '../api/hooks/useAuth';
import { ActivityFeed } from '../components/dashboard/ActivityFeed';
import { formatTrendDelta } from '../components/dashboard/trendFormat';
import { PageSkeleton, Skeleton } from '../components/shared/SkeletonLoader';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import { PageHeader } from '../components/shared/PageHeader';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { formatSimDate, humanizeToken, recordNumber, relativeTime } from '../lib/format';

interface MetricDef {
  key: string;
  label: string;
  current: number;
  prev: number | null;
  color: string;
  borderColor: string;
  to: string;
  fallback?: string;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'The morning briefing.';
  if (hour < 18) return 'The afternoon briefing.';
  return 'The evening briefing.';
}

export function Dashboard() {
  const { user } = useAuth();
  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewIsError,
    error: overviewError,
  } = useDashboardOverview();
  const {
    data: activity,
    isLoading: activityLoading,
    isError: activityIsError,
    error: activityError,
  } = useDashboardActivity();
  const { data: clock } = useSimulationClock();

  if (overviewLoading || activityLoading) return <PageSkeleton />;
  if (overviewIsError || activityIsError) {
    return (
      <div className="page">
        <QueryErrorState
          title="Could not load dashboard"
          error={overviewError ?? activityError}
        />
      </div>
    );
  }
  if (!overview) return null;

  const metrics: MetricDef[] = [];

  if (overview.activeTickets !== undefined) {
    metrics.push({
      key: 'tickets', label: 'Active Tickets', to: '/tickets',
      current: overview.activeTickets, prev: overview.prevWeek?.activeTickets ?? null,
      color: 'text-accent-tickets', borderColor: 'border-l-accent-tickets',
    });
  }

  metrics.push(
    {
      key: 'bills', label: 'Open Bills', to: '/bills',
      current: overview.activeBills, prev: overview.prevWeek?.activeBills ?? null,
      color: 'text-accent-bills', borderColor: 'border-l-accent-bills',
    },
    {
      key: 'votes', label: 'Upcoming Votes', to: '/voting',
      current: overview.upcomingVotes, prev: overview.prevWeek?.upcomingVotes ?? null,
      color: 'text-accent-voting', borderColor: 'border-l-accent-voting',
    },
    {
      key: 'players', label: 'Active Players', to: '/players',
      current: overview.playerCount, prev: overview.prevWeek?.playerCount ?? null,
      color: 'text-accent-players', borderColor: 'border-l-accent-players',
    },
  );

  if (overview.activeModActions !== undefined) {
    metrics.push({
      key: 'moderation', label: 'Active Mod Actions', to: '/moderation',
      current: overview.activeModActions, prev: overview.prevWeek?.activeModActions ?? null,
      color: 'text-accent-moderation', borderColor: 'border-l-accent-moderation',
    });
  }

  metrics.push({
    key: 'sim', label: 'Simulation Tick', to: '/simulation',
    current: overview.currentSimTick, prev: null, // sim tick shows the sim date instead
    color: 'text-accent-simulation', borderColor: 'border-l-accent-simulation',
    fallback: overview.currentSimDate ? formatSimDate(overview.currentSimDate) : '',
  });

  const subtitle = clock
    ? `${clock.seasonName} · ${formatSimDate(clock.currentDate)}${clock.isPaused ? ' · clock paused' : ''}`
    : undefined;

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            <span className="italic">{greeting()}</span>
            {user && <span> Welcome back, {user.username}.</span>}
            {subtitle && <span className="block mt-0.5 not-italic font-mono text-xs">{subtitle}</span>}
          </>
        }
        className="mb-6 sm:mb-8"
      />

      <AwaitingBallotCallout />

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-8 sm:mb-10">
        {metrics.map((m) => {
          const trend = formatTrendDelta(m.current, m.prev);
          return (
            <Link
              key={m.key}
              to={m.to}
              className={`card ${m.borderColor} border-l-[3px] block hover:bg-hover/50 group`}
            >
              <p className="text-label-ui text-text-tertiary mb-2 group-hover:text-text-secondary transition-colors">{m.label}</p>
              <p className={`text-mono text-2xl font-normal ${m.color}`}>{m.current}</p>
              <p className="text-mono text-xs text-text-tertiary mt-1 truncate">
                {trend ?? m.fallback ?? ''}
              </p>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-8 xl:gap-10">
        <section aria-labelledby="activity-heading" className="min-w-0 max-w-3xl">
          <h2 id="activity-heading" className="text-heading-1 mb-4">Recent Activity</h2>
          <ActivityFeed items={activity ?? []} />
        </section>

        <aside className="space-y-8 min-w-0">
          <OpenVotesPanel />
          <OrderPaperPanel />
        </aside>
      </div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton height="h-12" />
      <Skeleton height="h-12" />
    </div>
  );
}

/** Prominent call to action when votes are waiting on this player. */
function AwaitingBallotCallout() {
  const { data } = useAwaitingBallots();
  const awaiting = data?.data ?? [];
  if (awaiting.length === 0) return null;
  return (
    <section
      aria-labelledby="awaiting-heading"
      className="mb-6 sm:mb-8 rounded-card border border-accent-primary/40 bg-accent-primary/[0.06] px-4 py-3 sm:px-5 sm:py-4"
    >
      <h2 id="awaiting-heading" className="text-heading-2 text-text-primary mb-2">
        {awaiting.length === 1 ? 'A vote is waiting for your ballot' : `${awaiting.length} votes are waiting for your ballot`}
      </h2>
      <ul className="space-y-1.5">
        {awaiting.slice(0, 4).map((vote) => (
          <li key={vote.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <Link
              to="/voting/$id"
              params={{ id: vote.id }}
              className="text-body-sm font-medium text-accent-primary hover:underline"
            >
              {vote.title}
            </Link>
            <span className="font-mono text-xs text-text-tertiary">
              <Countdown to={vote.votingClosesAt} />
              {vote.useReactions && ' · react in Discord'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpenVotesPanel() {
  const { data, isLoading } = useElections({ status: 'voting_open', limit: 5 });
  const { data: awaiting } = useAwaitingBallots();
  const awaitingIds = new Set((awaiting?.data ?? []).map((v) => v.id));
  const votes = data?.data ?? [];
  return (
    <section aria-labelledby="open-votes-heading">
      <div className="flex items-baseline justify-between mb-3">
        <h2 id="open-votes-heading" className="text-heading-2 text-text-secondary">Open Votes</h2>
        <Link to="/voting" className="text-body-sm text-text-tertiary hover:text-accent-primary transition-colors">
          All votes →
        </Link>
      </div>
      {isLoading ? (
        <PanelSkeleton />
      ) : votes.length === 0 ? (
        <p className="text-body-sm italic text-text-tertiary">No votes are open right now.</p>
      ) : (
        <ul className="space-y-2">
          {votes.map((vote) => {
            return (
              <li key={vote.id}>
                <Link
                  to="/voting/$id"
                  params={{ id: vote.id }}
                  className="card border-l-accent-voting block hover:bg-hover/50"
                >
                  <p className="text-body-sm text-text-primary font-medium leading-snug">{vote.title}</p>
                  <p className="text-mono text-xs mt-1 text-text-tertiary flex flex-wrap items-center gap-2">
                    <Countdown to={vote.votingClosesAt} />
                    {awaitingIds.has(vote.id) && <Tag color="primary">Your ballot</Tag>}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function OrderPaperPanel() {
  const { data, isLoading } = useBills({ status: 'submitted', sort: 'oldest', limit: 5 });
  const bills = data?.data ?? [];
  return (
    <section aria-labelledby="order-paper-heading">
      <div className="flex items-baseline justify-between mb-3">
        <h2 id="order-paper-heading" className="text-heading-2 text-text-secondary">Order Paper</h2>
        <Link to="/bills" className="text-body-sm text-text-tertiary hover:text-accent-primary transition-colors">
          All bills →
        </Link>
      </div>
      {isLoading ? (
        <PanelSkeleton />
      ) : bills.length === 0 ? (
        <p className="text-body-sm italic text-text-tertiary">No bills await a vote.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {bills.map((bill) => (
            <li key={bill.id}>
              <Link
                to="/bills/$slug"
                params={{ slug: bill.slug }}
                className="flex items-start gap-3 py-2.5 group"
              >
                <span className="font-mono text-xs text-accent-primary pt-0.5">{recordNumber(bill.billNumber)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm text-text-primary group-hover:text-accent-primary transition-colors leading-snug">
                    {bill.title}
                  </span>
                  <span className="block text-xs text-text-tertiary mt-0.5">
                    {bill.author?.characterName ?? bill.author?.discordUsername ?? 'Unknown author'} · {relativeTime(bill.submittedAt)}
                  </span>
                </span>
                <Tag color={statusToTagColor(bill.status)} className="hidden sm:inline-flex">{humanizeToken(bill.status)}</Tag>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
