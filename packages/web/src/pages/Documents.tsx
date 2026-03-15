import { useState } from 'react';
import { useDocuments, useDocumentCollections } from '../api/hooks/useDocuments';
import { DataTable, type Column } from '../components/shared/DataTable';
import { Tag } from '../components/shared/Tag';
import { Pagination } from '../components/shared/Pagination';
import { PageSkeleton } from '../components/shared/SkeletonLoader';
import type { Document } from '../api/hooks/useDocuments';

const collectionTypeLabel: Record<string, string> = {
  legislation: 'Legislation',
  worldbuilding: 'Worldbuilding',
  reference: 'Reference',
};

export function Documents() {
  const [collection, setCollection] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
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
          <span className="font-display font-medium text-text-primary">
            {row.title}
          </span>
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

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        className="mt-6 justify-center flex"
      />
    </div>
  );
}
