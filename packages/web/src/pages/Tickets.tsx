import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTickets, useTicketCategories, useTicketMetrics } from '../api/hooks/useTickets';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { MetricCard } from '../components/shared/MetricCard';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import type { Ticket } from '../api/hooks/useTickets';

const STATUSES = ['all', 'open', 'in_progress', 'waiting', 'resolved', 'closed'];
const PRIORITIES = ['all', 'low', 'normal', 'high', 'urgent'];

const priorityLabel: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

type TabKey = 'list' | 'metrics';

export function Tickets() {
  const [tab, setTab] = useState<TabKey>('list');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data: categories } = useTicketCategories();
  const { data, isLoading, isError, error } = useTickets({
    status: status !== 'all' ? status : undefined,
    category: category !== 'all' ? category : undefined,
    priority: priority !== 'all' ? priority : undefined,
    page,
    limit,
  });

  if (isLoading) return <PageSkeleton />;
  if (isError) {
    return (
      <div className="p-8">
        <QueryErrorState title="Could not load tickets" error={error} />
      </div>
    );
  }

  const tickets = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const columns: Column<Ticket>[] = [
    {
      key: 'number',
      header: '#',
      mono: true,
      minWidth: '60px',
      render: (row) => (
        <Link
          to="/tickets/$id"
          params={{ id: row.id }}
          className="text-accent-primary hover:underline"
        >
          #{String(row.number).padStart(3, '0')}
        </Link>
      ),
    },
    {
      key: 'title',
      header: 'Ticket',
      minWidth: '320px',
      render: (row) => (
        <div className="max-w-3xl">
          <Link
            to="/tickets/$id"
            params={{ id: row.id }}
            className="text-text-primary hover:text-accent-primary transition-colors font-medium"
          >
            {row.title}
          </Link>
          {row.description && (
            <p className="mt-1 text-body-sm text-text-secondary whitespace-pre-wrap break-words">
              {row.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      minWidth: '100px',
      render: (row) => (
        <Tag color={statusToTagColor(row.status)}>
          {row.status.replace(/_/g, ' ')}
        </Tag>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      minWidth: '80px',
      render: (row) => (
        <span className={`text-body-sm font-medium ${
          row.priority === 'urgent' ? 'text-status-rejected' :
          row.priority === 'high' ? 'text-accent-primary' :
          'text-text-secondary'
        }`}>
          {priorityLabel[row.priority] || row.priority}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      minWidth: '100px',
      render: (row) => (
        <span className="text-body-sm text-text-secondary">
          {row.category?.emoji} {row.category?.name || '—'}
        </span>
      ),
    },
    {
      key: 'assignedTo',
      header: 'Assigned',
      render: (row) => (
        <span className="text-body-sm text-text-secondary">
          {row.assignedTo?.characterName || row.assignedTo?.discordUsername || '—'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      mono: true,
      minWidth: '100px',
      render: (row) => new Date(row.createdAt).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      }),
    },
  ];

  return (
    <div className="p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-display">Tickets</h1>
          <p className="text-body-sm text-text-tertiary mt-1">
            {total} ticket{total !== 1 ? 's' : ''} in the system
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border-subtle">
        <button
          onClick={() => setTab('list')}
          className={`px-4 py-2.5 text-body-sm font-medium relative transition-colors duration-150 ${tab === 'list' ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
        >
          All Tickets
          {tab === 'list' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent-tickets" />}
        </button>
        <button
          onClick={() => setTab('metrics')}
          className={`px-4 py-2.5 text-body-sm font-medium relative transition-colors duration-150 ${tab === 'metrics' ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
        >
          Metrics
          {tab === 'metrics' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent-tickets" />}
        </button>
      </div>

      {tab === 'metrics' && <TicketMetricsView />}
      {tab === 'list' && <>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Status filter */}
        <div className="flex items-center gap-2">
          <label className="text-label-ui text-text-tertiary">Status</label>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All' : s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* Category filter */}
        <div className="flex items-center gap-2">
          <label className="text-label-ui text-text-tertiary">Category</label>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
          >
            <option value="all">All</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </select>
        </div>

        {/* Priority filter */}
        <div className="flex items-center gap-2">
          <label className="text-label-ui text-text-tertiary">Priority</label>
          <select
            value={priority}
            onChange={(e) => { setPriority(e.target.value); setPage(1); }}
            className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p === 'all' ? 'All' : priorityLabel[p]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card border-l-accent-tickets">
        <DataTable
          columns={columns}
          data={tickets}
          rowKey={(row) => row.id}
          emptyMessage="Inbox is empty. The chamber rests."
        />
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        className="mt-6 justify-center flex"
      />
      </>}
    </div>
  );
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.round(ms / (1000 * 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function TicketMetricsView() {
  const { data: metrics, isLoading, isError, error } = useTicketMetrics();

  if (isLoading) return <PageSkeleton />;
  if (isError) return <QueryErrorState title="Could not load ticket metrics" error={error} />;
  if (!metrics) {
    return (
      <div className="card border-l-accent-tickets">
        <p className="text-body text-text-tertiary italic">No metrics available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Open"
          value={metrics.openCount}
          color="text-accent-tickets"
          borderColor="border-l-accent-tickets"
        />
        <MetricCard
          label="In Progress"
          value={(metrics as any).inProgressCount ?? 0}
          color="text-status-pending"
          borderColor="border-l-status-pending"
        />
        <MetricCard
          label="Resolved (24h)"
          value={(metrics as any).resolvedToday ?? metrics.resolvedThisWeek ?? 0}
          color="text-status-passed"
          borderColor="border-l-status-passed"
        />
        <MetricCard
          label="Avg First Response"
          value={formatDuration(metrics.avgResponseTimeMs)}
          color="text-text-primary"
          borderColor="border-l-border-subtle"
        />
      </div>

      {metrics.byCategory && metrics.byCategory.length > 0 && (
        <div>
          <h2 className="text-heading-2 text-text-secondary mb-3">By Category</h2>
          <div className="card border-l-accent-tickets space-y-2">
            {metrics.byCategory.map((row) => (
              <div key={row.categoryId} className="flex items-center justify-between py-1">
                <span className="text-body-sm text-text-primary">{row.categoryName}</span>
                <span className="font-mono text-sm text-text-secondary">{row.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {metrics.byPriority && Object.keys(metrics.byPriority).length > 0 && (
        <div>
          <h2 className="text-heading-2 text-text-secondary mb-3">By Priority</h2>
          <div className="card border-l-accent-tickets space-y-2">
            {Object.entries(metrics.byPriority).map(([prio, count]) => (
              <div key={prio} className="flex items-center justify-between py-1">
                <span className="text-body-sm text-text-primary capitalize">{prio}</span>
                <span className="font-mono text-sm text-text-secondary">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
