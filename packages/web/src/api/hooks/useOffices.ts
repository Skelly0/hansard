import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// ---- Types ----

export interface Office {
  id: string;
  name: string;
  tier: string;
  factionId?: string;
  faction?: { id: string; name: string; shortName?: string };
  maxHolders: number;
  permissions?: string[];
  filledBy: string;
  appointableBy?: string;
  requiresConfirmation: boolean;
  discordRoleId?: string;
  isActive: boolean;
  sortOrder: number;
  currentHolders?: OfficeHolder[];
}

export interface OfficeHolder {
  id: string;
  officeId: string;
  playerId: string;
  playerName?: string | null;
  discordUsername?: string;
  player?: {
    id: string;
    characterName: string | null;
    discordUsername: string;
    characterPortraitUrl?: string | null;
  };
  startDate: string;
  endDate?: string;
  appointedBy?: string;
  appointmentMethod: string;
  electionId?: string;
  removalReason?: string;
  simTick?: number;
  simDate?: string;
}

// ---- Hooks ----

export function useOffices() {
  return useQuery({
    queryKey: ['offices'],
    queryFn: () => api.get<Office[]>('/offices'),
  });
}

export function useOffice(id?: string) {
  return useQuery({
    queryKey: ['offices', id],
    queryFn: () => api.get<Office & { holderHistory: OfficeHolder[] }>(`/offices/${id}`),
    enabled: !!id,
  });
}

export function useCreateOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; tier: string; factionId?: string; maxHolders?: number; filledBy?: string; permissions?: string[] }) =>
      api.post<Office>('/offices', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['offices'] }); },
  });
}

export function useUpdateOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; tier?: string; permissions?: string[]; isActive?: boolean }) =>
      api.patch<Office>(`/offices/${id}`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['offices'] });
      qc.invalidateQueries({ queryKey: ['offices', vars.id] });
    },
  });
}

export function useAppointToOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ officeId, playerId }: { officeId: string; playerId: string }) =>
      api.post(`/offices/${officeId}/appoint`, { playerId }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['offices'] });
      qc.invalidateQueries({ queryKey: ['offices', vars.officeId] });
    },
  });
}

export function useRemoveFromOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ officeId, reason }: { officeId: string; reason?: string }) =>
      api.post(`/offices/${officeId}/remove`, { reason }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['offices'] });
      qc.invalidateQueries({ queryKey: ['offices', vars.officeId] });
    },
  });
}
