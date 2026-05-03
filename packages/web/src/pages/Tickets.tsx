import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTickets, useTicketCategories } from '../api/hooks/useTickets';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import type { Ticket } from '../api/hooks/useTickets';

const STATUSES = ['all', 'open', 'in_progress', 'waiting', 'resolved', 'closed'];
const PRIORITIES = ['all', 'low', 'normal', 'high', 'urgent'];

const priorityLabel: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export function Tickets() {
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data: categories } = useTicketCategories();
  const { data, isLoading } = useTickets({
    status: status !== 'all' ? status : undefined,
    category: category !== 'all' ? category : undefined,
    priority: priority !== 'all' ? priority : undefined,
    page,
    limit,
  });

  if (isLoading) return <PageSkeleton />;

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
      header: 'Title',
      render: (row) => (
        <Link
          to="/tickets/$id"
          params={{ id: row.id }}
          className="text-text-primary hover:text-accent-primary transition-colors font-medium"
        >
          {row.title}
        </Link>
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
    </div>
  );
}
