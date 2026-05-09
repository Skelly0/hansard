import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useElections } from '../api/hooks/useVoting';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
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
      return named?.player?.characterName ?? 'winner picked';
    }
    return `${r.winners.length} winners`;
  }
  if (r.runoffTriggered) return 'runoff';
  return '';
}

export function Voting() {
  const [scope, setScope] = useState<ScopeTab>('all');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useElections({
    // Explicit status wins over scope on the server, so only send one.
    status: status !== 'all' ? status : undefined,
    scope: status === 'all' && scope !== 'all' ? scope : undefined,
    type: type !== 'all' ? type : undefined,
    page,
    limit,
  });

  if (isLoading) return <PageSkeleton />;

  const elections = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const columns: Column<Election>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <Link
          to="/voting/$id"
          params={{ id: row.id }}
          className="font-display font-medium text-text-primary hover:text-accent-primary transition-colors"
        >
          {row.title}
        </Link>
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
          {row.status.replace(/_/g, ' ')}
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
        const isPass = outcome === 'passed';
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
      render: (row) => (
        <span className="text-body-sm text-text-secondary">
          {row.forOffice?.name || '—'}
        </span>
      ),
    },
    {
      key: 'round',
      header: 'Rnd',
      mono: true,
      align: 'center',
      minWidth: '50px',
      render: (row) => row.roundNumber > 1 ? `R${row.roundNumber}` : '',
    },
    {
      key: 'votingOpensAt',
      header: 'Opens',
      mono: true,
      minWidth: '100px',
      render: (row) => new Date(row.votingOpensAt).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short',
      }),
    },
    {
      key: 'votingClosesAt',
      header: 'Closes',
      mono: true,
      minWidth: '100px',
      render: (row) => new Date(row.votingClosesAt).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short',
      }),
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
    <div className="p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-display">Voting</h1>
          <p className="text-body-sm text-text-tertiary mt-1">
            Elections, referenda, and legislative votes — past and present
          </p>
        </div>
      </div>

      {/* Scope tabs — quick presets that override the status dropdown */}
      <div className="flex flex-wrap gap-2 mb-4 border-b border-border-subtle">
        {SCOPE_TABS.map((tab) => {
          const isActive = scope === tab.key && status === 'all';
          return (
            <button
              key={tab.key}
              onClick={() => {
                setScope(tab.key);
                setStatus('all');
                setPage(1);
              }}
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

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Status — when set explicitly, overrides scope on the server */}
        <div className="flex items-center gap-2">
          <label className="text-label-ui text-text-tertiary">Status</label>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
          >
            {ELECTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All Statuses' : s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Type */}
        <div className="flex items-center gap-2">
          <label className="text-label-ui text-text-tertiary">Type</label>
          <select
            value={type}
            onChange={(e) => { setType(e.target.value); setPage(1); }}
            className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
          >
            {ELECTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'all' ? 'All Types' : typeLabel[t] || t}
              </option>
            ))}
          </select>
        </div>

        {total > 0 && (
          <div className="ml-auto self-center text-label-ui text-text-tertiary">
            {total} {total === 1 ? 'vote' : 'votes'}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card border-l-accent-voting">
        <DataTable
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
