import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useBills, useCreateBill } from '../api/hooks/useBills';
import { useAuth } from '../api/hooks/useAuth';
import { useSearchPlayers } from '../api/hooks/usePlayers';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { Modal } from '../components/shared/Modal';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import type { Bill } from '../api/hooks/useBills';

const BILL_STATUSES = [
  'all', 'submitted', 'withdrawn', 'voting', 'player_passed', 'player_rejected',
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
  const { isStaff, hasPermission } = useAuth();
  const canSubmitForOthers = isStaff || hasPermission('legislative_leader');
  const [submitForOpen, setSubmitForOpen] = useState(false);
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, isError, error } = useBills({
    status: status !== 'all' ? status : undefined,
    search: search || undefined,
    sort,
    page,
    limit,
  });

  if (isLoading) return <PageSkeleton />;
  if (isError) {
    return (
      <div className="p-8">
        <QueryErrorState title="Could not load bills" error={error} />
      </div>
    );
  }

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
          {row.billType === 'short' && (
            <span className="ml-2">
              <Tag color="bills">short bill</Tag>
            </span>
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
        {canSubmitForOthers && (
          <button onClick={() => setSubmitForOpen(true)} className="btn-secondary text-sm">
            Submit on behalf
          </button>
        )}
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

      {canSubmitForOthers && (
        <SubmitForModal open={submitForOpen} onClose={() => setSubmitForOpen(false)} />
      )}
    </div>
  );
}

function SubmitForModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateBill();
  const [search, setSearch] = useState('');
  const [author, setAuthor] = useState<{ id: string; characterName: string | null; discordUsername: string } | null>(null);
  const [title, setTitle] = useState('');
  const [googleDocUrl, setGoogleDocUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: searchResults } = useSearchPlayers(search);

  const fc = 'w-full bg-card border border-border-default rounded-card px-3 py-2 text-body-sm focus:outline-none focus:border-accent-primary transition-colors duration-150';

  const submit = async () => {
    setError(null);
    if (!author) { setError('Pick an author.'); return; }
    if (!title.trim() || !googleDocUrl.trim()) {
      setError('Title and Google Doc URL are required.');
      return;
    }
    try {
      await create.mutateAsync({
        title: title.trim(),
        googleDocUrl: googleDocUrl.trim(),
        summary: summary.trim() || undefined,
        authorId: author.id,
      });
      onClose();
      setTitle('');
      setGoogleDocUrl('');
      setSummary('');
      setAuthor(null);
      setSearch('');
    } catch (e: any) {
      setError(e?.message ?? 'Submission failed.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submit Bill on Behalf"
      railClass="bg-accent-bills"
      maxWidth="max-w-lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={create.isPending} className="btn-primary disabled:opacity-50">
            {create.isPending ? 'Submitting…' : 'Submit'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="text-label-ui text-text-tertiary block mb-1">Author</label>
          {author ? (
            <div className="flex items-center gap-2 bg-card border border-border-default rounded-card px-3 py-2">
              <PlayerAvatar player={author} size="sm" />
              <span className="text-body-sm">{author.characterName ?? author.discordUsername}</span>
              <button onClick={() => setAuthor(null)} className="ml-auto text-xs text-text-tertiary hover:text-status-rejected">change</button>
            </div>
          ) : (
            <>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search players…" className={fc} />
              {searchResults?.data && searchResults.data.length > 0 && (
                <div className="mt-1 border border-border-subtle rounded-card overflow-hidden">
                  {searchResults.data.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => setAuthor({ id: p.id, characterName: p.characterName, discordUsername: p.discordUsername })}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-hover text-left transition-colors duration-150"
                    >
                      <PlayerAvatar player={p} size="sm" />
                      <span className="text-body-sm">{p.characterName ?? p.discordUsername}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <label className="block">
          <span className="text-label-ui text-text-tertiary block mb-1">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={fc} />
        </label>
        <label className="block">
          <span className="text-label-ui text-text-tertiary block mb-1">Google Doc URL</span>
          <input value={googleDocUrl} onChange={(e) => setGoogleDocUrl(e.target.value)} className={fc} />
        </label>
        <label className="block">
          <span className="text-label-ui text-text-tertiary block mb-1">Summary (optional)</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className={`${fc} resize-y`} />
        </label>
        {error && <p className="text-body-sm text-status-rejected">{error}</p>}
      </div>
    </Modal>
  );
}
