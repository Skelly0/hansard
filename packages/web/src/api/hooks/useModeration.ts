import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// ---- Types ----

export interface ModAction {
  id: string;
  targetPlayerId: string;
  targetPlayer?: { id: string; characterName: string; discordUsername: string };
  moderatorId: string;
  moderator?: { id: string; characterName: string; discordUsername: string };
  type: 'note' | 'verbal_warning' | 'formal_warning' | 'mute' | 'temporary_suspension' | 'permanent_ban';
  reason: string;
  internalNotes?: string;
  expiresAt?: string;
  isActive: boolean;
  appealStatus?: 'pending' | 'accepted' | 'denied';
  appealReason?: string;
  appealReviewedById?: string;
  ticketId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModNote {
  id: string;
  targetPlayerId: string;
  authorId: string;
  author?: { id: string; characterName: string; discordUsername: string };
  content: string;
  createdAt: string;
}

export interface ModStats {
  totalActions: number;
  activeActions: number;
  pendingAppeals: number;
  byType: Record<string, number>;
  recentActions: ModAction[];
}

interface ModActionFilters {
  type?: string;
  targetPlayerId?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

// ---- Hooks ----

export function useModActions(filters?: ModActionFilters) {
  const params = new URLSearchParams();
  if (filters?.type) params.set('type', filters.type);
  if (filters?.targetPlayerId) params.set('targetPlayerId', filters.targetPlayerId);
  if (filters?.isActive !== undefined) params.set('isActive', String(filters.isActive));
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.page && filters?.limit) params.set('offset', String((filters.page - 1) * filters.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ['moderation', 'actions', filters],
    queryFn: () => api.get<{ data: ModAction[]; total: number }>(`/moderation/actions${qs ? `?${qs}` : ''}`),
  });
}

export function usePlayerModHistory(playerId?: string) {
  return useQuery({
    queryKey: ['moderation', 'players', playerId],
    queryFn: () => api.get<{ actions: ModAction[]; notes: ModNote[] }>(`/moderation/players/${playerId}`),
    enabled: !!playerId,
  });
}

export function useModStats() {
  return useQuery({
    queryKey: ['moderation', 'stats'],
    queryFn: () => api.get<ModStats>('/moderation/stats'),
  });
}

export function useCreateModAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      targetPlayerId: string;
      type: string;
      reason: string;
      internalNotes?: string;
      expiresAt?: string;
    }) => api.post<ModAction>('/moderation/actions', body),

    onMutate: async (vars) => {
      // Cancel outgoing refetches so optimistic data isn't overwritten
      await qc.cancelQueries({ queryKey: ['moderation', 'actions'] });

      // Snapshot prior list-cache entries
      const snapshots = qc.getQueriesData<{ data: ModAction[]; total: number }>({
        queryKey: ['moderation', 'actions'],
      });

      // Optimistically prepend a pending action to all matching list caches
      const optimistic: ModAction = {
        id: `optimistic-${Date.now()}`,
        targetPlayerId: vars.targetPlayerId,
        moderatorId: 'pending',
        type: vars.type as ModAction['type'],
        reason: vars.reason,
        internalNotes: vars.internalNotes,
        expiresAt: vars.expiresAt,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      for (const [key, value] of snapshots) {
        if (value) {
          qc.setQueryData(key, {
            ...value,
            data: [optimistic, ...value.data],
            total: value.total + 1,
          });
        }
      }

      return { snapshots };
    },

    onError: (_err, _vars, context) => {
      // Roll back to the snapshots
      for (const [key, value] of context?.snapshots ?? []) {
        qc.setQueryData(key, value);
      }
    },

    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['moderation'] });
      qc.invalidateQueries({ queryKey: ['players', vars.targetPlayerId] });
    },
  });
}

export function useUpdateModAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; isActive?: boolean; appealStatus?: string; appealReason?: string }) =>
      api.patch<ModAction>(`/moderation/actions/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['moderation'] }); },
  });
}

export function useAddModNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { targetPlayerId: string; content: string }) =>
      api.post<ModNote>('/moderation/notes', body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['moderation', 'players', vars.targetPlayerId] });
    },
  });
}
