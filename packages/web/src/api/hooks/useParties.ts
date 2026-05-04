import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// ---- Types ----

export interface Party {
  id: string;
  name: string;
  shortName: string | null;
  factionId: string | null;
  leaderId: string | null;
  ideology: string | null;
  colour: string | null;
  discordRoleId: string | null;
  isActive: boolean;
  foundedAt: string;
  dissolvedAt: string | null;
}

export interface PartyWithStats extends Party {
  memberCount: number;
  factionName?: string | null;
  leaderName?: string | null;
}

export interface PartyDetail extends PartyWithStats {
  members: { id: string; characterName: string | null; discordUsername: string }[];
}

export interface CreatePartyBody {
  name: string;
  shortName?: string | null;
  factionId?: string | null;
  leaderId?: string | null;
  ideology?: string | null;
  colour?: string | null;
  discordRoleId?: string | null;
}

export interface UpdatePartyBody extends Partial<CreatePartyBody> {
  isActive?: boolean;
}

// ---- Hooks ----

export function useParties(includeInactive = false) {
  return useQuery({
    queryKey: ['parties', { includeInactive }],
    queryFn: () => api.get<PartyWithStats[]>(`/parties${includeInactive ? '?includeInactive=1' : ''}`),
  });
}

export function useParty(id?: string) {
  return useQuery({
    queryKey: ['parties', id],
    queryFn: () => api.get<PartyDetail>(`/parties/${id}`),
    enabled: !!id,
  });
}

export function useCreateParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePartyBody) => api.post<Party>('/parties', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parties'] });
    },
  });
}

export function useUpdateParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePartyBody }) =>
      api.patch<Party>(`/parties/${id}`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['parties', vars.id] });
    },
  });
}

export function useDissolveParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ party: Party; unassigned: number }>(`/parties/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['players'] });
    },
  });
}
