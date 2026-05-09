import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// ---- Types ----

export interface Player {
  id: string;
  discordId: string;
  discordUsername: string;
  characterName?: string;
  characterBio?: string;
  characterPortraitUrl?: string;
  factionId?: string;
  faction?: { id: string; name: string; shortName?: string; colour?: string };
  partyId?: string;
  party?: { id: string; name: string; shortName?: string; colour?: string };
  birthDate?: string;
  startingAge?: number;
  currentAge?: number;
  deathDate?: string;
  causeOfDeath?: string;
  isAlive: boolean;
  healthStatus: string;
  ailments?: {
    condition: string;
    severity: 'minor' | 'major' | 'critical';
    acquiredAtTick: number;
    acquiredAtAge: number;
    notes?: string;
  }[];
  isActive: boolean;
  isStaff: boolean;
  staffRole?: string;
  registeredAt: string;
  lastActiveAt?: string;
  profileData?: Record<string, unknown>;
}

export interface PlayerEvent {
  id: string;
  playerId: string;
  eventType: string;
  description: string;
  oldValue?: unknown;
  newValue?: unknown;
  simTick?: number;
  simDate?: string;
  triggeredById?: string;
  triggeredBy?: { id: string; characterName: string };
  isAutomatic: boolean;
  createdAt: string;
}

export interface PlayerDossier extends Player {
  offices?: { officeId: string; officeName: string; startDate: string; endDate?: string; appointmentMethod: string }[];
  bills?: { id: string; title: string; slug: string; status: string; billNumber: number; submittedAt: string }[];
  votes?: { electionId: string; electionTitle: string; choice: string | null; castAt: string | null }[];
  favours?: { categoryId: string; categoryName: string; balance: number }[];
  events?: PlayerEvent[];
}

interface PlayerFilters {
  faction?: string;
  party?: string;
  active?: boolean;
  staff?: boolean;
  alive?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

// ---- Hooks ----

export function usePlayers(filters?: PlayerFilters) {
  const params = new URLSearchParams();
  if (filters?.faction) params.set('factionId', filters.faction);
  if (filters?.party) params.set('partyId', filters.party);
  if (filters?.active !== undefined) params.set('isActive', String(filters.active));
  if (filters?.staff !== undefined) params.set('isStaff', String(filters.staff));
  if (filters?.alive !== undefined) params.set('isAlive', String(filters.alive));
  if (filters?.search) params.set('search', filters.search);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.page && filters?.limit) params.set('offset', String((filters.page - 1) * filters.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ['players', filters],
    queryFn: () => api.get<{ data: Player[]; total: number }>(`/players${qs ? `?${qs}` : ''}`),
    enabled: filters !== undefined,
  });
}

export function usePlayer(id?: string) {
  return useQuery({
    queryKey: ['players', id],
    queryFn: () => api.get<PlayerDossier>(`/players/${id}`),
    enabled: !!id,
  });
}

export function usePlayerEvents(id?: string) {
  return useQuery({
    queryKey: ['players', id, 'events'],
    queryFn: () => api.get<PlayerEvent[]>(`/players/${id}/events`),
    enabled: !!id,
  });
}

export function usePlayerBills(id?: string) {
  return useQuery({
    queryKey: ['players', id, 'bills'],
    queryFn: () => api.get<PlayerDossier['bills']>(`/players/${id}/bills`),
    enabled: !!id,
  });
}

export function usePlayerVotes(id?: string) {
  return useQuery({
    queryKey: ['players', id, 'votes'],
    queryFn: () => api.get<PlayerDossier['votes']>(`/players/${id}/votes`),
    enabled: !!id,
  });
}

export function usePlayerOffices(id?: string) {
  return useQuery({
    queryKey: ['players', id, 'offices'],
    queryFn: () => api.get<PlayerDossier['offices']>(`/players/${id}/offices`),
    enabled: !!id,
  });
}

export function usePlayerHealth(id?: string) {
  return useQuery({
    queryKey: ['players', id, 'health'],
    queryFn: () => api.get<{ healthStatus: string; ailments: Player['ailments'] }>(`/players/${id}/health`),
    enabled: !!id,
  });
}

export function useUpdatePlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; characterBio?: string; characterPortraitUrl?: string }) =>
      api.patch<Player>(`/players/${id}`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['players'] });
      qc.invalidateQueries({ queryKey: ['players', vars.id] });
    },
  });
}

export function useChangeParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, partyId }: { id: string; partyId: string | null }) =>
      api.post(`/players/${id}/party`, { partyId }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['players'] });
      qc.invalidateQueries({ queryKey: ['players', vars.id] });
    },
  });
}

/**
 * Convenience for player typeahead. Disabled when search is empty/short
 * to avoid spamming the API on every keystroke.
 */
export function useSearchPlayers(search: string, limit = 8) {
  return usePlayers(search.length >= 2 ? { search, limit } : undefined);
}
