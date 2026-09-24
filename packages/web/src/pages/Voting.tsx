import { Link } from '@tanstack/react-router';
import { useAwaitingBallots, useElections } from '../api/hooks/useVoting';
import { Countdown } from '../components/shared/Countdown';
import { useUrlState } from '../hooks/useUrlState';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import { PageHeader } from '../components/shared/PageHeader';
import { FilterBar, FilterField } from '../components/shared/FilterBar';
import { formatDate, humanizeToken, plural, relativeTime } from '../lib/format';
import type { Election } from '../api/hooks/useVoting';

const ELECTION_STATUSES = [
  'all', 'draft', 'nominations_open', 'nominations_closed', 'voting_open',
  'voting_closed', 'tallied', 'runoff_needed', 'npc_pending', 'certified', 'cancelled',
];

const ELECTION_TYPES = [
  'all', 'legislative_vote', 'position_election', 'appointment_confirmation',
  'general_election', 'referendum', 'confidence_vote', 'constitutional_amendment',
  'party_primary', 'custom',
];

const typeLabel: Record<string, string> = {
  legislative_vote: 'Legislative Vote',
  position_election: 'Position Election',
  appointment_confirmation: 'Appointment Confirmation',
  general_election: 'General Election',
  referendum: 'Referendum',
  confidence_vote: 'Confidence Vote',
  constitutional_amendment: 'Constitutional Amendment',
  party_primary: 'Party Primary',
  custom: 'Custom',
};

const methodLabel: Record<string, string> = {
  fptp: 'FPTP',
  ranked_choice: 'Ranked Choice',
  stv: 'STV',
  approval: 'Approval',
  proportional: 'Proportional',
  yea_nay_abstain: 'Yea/Nay/Abstain',
  two_round_runoff: 'Two-Round Runoff',
  exhaustive_ballot: 'Exhaustive Ballot',
};

type ScopeTab = 'all' | 'active' | 'past';

const SCOPE_TABS: { key: ScopeTab; label: string; description: string }[] = [
  { key: 'all', label: 'All', description: 'every recorded vote' },
  { key: 'active', label: 'Active', description: 'currently in motion' },
  { key: 'past', label: 'Past Votes', description: 'certified or cancelled' },
];

/** Compact one-line outcome string for the list row. */
function describeOutcome(row: Election): string {
  const r = row.results;
  if (!r) {
    if (row.status === 'cancelled') return 'cancelled';
    return '';
  }
  // Yea/Nay style
  if (row.method === 'yea_nay_abstain') {
    if (r.passed === true) return 'passed';
    if (r.passed === false) return 'failed';
  }
  // Winner-style
  if (r.winners && r.winners.length > 0) {
    if (r.winners.length === 1) {
      const w = r.winners[0];
      // 'yea'/'nay' show as themselves, otherwise look up candidate
      if (w === 'yea' || w === 'nay') return w;
      const named = row.candidates?.find((c) => c.playerId === w);
      return named?.player?.characterName ?? named?.player?.discordUsername ?? 'winner declared';
    }
    return `${r.winners.length} winners`;
  }
  if (r.runoffTriggered) return 'runoff';
  return '';
}

