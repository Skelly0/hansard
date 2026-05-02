import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
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

  // Build diff hunks from raw content
  const diffHunks: DiffHunk[] = [];
  if (diffData) {
    const fromLines = diffData.fromContent.split('\n');
    const toLines = diffData.toContent.split('\n');
    const maxLen = Math.max(fromLines.length, toLines.length);
    for (let i = 0; i < maxLen; i++) {
      const fromLine = fromLines[i];
      const toLine = toLines[i];
      if (fromLine === toLine) {
        diffHunks.push({ type: 'unchanged', value: (fromLine ?? '') + '\n' });
      } else {
        if (fromLine !== undefined) {
          diffHunks.push({ type: 'removed', value: fromLine + '\n' });
        }
        if (toLine !== undefined) {
          diffHunks.push({ type: 'added', value: toLine + '\n' });
        }
      }
    }
  }

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
          className="flex items-center gap-3 py-2 border-b border-border-subtle last:border-0"
        >
          {/* Version number */}
          <span className="font-mono text-xs text-text-tertiary w-10 flex-shrink-0">
            v{v.versionNumber}
          </span>

          {/* Date */}
          <span className="font-mono text-xs text-text-tertiary w-24 flex-shrink-0">
            {new Date(v.createdAt).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>

          {/* Editor name */}
          <span className="text-body-sm text-text-secondary flex-shrink-0">
            {v.editedBy?.characterName || '—'}
          </span>

          {/* Change description */}
          <span className="text-body-sm text-text-tertiary italic flex-1 truncate">
            {v.changeDescription || '—'}
          </span>

          {/* Amendment tag */}
          {v.amendmentBillId && (
            <Link
              to="/bills/$slug"
              params={{ slug: v.amendmentBillId }}
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
              fromLabel={`Version ${compareFrom}`}
              toLabel={`Version ${compareTo}`}
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

// ---- Main Documents Page ----

export function Documents() {
  const [collection, setCollection] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const limit = 20;

  const { data: collections } = useDocumentCollections();
  const { data, isLoading } = useDocuments({
    collection: collection !== 'all' ? collection : undefined,
    search: search || undefined,
    page,
    limit,
  });

  if (isLoading) return <PageSkeleton />;

  const documents = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const columns: Column<Document>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <div>
          <button
            onClick={() =>
              setExpandedDocId(expandedDocId === row.id ? null : row.id)
            }
            className="font-display font-medium text-text-primary hover:text-accent-primary transition-colors text-left"
          >
            {row.title}
          </button>
          {row.hierarchyLevel > 0 && (
            <span className="text-text-tertiary ml-1">
              {'  '.repeat(row.hierarchyLevel)}
            </span>
          )}
        </div>
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
      render: (row) => {
        const typeName = row.collection?.type;
        return typeName ? (
          <Tag color={typeName === 'legislation' ? 'bills' : typeName === 'worldbuilding' ? 'simulation' : 'tickets'}>
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
          {row.author?.characterName || '—'}
        </span>
      ),
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.tags.slice(0, 3).map((tag) => (
            <Tag key={tag} color="bills">{tag}</Tag>
          ))}
        </div>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      mono: true,
      minWidth: '100px',
      render: (row) => new Date(row.updatedAt).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      }),
    },
  ];

  return (
    <div className="p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-display">Documents</h1>
          <p className="text-body-sm text-text-tertiary mt-1">
            Worldbuilding, reference, and constitutional documents
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
            placeholder="Search documents..."
            className="w-full bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
          />
        </div>

        {/* Collection filter */}
        <div className="flex items-center gap-2">
          <label className="text-label-ui text-text-tertiary">Collection</label>
          <select
            value={collection}
            onChange={(e) => { setCollection(e.target.value); setPage(1); }}
            className="bg-card border border-border-subtle rounded-card px-3 py-1.5 text-body-sm font-body text-text-primary focus:outline-none focus:border-accent-primary"
          >
            <option value="all">All Collections</option>
            {collections?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Collection cards overview */}
      {collection === 'all' && collections && collections.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {collections.map((col) => (
            <button
              key={col.id}
              onClick={() => { setCollection(col.id); setPage(1); }}
              className="card border-l-accent-bills text-left hover:border-border transition-colors"
            >
              <h3 className="text-heading-2 text-text-primary mb-1">{col.name}</h3>
              {col.description && (
                <p className="text-body-sm text-text-secondary line-clamp-2">{col.description}</p>
              )}
              <Tag color={col.type === 'legislation' ? 'bills' : col.type === 'worldbuilding' ? 'simulation' : 'tickets'} className="mt-2">
                {collectionTypeLabel[col.type] || col.type}
              </Tag>
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="card border-l-accent-bills">
        <DataTable
          columns={columns}
          data={documents}
          rowKey={(row) => row.id}
          emptyMessage="No documents match the current filters."
        />
      </div>

      {/* Expanded version history panel */}
      {expandedDocId && (() => {
        const doc = documents.find((d) => d.id === expandedDocId);
        if (!doc) return null;
        return (
          <div className="mt-4 card border-l-accent-bills">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-heading-2 text-text-secondary">
                Version History: {doc.title}
              </h2>
              <button
                onClick={() => setExpandedDocId(null)}
                className="text-body-sm text-text-tertiary hover:text-text-secondary transition-colors"
              >
                Close
              </button>
            </div>
            <VersionHistoryPanel doc={doc} />
          </div>
        );
      })()}

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        className="mt-6 justify-center flex"
      />
    </div>
  );
}
