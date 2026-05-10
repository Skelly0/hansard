import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// ---- Types ----

export interface Bill {
  id: string;
  title: string;
  shortTitle?: string;
  slug: string;
  billNumber: number;
  googleDocUrl: string;
  googleDocId?: string;
  cachedContent?: string;
  cachedAt?: string;
  summary?: string;
  authorId: string;
  author?: { id: string; characterName: string | null; discordUsername: string };
  submittedById: string;
  submittedBy?: { id: string; characterName: string | null; discordUsername: string };
  coSponsorIds: string[];
  coSponsors?: { id: string; characterName: string | null; discordUsername: string }[];
  status: string;
  submittedAt: string;
  playerVoteId?: string;
  playerVoteResult?: 'passed' | 'rejected';
  playerVoteAt?: string;
  npcVoteRequired: boolean;
  npcVote?: {
    status: 'pending' | 'passed' | 'rejected' | 'amended';
    tally?: { yea: number; nay: number; abstain: number; total: number };
    amendmentNotes?: string;
    decidedAt?: string;
    notes?: string;
  };
  enactedAt?: string;
  effectiveAt?: string;
  repealedAt?: string;
  collectionId?: string;
  amendsBillId?: string | null;
  amendsBillSlug?: string | null;
  amendsDocumentId?: string | null;
  amendsDocumentSlug?: string | null;
  tags: string[];
  policyAreas: string[];
  estimatedEffects?: {
    economy?: { description: string; affectedSectors?: string[]; estimatedGdpImpact?: string };
    popsim?: { description: string; affectedGroups?: string[]; estimatedApprovalImpact?: string };
    notes?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BillStatusEntry {
  id: string;
  billId: string;
  fromStatus?: string;
  toStatus: string;
  changedById: string;
  changedBy?: { id: string; characterName: string };
  notes?: string;
  simTick?: number;
  simDate?: string;
  createdAt: string;
}

export interface BillVoter {
  playerId: string;
  characterName: string;
  choice: 'yea' | 'nay' | 'abstain';
  castAt: string;
}

type BillVoterApiRow = BillVoter & {
  voterId?: string;
  discordUsername?: string;
};

type LegacyBillVoterApiRow = Omit<BillVoter, 'playerId' | 'characterName'> & {
  voterId: string;
  characterName?: string;
  discordUsername?: string;
};

export interface BillDetail extends Bill {
  statusLog: BillStatusEntry[];
  voters?: BillVoter[];
}

interface BillFilters {
  status?: string;
  author?: string;
  policyArea?: string;
  tags?: string[];
  search?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

// ---- Hooks ----

export function useBills(filters?: BillFilters) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.author) params.set('authorId', filters.author);
  if (filters?.policyArea) params.set('policyArea', filters.policyArea);
  if (filters?.tags?.length) params.set('tags', filters.tags.join(','));
  if (filters?.search) params.set('search', filters.search);
  if (filters?.sort) params.set('sort', filters.sort);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.page && filters?.limit) params.set('offset', String((filters.page - 1) * filters.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ['bills', filters],
    queryFn: () => api.get<{ data: Bill[]; total: number }>(`/bills${qs ? `?${qs}` : ''}`),
  });
}

export function useBill(slug?: string) {
  return useQuery({
    queryKey: ['bills', slug],
    queryFn: () => api.get<BillDetail>(`/bills/${slug}`),
    enabled: !!slug,
  });
}

export function useBillStatusLog(slug?: string) {
  return useQuery({
    queryKey: ['bills', slug, 'status-log'],
    queryFn: () => api.get<BillStatusEntry[]>(`/bills/${slug}/status-log`),
    enabled: !!slug,
  });
}

export function useBillVoters(slug?: string) {
  return useQuery({
    queryKey: ['bills', slug, 'voters'],
    queryFn: async () => {
      const response = await api.get<
        (BillVoterApiRow | LegacyBillVoterApiRow)[] |
        { playerVotes: (BillVoterApiRow | LegacyBillVoterApiRow)[] }
      >(`/bills/${slug}/voters`);
      const rows = Array.isArray(response) ? response : response.playerVotes;
      return rows.map((row) => ({
        playerId: 'playerId' in row ? row.playerId : row.voterId,
        characterName: row.characterName ?? row.discordUsername ?? ('playerId' in row ? row.playerId : row.voterId),
        choice: row.choice,
        castAt: row.castAt,
      }));
    },
    enabled: !!slug,
  });
}

export function useSearchBills(query?: string) {
  return useQuery({
    queryKey: ['bills', 'search', query],
    queryFn: () => api.get<Bill[]>(`/bills/search?q=${encodeURIComponent(query || '')}`),
    enabled: !!query && query.length > 1,
  });
}

export function useCreateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; googleDocUrl: string; summary?: string; tags?: string[]; policyAreas?: string[]; authorId?: string }) =>
      api.post<Bill>('/bills', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bills'] }); },
  });
}

export function useUpdateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, ...body }: { slug: string; tags?: string[]; summary?: string; policyAreas?: string[] }) =>
      api.patch<Bill>(`/bills/${slug}`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['bills', vars.slug] });
    },
  });
}

export function useCacheBillContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.post(`/bills/${slug}/cache`),
    onSuccess: (_d, slug) => { qc.invalidateQueries({ queryKey: ['bills', slug] }); },
  });
}

export function useCreateBillVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.post(`/bills/${slug}/create-vote`),
    onSuccess: (_d, slug) => { qc.invalidateQueries({ queryKey: ['bills', slug] }); },
  });
}

export function useEnterNpcVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, ...body }: { slug: string; yea: number; nay: number; abstain: number; notes?: string }) =>
      api.post(`/bills/${slug}/npc-vote`, body),
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ['bills', vars.slug] }); },
  });
}

export function useUpdateBillEffects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, ...effects }: { slug: string; economy?: { description: string; affectedSectors?: string[]; estimatedGdpImpact?: string }; popsim?: { description: string; affectedGroups?: string[]; estimatedApprovalImpact?: string }; notes?: string }) =>
      api.patch<Bill>(`/bills/${slug}/effects`, effects),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['bills', vars.slug] });
    },
  });
}

export function useEnactBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.post(`/bills/${slug}/enact`),
    onSuccess: (_d, slug) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['bills', slug] });
    },
  });
}

/** Fetch bills that amend a given bill (child amendments) */
export function useBillAmendments(billId?: string) {
  return useQuery({
    queryKey: ['bills', 'amendments', billId],
    queryFn: () => api.get<{ data: Bill[]; total: number }>(`/bills?amendsBillId=${billId}`),
    enabled: !!billId,
  });
}
