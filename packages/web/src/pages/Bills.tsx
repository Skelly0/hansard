import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useBills } from '../api/hooks/useBills';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import type { Bill } from '../api/hooks/useBills';

const BILL_STATUSES = [
  'all', 'submitted', 'voting', 'player_passed', 'player_rejected',
  'npc_pending', 'npc_passed', 'npc_rejected', 'enacted', 'active',
  'amended', 'repealed',
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'number', label: 'Bill number' },
  { value: 'title', label: 'Title A-Z' },
];

export function Bills() {
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useBills({
    status: status !== 'all' ? status : undefined,
    search: search || undefined,
    sort,
    page,
    limit,
  });

  if (isLoading) return <PageSkeleton />;

  const bills = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const columns: Column<Bill>[] = [
    {
      key: 'billNumber',
      header: 'Bill #',
      mono: true,
      minWidth: '70px',
      render: (row) => (
        <Link
          to="/bills/$slug"
          params={{ slug: row.slug }}
          className="text-accent-primary hover:underline"
        >
          #{String(row.billNumber).padStart(3, '0')}
        </Link>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <div>
          <Link
            to="/bills/$slug"
            params={{ slug: row.slug }}
            className="text-text-primary hover:text-accent-primary transition-colors font-display font-medium"
          >
            {row.title}
          </Link>
          {row.shortTitle && (
            <span className="font-mono text-xs text-text-tertiary ml-2">{row.shortTitle}</span>
          )}
        </div>
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
      key: 'author',
      header: 'Author',
      render: (row) => (
        <Link
          to="/players/$id"
          params={{ id: row.authorId }}
          className="text-body-sm text-text-secondary hover:text-accent-primary transition-colors"
        >
          {row.author?.characterName || row.author?.discordUsername || '—'}
        </Link>
      ),
    },
    {
      key: 'policyAreas',
      header: 'Policy',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.policyAreas.slice(0, 2).map((area) => (
            <Tag key={area} color="bills">{area}</Tag>
          ))}
          {row.policyAreas.length > 2 && (
            <span className="text-body-sm text-text-tertiary">+{row.policyAreas.length - 2}</span>
          )}
        </div>
      ),
    },
    {
      key: 'submittedAt',
      header: 'Submitted',
      mono: true,
      minWidth: '100px',
      render: (row) => new Date(row.submittedAt).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      }),
    },
  ];

  return (
    <div className="p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-display">Bills</h1>
          <p className="text-body-sm text-text-tertiary mt-1">
            Legislative registry &mdash; {total} bill{total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Search */}
        <div className="flex-1 min-w-[200px] max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search bills..."
            className="w-full bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
          />
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <label className="text-label-ui text-text-tertiary">Status</label>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
          >
            {BILL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All Statuses' : s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <label className="text-label-ui text-text-tertiary">Sort</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card border-l-accent-bills">
        <DataTable
          columns={columns}
          data={bills}
          rowKey={(row) => row.id}
          emptyMessage="The legislature has yet to introduce a bill in this filter."
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
