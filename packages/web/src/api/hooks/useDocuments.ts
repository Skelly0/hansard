import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// ---- Types ----

export interface DocumentCollection {
  id: string;
  name: string;
  type: 'legislation' | 'worldbuilding' | 'reference';
  description?: string;
  sortOrder: number;
  isPublic: boolean;
}

export interface Document {
  id: string;
  collectionId: string;
  collection?: DocumentCollection;
  title: string;
  slug: string;
  content?: string;
  googleDocUrl?: string;
  cachedContent?: string;
  cachedAt?: string;
  parentDocumentId?: string;
  hierarchyLevel: number;
  currentVersion: number;
  authorId?: string;
  author?: { id: string; characterName: string };
  accessLevel: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  content: string;
  changeDescription?: string;
  editedById: string;
  editedBy?: { id: string; characterName: string };
  amendmentBillId?: string;
  createdAt: string;
}

interface DocumentFilters {
  collection?: string;
  author?: string;
  tags?: string[];
  search?: string;
  page?: number;
  limit?: number;
}

// ---- Hooks ----

export function useDocuments(filters?: DocumentFilters) {
  const params = new URLSearchParams();
  if (filters?.collection) params.set('collectionId', filters.collection);
  if (filters?.author) params.set('authorId', filters.author);
  if (filters?.tags?.length) params.set('tags', filters.tags.join(','));
  if (filters?.search) params.set('search', filters.search);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.page && filters?.limit) params.set('offset', String((filters.page - 1) * filters.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ['documents', filters],
    queryFn: () => api.get<{ data: Document[]; total: number }>(`/documents${qs ? `?${qs}` : ''}`),
  });
}

export function useDocument(slug?: string) {
  return useQuery({
    queryKey: ['documents', slug],
    queryFn: () => api.get<Document>(`/documents/${slug}`),
    enabled: !!slug,
  });
}

export function useDocumentVersions(slug?: string) {
  return useQuery({
    queryKey: ['documents', slug, 'versions'],
    queryFn: () => api.get<DocumentVersion[]>(`/documents/${slug}/versions`),
    enabled: !!slug,
  });
}

export function useDocumentCollections() {
  return useQuery({
    queryKey: ['document-collections'],
    queryFn: () => api.get<DocumentCollection[]>('/documents/collections'),
  });
}

export function useSearchDocuments(query?: string) {
  return useQuery({
    queryKey: ['documents', 'search', query],
    queryFn: () => api.get<Document[]>(`/documents/search?q=${encodeURIComponent(query || '')}`),
    enabled: !!query && query.length > 1,
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { collectionId: string; title: string; content?: string; googleDocUrl?: string; tags?: string[] }) =>
      api.post<Document>('/documents', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); },
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, ...body }: { slug: string; content?: string; changeDescription?: string; tags?: string[] }) =>
      api.patch<Document>(`/documents/${slug}`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['documents', vars.slug] });
    },
  });
}

export interface DocumentDiff {
  from: string;
  to: string;
  hunks: Array<{
    type: 'added' | 'removed' | 'unchanged';
    value: string;
  }>;
  stats: {
    additions: number;
    deletions: number;
    unchanged: number;
  };
}

/** Fetch a diff between two versions of a document. `to` omitted means latest. */
export function useDocumentDiff(slug?: string, from?: number, to?: number) {
  const params = new URLSearchParams();
  if (from !== undefined) params.set('from', String(from));
  if (to !== undefined) params.set('to', String(to));
  const qs = params.toString();
  return useQuery({
    queryKey: ['documents', slug, 'diff', from, to],
    queryFn: () => api.get<DocumentDiff>(`/documents/${slug}/diff${qs ? `?${qs}` : ''}`),
    enabled: !!slug && from !== undefined,
  });
}

/** Rollback a document to a previous version (staff only) */
export function useRollbackDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, toVersion }: { slug: string; toVersion: number }) =>
      api.post(`/documents/${slug}/rollback`, { toVersion }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['documents', vars.slug] });
      qc.invalidateQueries({ queryKey: ['documents', vars.slug, 'versions'] });
    },
  });
}