export function Voting() {
  const [url, setUrl] = useUrlState({ scope: 'all', status: 'all', type: 'all', page: 1 });
  const scope = (SCOPE_TABS.some((t) => t.key === url.scope) ? url.scope : 'all') as ScopeTab;
  const { status, type, page } = url;
  const setPage = (p: number) => setUrl({ page: p });
  const limit = 20;

  const { data: awaiting } = useAwaitingBallots();
  const awaitingIds = new Set((awaiting?.data ?? []).map((v) => v.id));
  const { data, isLoading, isError, error, isPlaceholderData } = useElections({
    // Explicit status wins over scope on the server, so only send one.
    status: status !== 'all' ? status : undefined,
    scope: status === 'all' && scope !== 'all' ? scope : undefined,
    type: type !== 'all' ? type : undefined,
    page,
    limit,
  });

  if (isLoading && !data) return <PageSkeleton />;
  if (isError && !data) {
    return (
      <div className="page">
        <QueryErrorState title="Could not load votes" error={error} />
      </div>
    );
  }

  const elections = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const columns: Column<Election>[] = [
    {
      key: 'title',
      header: 'Title',
      primary: true,
      render: (row) => (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to="/voting/$id"
            params={{ id: row.id }}
            className="font-display font-medium text-text-primary hover:text-accent-primary transition-colors"
          >
            {row.title}
          </Link>
          {awaitingIds.has(row.id) && <Tag color="primary">Your ballot</Tag>}
        </span>
      ),
    },

    {
      key: 'type',
      header: 'Type',
      minWidth: '140px',
      render: (row) => (
        <Tag color="voting">
          {typeLabel[row.type] || row.type}
        </Tag>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      minWidth: '100px',
      render: (row) => (
        <span className="font-mono text-xs text-text-secondary">
          {methodLabel[row.method] || row.method}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      minWidth: '110px',
      render: (row) => (
        <Tag color={statusToTagColor(row.status)}>
          {humanizeToken(row.status)}
        </Tag>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      minWidth: '140px',
      render: (row) => {
        const outcome = describeOutcome(row);
        if (!outcome) return <span className="text-text-tertiary">—</span>;
        const isFail = outcome === 'failed' || outcome === 'cancelled';
        const isPass = outcome === 'passed' || !['runoff', 'failed', 'cancelled'].includes(outcome);
        return (
          <span
            className={`text-body-sm ${
              isPass ? 'text-status-passed' : isFail ? 'text-status-rejected' : 'text-text-secondary'
            }`}
          >
            {outcome}
          </span>
        );
      },
    },
    {
      key: 'forOffice',
      header: 'Office',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-body-sm text-text-secondary">
          {row.forOffice?.name || '—'}
        </span>
      ),
    },
    {
      key: 'round',
      header: 'Rnd',
      hideOnMobile: true,
      mono: true,
      align: 'center',
      minWidth: '50px',
      render: (row) => row.roundNumber > 1 ? `R${row.roundNumber}` : '',
    },
    {
      key: 'votingOpensAt',
      header: 'Opens',
      mono: true,
      minWidth: '90px',
      hideOnMobile: true,
      render: (row) => formatDate(row.votingOpensAt, { withYear: false }),
    },
    {
      key: 'votingClosesAt',
      header: 'Closes',
      mono: true,
      minWidth: '100px',
      render: (row) => (
        <span title={new Date(row.votingClosesAt).toLocaleString('en-GB')}>
          {row.status === 'voting_open'
            ? <Countdown to={row.votingClosesAt} prefix="in" />
            : formatDate(row.votingClosesAt, { withYear: false })}
        </span>
      ),
    },
  ];

  // Empty-state copy depends on which scope/status is active so the user
  // doesn't get "No votes are scheduled" when they're browsing past votes.
  const emptyMessage = (() => {
    if (status !== 'all') {
      return `No votes with status "${status.replace(/_/g, ' ')}".`;
    }
    if (scope === 'past') return 'No past votes recorded yet.';
    if (scope === 'active') return 'No active votes right now.';
    return 'No votes recorded yet.';
  })();

  return (
    <div className="page">
      <PageHeader
        title="Voting"
        subtitle={<>Elections, referenda, and legislative votes &mdash; {plural(total, 'vote')}</>}
      />

      {/* Scope tabs — quick presets that override the status dropdown */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-border-subtle" role="tablist" aria-label="Vote scope">
        {SCOPE_TABS.map((tab) => {
          const isActive = scope === tab.key && status === 'all';
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setUrl({ scope: tab.key, status: 'all', page: 1 })}
              className={`px-3 py-2 -mb-px border-b-2 text-body-sm transition-colors ${
                isActive
                  ? 'border-accent-primary text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary'
              }`}
              title={tab.description}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <FilterBar>
        <FilterField label="Status">
          <select
            value={status}
            onChange={(e) => setUrl({ status: e.target.value, page: 1 })}
            className="field"
          >
            {ELECTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : humanizeToken(s)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Type">
          <select
            value={type}
            onChange={(e) => setUrl({ type: e.target.value, page: 1 })}
            className="field"
          >
            {ELECTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'all' ? 'All types' : typeLabel[t] || t}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      {/* Table */}
      <div className={`card border-l-accent-voting transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={isPlaceholderData}>
        <DataTable
          caption="Votes"
          columns={columns}
          data={elections}
          rowKey={(row) => row.id}
          emptyMessage={emptyMessage}
        />
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        className="mt-6 justify-center flex"
      />
    </div>
  );
}
