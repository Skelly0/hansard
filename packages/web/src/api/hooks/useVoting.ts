import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// ---- Types ----

export interface Candidate {
  id: string;
  electionId: string;
  playerId: string;
  player?: { id: string; characterName: string; discordUsername: string };
  partyId?: string;
  party?: { id: string; name: string; shortName?: string; colour?: string };
  statement?: string;
  nominatedById?: string;
  isWithdrawn: boolean;
  registeredAt: string;
}

export interface ElectionResults {
  totalVotes: number;
  turnout: number;
  quorumMet?: boolean;
  passed?: boolean;
  rounds?: { round: number; tallies: Record<string, number>; eliminated?: string }[];
  finalTallies: Record<string, number>;
  winners?: string[];
  seatAllocation?: Record<string, number>;
  runoffTriggered?: boolean;
  runoffElectionId?: string;
}

export interface Election {
  id: string;
  title: string;
  description?: string;
  type: string;
  method: string;
  config: Record<string, unknown>;
  forOfficeId?: string;
  forOffice?: { id: string; name: string };
  npcConfirmation?: {
    status: 'pending' | 'confirmed' | 'rejected';
    tally?: { yea: number; nay: number; abstain: number; total: number };
    notes?: string;
  };
  parentElectionId?: string;
  roundNumber: number;
  nominationsOpenAt?: string;
  nominationsCloseAt?: string;
  votingOpensAt: string;
  votingClosesAt: string;
  status: string;
  results?: ElectionResults;
  relatedBillId?: string;
  createdById: string;
  createdBy?: { id: string; characterName: string };
  candidates?: Candidate[];
  createdAt: string;
  updatedAt: string;
}

interface ElectionFilters {
  status?: string;
  type?: string;
  method?: string;
  forOffice?: string;
  page?: number;
  limit?: number;
}

// ---- Hooks ----

export function useElections(filters?: ElectionFilters) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.method) params.set('method', filters.method);
  if (filters?.forOffice) params.set('forOffice', filters.forOffice);
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ['elections', filters],
    queryFn: () => api.get<{ data: Election[]; total: number }>(`/elections${qs ? `?${qs}` : ''}`),
  });
}

export function useElection(id?: string) {
  return useQuery({
    queryKey: ['elections', id],
    queryFn: () => api.get<Election>(`/elections/${id}`),
    enabled: !!id,
  });
}

export function useElectionResults(id?: string) {
  return useQuery({
    queryKey: ['elections', id, 'results'],
    queryFn: () => api.get<ElectionResults>(`/elections/${id}/results`),
    enabled: !!id,
  });
}

export function useElectionRounds(id?: string) {
  return useQuery({
    queryKey: ['elections', id, 'rounds'],
    queryFn: () => api.get<Election[]>(`/elections/${id}/rounds`),
    enabled: !!id,
  });
}

export function useElectionTurnout(id?: string) {
  return useQuery({
    queryKey: ['elections', id, 'turnout'],
    queryFn: () => api.get<{ eligible: number; voted: number; turnoutPct: number }>(`/elections/${id}/turnout`),
    enabled: !!id,
  });
}

export function useCreateElection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; description?: string; type: string; method: string; config: Record<string, unknown>; votingOpensAt: string; votingClosesAt: string; forOfficeId?: string }) =>
      api.post<Election>('/elections', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['elections'] }); },
  });
}

export function useOpenVoting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/elections/${id}/open`),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['elections', id] }); },
  });
}

export function useCloseVoting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/elections/${id}/close`),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['elections', id] }); },
  });
}

export function useTallyVotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/elections/${id}/tally`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['elections'] });
      qc.invalidateQueries({ queryKey: ['elections', id] });
    },
  });
}

export function useCastBallot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ electionId, vote }: { electionId: string; vote: unknown }) =>
      api.post(`/elections/${electionId}/vote`, { vote }),
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ['elections', vars.electionId] }); },
  });
}

export function useRegisterCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ electionId, statement, playerId, partyId }: { electionId: string; statement?: string; playerId?: string; partyId?: string }) =>
      api.post(`/elections/${electionId}/candidates`, { statement, playerId, partyId }),
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ['elections', vars.electionId] }); },
  });
}

export function useWithdrawCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ electionId, playerId }: { electionId: string; playerId: string }) =>
      api.delete(`/elections/${electionId}/candidates/${playerId}`),
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ['elections', vars.electionId] }); },
  });
}

export function useCertifyElection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/elections/${id}/certify`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['elections'] });
      qc.invalidateQueries({ queryKey: ['elections', id] });
    },
  });
}

export function useCreateRunoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Election>(`/elections/${id}/create-runoff`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['elections'] });
      qc.invalidateQueries({ queryKey: ['elections', id] });
    },
  });
}

export function useNpcConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ electionId, ...body }: { electionId: string; yea: number; nay: number; abstain: number; notes?: string }) =>
      api.post(`/elections/${electionId}/npc-confirm`, body),
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ['elections', vars.electionId] }); },
  });
}
