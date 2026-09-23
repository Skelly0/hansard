import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  useDocument,
  useDocuments,
  useDocumentCollections,
  useDocumentVersions,
  useDocumentDiff,
  useRollbackDocument,
} from '../api/hooks/useDocuments';
import type { Document, DocumentVersion } from '../api/hooks/useDocuments';
import { useAuth } from '../api/hooks/useAuth';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import { RedlineDiff, type DiffHunk } from '../components/shared/RedlineDiff';
import { QueryErrorState } from '../components/shared/QueryErrorState';
import { PageHeader } from '../components/shared/PageHeader';
import { FilterBar, FilterField, SearchInput } from '../components/shared/FilterBar';
import { Modal } from '../components/shared/Modal';
import { Icon } from '../components/shared/Icon';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { renderMarkdown } from '../lib/markdown';
import { isGoogleDocsHttpUrl } from '../lib/url';
import { formatDate, formatDateTime, plural } from '../lib/format';

const collectionTypeLabel: Record<string, string> = {
  legislation: 'Legislation',
  worldbuilding: 'Worldbuilding',
  reference: 'Reference',
};

// ---- Version History Panel ----

function VersionHistoryPanel({ doc }: { doc: Document }) {
  const { isStaff } = useAuth();
  const { data: versions } = useDocumentVersions(doc.slug);
  const [compareFrom, setCompareFrom] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<number | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null);

  const { data: diffData } = useDocumentDiff(
    compareFrom !== null && compareTo !== null ? doc.slug : undefined,
    compareFrom ?? undefined,
    compareTo ?? undefined,
  );

  const rollbackMutation = useRollbackDocument();

  const diffHunks: DiffHunk[] = diffData?.hunks ?? [];

  function handleCompare(version: DocumentVersion) {
    const prevVersion = version.versionNumber - 1;
    if (prevVersion < 1) return;
    if (compareFrom === prevVersion && compareTo === version.versionNumber) {
      // Toggle off
      setCompareFrom(null);
      setCompareTo(null);
    } else {
      setCompareFrom(prevVersion);
      setCompareTo(version.versionNumber);
    }
  }

  function handleRollback(versionNumber: number) {
    if (rollbackTarget === versionNumber) {
      // Confirm — execute the rollback
      rollbackMutation.mutate(
        { slug: doc.slug, toVersion: versionNumber },
        {
          onSuccess: () => setRollbackTarget(null),
          onError: () => setRollbackTarget(null),
        },
      );
    } else {
      setRollbackTarget(versionNumber);
    }
  }

  if (!versions || versions.length === 0) {
    return (
      <p className="text-body-sm text-text-tertiary italic py-3">
        No version history available.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {versions.map((v) => (
        <div
          key={v.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b border-border-subtle last:border-0"
        >
          {/* Version number */}
          <span className="font-mono text-xs text-text-tertiary w-10 flex-shrink-0">
            v{v.versionNumber}
          </span>

          {/* Date */}
          <span className="font-mono text-xs text-text-tertiary w-24 flex-shrink-0" title={formatDateTime(v.createdAt)}>
            {formatDate(v.createdAt)}
          </span>

          {/* Editor name */}
          <span className="text-body-sm text-text-secondary flex-shrink-0">
            {v.editedBy?.characterName || v.editedBy?.discordUsername || '—'}
          </span>

          {/* Change description */}
          <span className="text-body-sm text-text-tertiary italic flex-1 min-w-[8rem] truncate">
            {v.changeDescription || '—'}
          </span>

          {/* Amendment tag */}
          {v.amendmentBillSlug && (
            <Link
              to="/bills/$slug"
              params={{ slug: v.amendmentBillSlug }}
              className="flex-shrink-0"
            >
              <Tag color="bills">
                Amendment: Bill
              </Tag>
            </Link>
          )}

          {/* Compare button (not for v1 — nothing to compare against) */}
          {v.versionNumber > 1 && (
            <button
              onClick={() => handleCompare(v)}
              className={`text-body-sm font-medium flex-shrink-0 transition-colors ${
                compareFrom === v.versionNumber - 1 && compareTo === v.versionNumber
                  ? 'text-accent-primary'
                  : 'text-text-tertiary hover:text-accent-primary'
              }`}
            >
              Compare
            </button>
          )}

          {/* Rollback button — staff-only (also enforced server-side) */}
          {isStaff && v.versionNumber < doc.currentVersion && (
            <button
              onClick={() => handleRollback(v.versionNumber)}
              className={`text-body-sm font-medium flex-shrink-0 transition-colors ${
                rollbackTarget === v.versionNumber
                  ? 'text-status-rejected'
                  : 'text-text-tertiary hover:text-status-rejected'
              }`}
              disabled={rollbackMutation.isPending}
            >
              {rollbackTarget === v.versionNumber
                ? rollbackMutation.isPending
                  ? 'Rolling back...'
                  : 'Confirm Rollback'
                : 'Rollback'}
            </button>
          )}
        </div>
      ))}

      {/* Cancel rollback */}
      {rollbackTarget !== null && !rollbackMutation.isPending && (
        <button
          onClick={() => setRollbackTarget(null)}
          className="text-body-sm text-text-tertiary hover:text-text-secondary transition-colors"
        >
          Cancel
        </button>
      )}

      {/* Inline diff display */}
      {compareFrom !== null && compareTo !== null && (
        <div className="mt-4">
          {diffHunks.length > 0 ? (
            <RedlineDiff
              hunks={diffHunks}
              fromLabel={`Version ${diffData?.from ?? compareFrom}`}
              toLabel={`Version ${diffData?.to ?? compareTo}`}
            />
          ) : (
            <p className="text-body-sm text-text-tertiary italic">
              Loading diff...
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Document reader ----

function DocumentReader({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { data: doc, isLoading, isError, error } = useDocument(slug);
  const [tab, setTab] = useState<'read' | 'history'>('read');
  const body = doc?.content ?? doc?.cachedContent ?? '';

  return (
    <Modal
      open
      onClose={onClose}
      title={doc?.title ?? 'Loading…'}
      eyebrow={doc ? `${doc.collection?.name ?? 'Document'} · v${doc.currentVersion}` : 'Document'}
      railClass="bg-accent-bills"
      maxWidth="max-w-3xl"
    >
      {isLoading ? (
        <div className="space-y-2">
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
        </div>
      ) : isError || !doc ? (
        <QueryErrorState title="Could not open this document" error={error} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4 text-body-sm text-text-tertiary">
            {doc.author && (
              <span>By <span className="text-text-secondary">{doc.author.characterName || doc.author.discordUsername}</span></span>
            )}
            <span className="font-mono text-xs">Updated {formatDate(doc.updatedAt)}</span>
            {doc.tags.map((tag) => <Tag key={tag} color="bills">{tag}</Tag>)}
            {isGoogleDocsHttpUrl(doc.googleDocUrl) && (
              <a
                href={doc.googleDocUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent-primary hover:underline ml-auto"
              >
                Google Doc <Icon name="external" size={13} />
              </a>
            )}
          </div>

          <div className="flex gap-1 mb-4 border-b border-border-subtle" role="tablist" aria-label="Document views">
            {([['read', 'Read'], ['history', 'History']] as const).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`px-3 py-2 -mb-px border-b-2 text-body-sm transition-colors ${
                  tab === key ? 'border-accent-primary text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'read' ? (
            body.trim() ? (
              <article className="text-body text-text-primary leading-[1.8] max-w-[70ch]">
                {renderMarkdown(body)}
              </article>
            ) : (
              <p className="text-body-sm italic text-text-tertiary">
                {doc.googleDocUrl ? 'This document lives in Google Docs and has not been cached yet.' : 'This document is empty.'}
              </p>
            )
          ) : (
            <VersionHistoryPanel doc={doc} />
          )}
        </>
      )}
    </Modal>
  );
}

// ---- Main Documents Page ----

export function Documents() {
  const [collection, setCollection] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const limit = 20;

  const { data: collections } = useDocumentCollections();
  const { data, isLoading, isError, error, isPlaceholderData } = useDocuments({
    collection: collection !== 'all' ? collection : undefined,
    search: debouncedSearch || undefined,
    page,
    limit,
  });

  if (isLoading && !data) return <PageSkeleton />;
  if (isError && !data) {
    return (
      <div className="page">
        <QueryErrorState title="Could not load documents" error={error} />
      </div>
    );
  }

  const documents = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const collectionTag = (type?: string) =>
    type === 'legislation' ? 'bills' : type === 'worldbuilding' ? 'simulation' : 'tickets';

  const columns: Column<Document>[] = [
    {
      key: 'title',
      header: 'Title',
      primary: true,
      render: (row) => (
        <button
          onClick={() => setOpenSlug(row.slug)}
          className="font-display font-medium text-text-primary hover:text-accent-primary transition-colors text-left"
          style={row.hierarchyLevel > 0 ? { paddingLeft: `${row.hierarchyLevel * 0.875}rem` } : undefined}
        >
          {row.hierarchyLevel > 0 && <span className="text-text-tertiary mr-1" aria-hidden="true">↳</span>}
          {row.title}
        </button>
      ),
    },
    {
      key: 'collection',
      header: 'Collection',
      minWidth: '120px',
      render: (row) => (
        <span className="text-body-sm text-text-secondary">
          {row.collection?.name || '—'}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      minWidth: '100px',
      hideOnMobile: true,
      render: (row) => {
        const typeName = row.collection?.type;
        return typeName ? (
          <Tag color={collectionTag(typeName)}>
            {collectionTypeLabel[typeName] || typeName}
          </Tag>
        ) : <span className="text-text-tertiary">—</span>;
      },
    },
    {
      key: 'version',
      header: 'Version',
      mono: true,
      align: 'center',
      minWidth: '60px',
      render: (row) => `v${row.currentVersion}`,
    },
    {
      key: 'author',
      header: 'Author',
      render: (row) => (
        <span className="text-body-sm text-text-secondary">
          {row.author?.characterName || row.author?.discordUsername || '—'}
        </span>
      ),
    },
    {
      key: 'tags',
      header: 'Tags',
      hideOnMobile: true,
      render: (row) => (
        row.tags.length === 0 ? <span className="text-text-tertiary">—</span> : (
          <div className="flex flex-wrap gap-1">
            {row.tags.slice(0, 3).map((tag) => (
              <Tag key={tag} color="bills">{tag}</Tag>
            ))}
          </div>
        )
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      mono: true,
      minWidth: '100px',
      render: (row) => formatDate(row.updatedAt),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Documents"
        subtitle={<>Constitutional, reference, and worldbuilding records &mdash; {plural(total, 'document')}</>}
      />

      <FilterBar>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search titles and text…"
          label="Search documents"
        />
        <FilterField label="Collection">
          <select
            value={collection}
            onChange={(e) => { setCollection(e.target.value); setPage(1); }}
            className="field"
          >
            <option value="all">All collections</option>
            {collections?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      {/* Collection cards overview */}
      {collection === 'all' && !debouncedSearch && collections && collections.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-8">
          {collections.map((col) => (
            <button
              key={col.id}
              onClick={() => { setCollection(col.id); setPage(1); }}
              className="card border-l-accent-bills text-left hover:bg-hover/40"
            >
              <h2 className="text-heading-2 text-text-primary mb-1">{col.name}</h2>
              {col.description && (
                <p className="text-body-sm text-text-secondary line-clamp-2">{col.description}</p>
              )}
              <Tag color={collectionTag(col.type)} className="mt-2">
                {collectionTypeLabel[col.type] || col.type}
              </Tag>
            </button>
          ))}
        </div>
      )}

      <div className={`card border-l-accent-bills transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={isPlaceholderData}>
        <DataTable
          columns={columns}
          data={documents}
          rowKey={(row) => row.id}
          caption="Documents"
          emptyMessage={debouncedSearch ? 'No documents match that search.' : 'No documents in this collection.'}
        />
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        className="mt-6 justify-center flex"
      />

      {openSlug && <DocumentReader slug={openSlug} onClose={() => setOpenSlug(null)} />}
    </div>
  );
}
