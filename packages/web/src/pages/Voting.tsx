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

export function Voting() {
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useElections({
    status: status !== 'all' ? status : undefined,
    type: type !== 'all' ? type : undefined,
    page,
    limit,
  });

  if (isLoading) return <PageSkeleton />;

  const elections = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

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

  return (
    <div className="p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-display">Voting</h1>
          <p className="text-body-sm text-text-tertiary mt-1">
            Elections, referenda, and legislative votes
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Status */}
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
      </div>

      {/* Table */}
      <div className="card border-l-accent-voting">
        <DataTable
          columns={columns}
          data={elections}
          rowKey={(row) => row.id}
          emptyMessage="No votes are scheduled."
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
