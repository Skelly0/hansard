import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useBills, useCreateBill } from '../api/hooks/useBills';
import { useAuth } from '../api/hooks/useAuth';
import { useSearchPlayers } from '../api/hooks/usePlayers';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useUrlState, useUrlText } from '../hooks/useUrlState';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag, statusToTagColor } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { Modal } from '../components/shared/Modal';
import { PlayerAvatar } from '../components/shared/PlayerAvatar';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import { PageHeader } from '../components/shared/PageHeader';
import { FilterBar, FilterField, SearchInput } from '../components/shared/FilterBar';
import { formatDate, humanizeToken, plural, recordNumber } from '../lib/format';
import { isGoogleDocsHttpUrl } from '../lib/url';
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
  { value: 'title', label: 'Title A–Z' },
];

export function Bills() {
  const [submitOpen, setSubmitOpen] = useState(false);
  const [{ status, sort, q: debouncedSearch, page }, setUrl] = useUrlState({ status: 'all', sort: 'newest', q: '', page: 1 });
  const [search, setSearch] = useUrlText(debouncedSearch, (q) => setUrl({ q, page: 1 }));
  const setPage = (p: number) => setUrl({ page: p });
  const limit = 20;

  const { data, isLoading, isError, error, isPlaceholderData } = useBills({
    status: status !== 'all' ? status : undefined,
    search: debouncedSearch || undefined,
    sort,
    page,
    limit,
  });

  if (isLoading && !data) return <PageSkeleton />;
  if (isError && !data) {
    return (
      <div className="page">
        <QueryErrorState title="Could not load bills" error={error} />
      </div>
    );
  }

  const bills = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const filtered = status !== 'all' || !!debouncedSearch;

  const columns: Column<Bill>[] = [
    {
      key: 'billNumber',
      header: 'Bill',
      mono: true,
      minWidth: '64px',
      render: (row) => (
        <Link
          to="/bills/$slug"
          params={{ slug: row.slug }}
          className="text-accent-primary hover:underline"
        >
          {recordNumber(row.billNumber)}
        </Link>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      primary: true,
      render: (row) => (
        <div className="min-w-0">
          <Link
            to="/bills/$slug"
            params={{ slug: row.slug }}
            className="text-text-primary hover:text-accent-primary transition-colors font-display font-semibold text-[1.0625rem] leading-snug"
          >
            {row.title}
          </Link>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
            {row.shortTitle && (
              <span className="font-mono text-xs text-text-tertiary">{row.shortTitle}</span>
            )}
            {row.billType === 'short' && (
              <span className="text-xs italic text-text-tertiary">short bill</span>
            )}
          </div>
        </div>
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
      key: 'author',
      header: 'Author',
      render: (row) => (
        <Link
          to="/players/$id"
          params={{ id: row.authorId }}
          className="inline-flex items-center gap-2 text-body-sm text-text-secondary hover:text-accent-primary transition-colors"
        >
          {row.author && <PlayerAvatar player={row.author} size="sm" />}
          {row.author?.characterName || row.author?.discordUsername || '—'}
        </Link>
      ),
    },
    {
      key: 'policyAreas',
      header: 'Policy',
      hideOnMobile: true,
      render: (row) => (
        row.policyAreas.length === 0 ? <span className="text-text-tertiary">—</span> : (
          <div className="flex flex-wrap gap-1">
            {row.policyAreas.slice(0, 2).map((area) => (
              <Tag key={area} color="bills">{area}</Tag>
            ))}
            {row.policyAreas.length > 2 && (
              <span className="text-body-sm text-text-tertiary">+{row.policyAreas.length - 2}</span>
            )}
          </div>
        )
      ),
    },
    {
      key: 'submittedAt',
      header: 'Submitted',
      mono: true,
      minWidth: '104px',
      render: (row) => formatDate(row.submittedAt),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Bills"
        subtitle={<>Legislative registry &mdash; {plural(total, filtered ? 'matching bill' : 'bill')}</>}
        actions={
          <button onClick={() => setSubmitOpen(true)} className="btn-primary">
            Submit a bill
          </button>
        }
      />

      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search bills…"
          label="Search bills"
        />
        <FilterField label="Status">
          <select
            value={status}
            onChange={(e) => setUrl({ status: e.target.value, page: 1 })}
            className="field"
          >
            {BILL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : humanizeToken(s)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Sort">
          <select
            value={sort}
            onChange={(e) => setUrl({ sort: e.target.value, page: 1 })}
            className="field"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      <div className={`card card-flush transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={isPlaceholderData}>
        <DataTable
          columns={columns}
          data={bills}
          rowKey={(row) => row.id}
          caption="Bills"
          emptyMessage={
            filtered
              ? 'No bills match these filters.'
              : 'The legislature has yet to introduce a bill.'
          }
        />
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        className="mt-6 justify-center flex"
      />

      <SubmitBillModal open={submitOpen} onClose={() => setSubmitOpen(false)} />
    </div>
  );
}

type PickedPlayer = { id: string; characterName: string | null; discordUsername: string };

/**
 * Submit a bill as yourself, or — for staff and the legislative leader — on
 * behalf of another character. Mirrors `/bill submit`: pick Short Bill (text
 * stored in Hansard) or Google Doc (linked document).
 */
function SubmitBillModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isStaff, hasPermission } = useAuth();
  const canSubmitForOthers = isStaff || hasPermission('legislative_leader');
  const create = useCreateBill();
  const navigate = useNavigate();
  const [billType, setBillType] = useState<'short' | 'google_doc'>('short');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [author, setAuthor] = useState<PickedPlayer | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [googleDocUrl, setGoogleDocUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [policyAreas, setPolicyAreas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: searchResults } = useSearchPlayers(canSubmitForOthers ? debouncedSearch : '');

  const reset = () => {
    setTitle(''); setContent(''); setGoogleDocUrl(''); setSummary(''); setPolicyAreas('');
    setAuthor(null); setSearch(''); setError(null); setBillType('short');
  };

  const submit = async () => {
    setError(null);
    if (!title.trim()) { setError('Give the bill a title.'); return; }
    if (billType === 'short' && !content.trim()) { setError('Short bills need their text.'); return; }
    if (billType === 'google_doc') {
      if (!googleDocUrl.trim()) { setError('Paste the Google Doc link.'); return; }
      if (!isGoogleDocsHttpUrl(googleDocUrl.trim())) {
        setError('That does not look like a docs.google.com document link.');
        return;
      }
    }
    try {
      const bill = await create.mutateAsync({
        title: title.trim(),
        billType,
        ...(billType === 'short'
          ? { content: content.trim() }
          : { googleDocUrl: googleDocUrl.trim() }),
        summary: summary.trim() || undefined,
        policyAreas: policyAreas
          .split(',')
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean),
        ...(author ? { authorId: author.id } : {}),
      });
      reset();
      onClose();
      if (bill?.slug) navigate({ to: '/bills/$slug', params: { slug: bill.slug } });
    } catch (e: any) {
      setError(e?.message ?? 'Submission failed.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submit a Bill"
      eyebrow="Legislature"
      railClass="bg-accent-bills"
      maxWidth="max-w-xl"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={create.isPending} className="btn-primary">
            {create.isPending ? 'Submitting…' : 'Submit bill'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="field-label">Bill type</legend>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {([
              ['short', 'Short bill', 'Text lives in Hansard'],
              ['google_doc', 'Google Doc', 'Linked document'],
            ] as const).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={billType === value}
                onClick={() => setBillType(value)}
                className={`text-left rounded-card border px-3 py-2 transition-colors ${
                  billType === value
                    ? 'border-accent-bills bg-accent-bills/10'
                    : 'border-border hover:border-border-strong'
                }`}
              >
                <span className="block text-body-sm font-medium text-text-primary">{label}</span>
                <span className="block text-xs text-text-tertiary">{hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {canSubmitForOthers && (
          <div>
            <span className="field-label">Author <span className="normal-case tracking-normal italic">(leave blank to submit as yourself)</span></span>
            {author ? (
              <div className="flex items-center gap-2 bg-card border border-border rounded-card px-3 py-2">
                <PlayerAvatar player={author} size="sm" />
                <span className="text-body-sm">{author.characterName ?? author.discordUsername}</span>
                <button type="button" onClick={() => setAuthor(null)} className="ml-auto text-xs text-text-tertiary hover:text-status-rejected">change</button>
              </div>
            ) : (
              <>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search characters…"
                  aria-label="Search for the bill's author"
                  className="field w-full"
                />
                {searchResults?.data && searchResults.data.length > 0 && search.trim().length >= 2 && (
                  <div className="mt-1 border border-border-subtle rounded-card overflow-hidden max-h-56 overflow-y-auto">
                    {searchResults.data.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => setAuthor({ id: p.id, characterName: p.characterName ?? null, discordUsername: p.discordUsername })}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-hover text-left transition-colors duration-150"
                      >
                        <PlayerAvatar player={p} size="sm" />
                        <span className="text-body-sm">{p.characterName ?? p.discordUsername}</span>
                        <span className="ml-auto font-mono text-xs text-text-tertiary">@{p.discordUsername}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <label className="block">
          <span className="field-label">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={256}
            placeholder="e.g. Coal Transition and Worker Protection Act"
            className="field w-full"
            data-autofocus
          />
        </label>

        {billType === 'short' ? (
          <label className="block">
            <span className="field-label">Bill text</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={7}
              placeholder={'1. …\n2. …'}
              className="field w-full resize-y leading-relaxed"
            />
          </label>
        ) : (
          <label className="block">
            <span className="field-label">Google Doc link</span>
            <input
              value={googleDocUrl}
              onChange={(e) => setGoogleDocUrl(e.target.value)}
              placeholder="https://docs.google.com/document/d/…"
              inputMode="url"
              className="field w-full font-mono text-xs"
            />
            <span className="block text-xs text-text-tertiary mt-1">Make sure the document is shared so anyone with the link can view it.</span>
          </label>
        )}

        <label className="block">
          <span className="field-label">Summary <span className="normal-case tracking-normal italic">(optional)</span></span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            placeholder="One or two sentences for the order paper."
            className="field w-full resize-y"
          />
        </label>

        <label className="block">
          <span className="field-label">Policy areas <span className="normal-case tracking-normal italic">(optional, comma-separated)</span></span>
          <input
            value={policyAreas}
            onChange={(e) => setPolicyAreas(e.target.value)}
            placeholder="energy, labour"
            className="field w-full"
          />
        </label>

        {error && <p role="alert" className="text-body-sm text-status-rejected">{error}</p>}
      </div>
    </Modal>
  );
}
