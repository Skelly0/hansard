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
import { PageHeader, SectionHeading } from '../components/shared/PageHeader';
import { MetricStrip, type Metric } from '../components/shared/MetricCard';
import { Icon } from '../components/shared/Icon';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { formatSimDate, humanizeToken, recordNumber, relativeTime } from '../lib/format';

function salutation(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function todayLong(): string {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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

  const trend = (current: number, prev: number | null | undefined) => formatTrendDelta(current, prev ?? null) ?? undefined;
  const metrics: Metric[] = [];

  if (overview.activeTickets !== undefined) {
    metrics.push({
      label: 'Active tickets', to: '/tickets', value: overview.activeTickets,
      hint: trend(overview.activeTickets, overview.prevWeek?.activeTickets), color: 'text-accent-tickets',
    });
  }
  metrics.push(
    {
      label: 'Open bills', to: '/bills', value: overview.activeBills,
      hint: trend(overview.activeBills, overview.prevWeek?.activeBills), color: 'text-accent-bills',
    },
    {
      label: 'Upcoming votes', to: '/voting', value: overview.upcomingVotes,
      hint: trend(overview.upcomingVotes, overview.prevWeek?.upcomingVotes), color: 'text-accent-voting',
    },
    {
      label: 'Active players', to: '/players', value: overview.playerCount,
      hint: trend(overview.playerCount, overview.prevWeek?.playerCount), color: 'text-accent-players',
    },
  );
  if (overview.activeModActions !== undefined) {
    metrics.push({
      label: 'Mod actions', to: '/moderation', value: overview.activeModActions,
      hint: trend(overview.activeModActions, overview.prevWeek?.activeModActions), color: 'text-accent-moderation',
    });
  }
  metrics.push({
    label: 'Simulation tick', to: '/simulation', value: overview.currentSimTick,
    hint: overview.currentSimDate ? formatSimDate(overview.currentSimDate) : undefined, color: 'text-accent-simulation',
  });

  const columns =
    metrics.length >= 6 ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6' : 'grid-cols-2 lg:grid-cols-4';

  return (
    <div className="page">
      <PageHeader
        documentTitle="Dashboard"
        kicker={<>The Daily Record · {todayLong()}</>}
        title={user ? `${salutation()}, ${user.username}.` : `${salutation()}.`}
        subtitle={
          clock ? (
            <>
              {clock.seasonName}. The simulation clock stands at {formatSimDate(clock.currentDate)}
              {clock.isPaused ? ', and is paused.' : '.'}
            </>
          ) : undefined
        }
      />

      <AwaitingBallotCallout />

      <section aria-label="Figures" className="mb-10 sm:mb-12">
        <MetricStrip metrics={metrics} className={columns} />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-10 xl:gap-14">
        <section aria-labelledby="activity-heading" className="min-w-0 max-w-3xl">
          <SectionHeading id="activity-heading" size="lg" className="mb-4">
            Proceedings
          </SectionHeading>
          <ActivityFeed items={activity ?? []} />
        </section>

        <aside className="space-y-10 min-w-0">
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

/** The division bell: rung when votes are waiting on this player. */
function AwaitingBallotCallout() {
  const { data } = useAwaitingBallots();
  const awaiting = data?.data ?? [];
  if (awaiting.length === 0) return null;
  return (
    <section
      aria-labelledby="awaiting-heading"
      className="notice notice-accent mb-8 sm:mb-10 flex items-start gap-4"
    >
      <span className="hidden sm:flex w-10 h-10 rounded-full bg-ink-primary text-text-inverse items-center justify-center flex-shrink-0 shadow-card">
        <Icon name="bell" size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-label-ui text-accent-primary">The division bell</p>
        <h2 id="awaiting-heading" className="text-heading-1 text-text-primary mt-0.5 mb-2.5">
          {awaiting.length === 1 ? 'A vote is waiting for your ballot' : `${awaiting.length} votes are waiting for your ballot`}
        </h2>
        <ul className="space-y-1.5">
          {awaiting.slice(0, 4).map((vote) => (
            <li key={vote.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <Link to="/voting/$id" params={{ id: vote.id }} className="link text-body-sm font-medium">
                {vote.title}
              </Link>
              <span className="font-mono text-xs text-text-tertiary">
                <Countdown to={vote.votingClosesAt} />
                {vote.useReactions && ' · react in Discord'}
              </span>
            </li>
          ))}
        </ul>
      </div>
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
      <SectionHeading
        id="open-votes-heading"
        size="sm"
        action={<Link to="/voting" className="link-quiet text-text-tertiary">All votes →</Link>}
      >
        Divisions open
      </SectionHeading>
      {isLoading ? (
        <PanelSkeleton />
      ) : votes.length === 0 ? (
        <p className="text-body-sm italic text-text-tertiary">No votes are open right now.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {votes.map((vote) => (
            <li key={vote.id}>
              <Link
                to="/voting/$id"
                params={{ id: vote.id }}
                className="group block py-3 -mx-2 px-2 rounded-card hover:bg-hover/60 transition-colors"
              >
                <p className="font-display text-[1.0625rem] font-semibold text-text-primary leading-snug group-hover:text-accent-primary transition-colors">
                  {vote.title}
                </p>
                <p className="font-mono text-xs mt-1 text-text-tertiary flex flex-wrap items-center gap-2">
                  <Countdown to={vote.votingClosesAt} />
                  {awaitingIds.has(vote.id) && <Tag color="primary">Your ballot</Tag>}
                </p>
              </Link>
            </li>
          ))}
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
      <SectionHeading
        id="order-paper-heading"
        size="sm"
        action={<Link to="/bills" className="link-quiet text-text-tertiary">All bills →</Link>}
      >
        Order paper
      </SectionHeading>
      {isLoading ? (
        <PanelSkeleton />
      ) : bills.length === 0 ? (
        <p className="text-body-sm italic text-text-tertiary">No bills await a vote.</p>
      ) : (
        <ol className="divide-y divide-border-subtle">
          {bills.map((bill) => (
            <li key={bill.id}>
              <Link
                to="/bills/$slug"
                params={{ slug: bill.slug }}
                className="group flex items-start gap-3 py-3 -mx-2 px-2 rounded-card hover:bg-hover/60 transition-colors"
              >
                <span className="font-mono text-xs text-accent-primary pt-1">{recordNumber(bill.billNumber)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[1.0625rem] font-semibold text-text-primary group-hover:text-accent-primary transition-colors leading-snug">
                    {bill.title}
                  </span>
                  <span className="block text-xs text-text-tertiary mt-1">
                    {bill.author?.characterName ?? bill.author?.discordUsername ?? 'Unknown author'} · {relativeTime(bill.submittedAt)}
                  </span>
                </span>
                <Tag color={statusToTagColor(bill.status)} className="hidden sm:inline-flex mt-0.5">{humanizeToken(bill.status)}</Tag>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
