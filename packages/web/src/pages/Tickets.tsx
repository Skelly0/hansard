import { Link } from '@tanstack/react-router';
import { useTickets, useTicketCategories, useTicketMetrics } from '../api/hooks/useTickets';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { MetricStrip } from '../components/shared/MetricCard';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import { Tabs, tabPanelProps } from '../components/shared/Tabs';
import { PageHeader, SectionHeading } from '../components/shared/PageHeader';
import { FilterBar, FilterField } from '../components/shared/FilterBar';
import { formatDate, humanizeToken, plural, recordNumber } from '../lib/format';
import { useUrlState } from '../hooks/useUrlState';
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
  const [url, setUrl] = useUrlState({ tab: 'list', status: 'all', category: 'all', priority: 'all', page: 1 });
  const tab: TabKey = url.tab === 'metrics' ? 'metrics' : 'list';
  const { status, category, priority, page } = url;
  const setTab = (next: TabKey) => setUrl({ tab: next });
  const setPage = (p: number) => setUrl({ page: p });
  const limit = 20;

  const { data: categories } = useTicketCategories();
  const { data, isLoading, isError, error, isPlaceholderData } = useTickets({
    status: status !== 'all' ? status : undefined,
    category: category !== 'all' ? category : undefined,
    priority: priority !== 'all' ? priority : undefined,
    page,
    limit,
  });

  if (isLoading && !data) return <PageSkeleton />;
  if (isError && !data) {
    return (
      <div className="page">
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
          {recordNumber(row.number)}
        </Link>
      ),
    },
    {
      key: 'title',
      header: 'Ticket',
      minWidth: '320px',
      primary: true,
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
          {humanizeToken(row.status)}
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
        <span className="text-body-sm text-text-secondary whitespace-nowrap">
          {row.category ? <>{row.category.emoji && <span aria-hidden="true">{row.category.emoji} </span>}{row.category.name}</> : '—'}
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
      render: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Tickets"
        subtitle={
          <>
            {plural(total, 'ticket')} on file &middot; open a new one in Discord with{' '}
            <code className="font-mono text-xs text-text-secondary">/ticket create</code>
          </>
        }
      />

      {/* Tabs */}
      <Tabs
        idPrefix="tickets"
        label="Ticket views"
        items={[
          { key: 'list', label: 'All tickets' },
          { key: 'metrics', label: 'Metrics' },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-5"
      />

      <div {...tabPanelProps('tickets', tab)}>
      {tab === 'metrics' && <TicketMetricsView />}
      {tab === 'list' && <>

      <FilterBar>
        <FilterField label="Status">
          <select
            value={status}
            onChange={(e) => setUrl({ status: e.target.value, page: 1 })}
            className="field"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All' : humanizeToken(s)}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Category">
          <select
            value={category}
            onChange={(e) => setUrl({ category: e.target.value, page: 1 })}
            className="field"
          >
            <option value="all">All</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Priority">
          <select
            value={priority}
            onChange={(e) => setUrl({ priority: e.target.value, page: 1 })}
            className="field"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p === 'all' ? 'All' : priorityLabel[p]}</option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      {/* Table */}
      <div className={`card card-flush transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={isPlaceholderData}>
        <DataTable
          columns={columns}
          data={tickets}
          rowKey={(row) => row.id}
          caption="Tickets"
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
      <div className="card">
        <p className="text-body text-text-tertiary italic">No metrics available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MetricStrip
        className="grid-cols-2 md:grid-cols-4"
        metrics={[
          { label: 'Open', value: metrics.openCount, color: 'text-accent-tickets' },
          { label: 'In Progress', value: metrics.inProgressCount ?? 0, color: 'text-status-pending' },
          { label: 'Resolved (24h)', value: metrics.resolvedToday ?? 0, color: 'text-status-passed' },
          { label: 'Avg First Response', value: formatDuration(metrics.avgResponseTimeMs), color: 'text-text-primary' },
        ]}
      />

      {metrics.byCategory && metrics.byCategory.length > 0 && (
        <div>
          <SectionHeading>By Category</SectionHeading>
          <div className="card space-y-2">
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
          <SectionHeading>By Priority</SectionHeading>
          <div className="card space-y-2">
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
