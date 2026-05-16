import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// ---- Types ----

export interface FavourCategory {
  id: string;
  name: string;
  shortName?: string;
  description?: string;
  emoji?: string;
  colour?: string;
  spendableOn?: string[];
  isActive: boolean;
  sortOrder: number;
}

export interface FavourBalance {
  id: string;
  playerId: string;
  player?: { id: string; characterName: string; discordUsername: string };
  categoryId: string;
  category?: FavourCategory;
  balance: number;
  updatedAt: string;
}

export interface FavourTransaction {
  id: string;
  playerId: string;
  player?: { id: string; characterName: string };
  categoryId: string;
  category?: FavourCategory;
  amount: number;
  balanceAfter: number;
  type: 'grant' | 'spend' | 'remove' | 'transfer' | 'system';
  reason?: string;
  grantedById?: string;
  grantedBy?: { id: string; characterName: string };
  simTick?: number;
  simDate?: string;
  createdAt: string;
}

// ---- Hooks ----

export function useFavourCategories() {
  return useQuery({
    queryKey: ['favour-categories'],
    queryFn: () => api.get<FavourCategory[]>('/favours/categories'),
  });
}

export function useFavourBalances(playerId?: string) {
  return useQuery({
    queryKey: ['favours', 'balances', playerId],
    queryFn: () => api.get<FavourBalance[]>(`/favours/balances/${playerId}`),
    enabled: !!playerId,
  });
}

export function useAllFavourBalances() {
  return useQuery({
    queryKey: ['favours', 'balances', 'all'],
    queryFn: () => api.get<FavourBalance[]>('/favours/balances'),
  });
}

export function useFavourLeaderboard(categoryId?: string) {
  return useQuery({
    queryKey: ['favours', 'leaderboard', categoryId],
    queryFn: () => api.get<FavourBalance[]>(`/favours/leaderboard/${categoryId}`),
    enabled: !!categoryId,
  });
}

export function useFavourHistory(playerId?: string, categoryId?: string) {
  const params = new URLSearchParams();
  if (categoryId) params.set('categoryId', categoryId);
  const qs = params.toString();
  return useQuery({
    queryKey: ['favours', 'history', playerId, categoryId],
    queryFn: () => api.get<FavourTransaction[]>(`/favours/history/${playerId}${qs ? `?${qs}` : ''}`),
    enabled: !!playerId,
  });
}

export function useAllFavourHistory(categoryId?: string) {
  const params = new URLSearchParams();
  if (categoryId) params.set('categoryId', categoryId);
  const qs = params.toString();
  return useQuery({
    queryKey: ['favours', 'history', 'all', categoryId],
    queryFn: () => api.get<FavourTransaction[]>(`/favours/history${qs ? `?${qs}` : ''}`),
  });
}

export function useGrantFavours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { playerId: string; categoryId: string; amount: number; reason?: string }) =>
      api.post('/favours/grant', body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['favours'] });
      qc.invalidateQueries({ queryKey: ['players', vars.playerId] });
    },
  });
}

export function useSpendFavours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { playerId: string; categoryId: string; amount: number; reason?: string }) =>
      api.post('/favours/spend', body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['favours'] });
      qc.invalidateQueries({ queryKey: ['players', vars.playerId] });
    },
  });
}

export function useRemoveFavours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { playerId: string; categoryId: string; amount: number; reason?: string }) =>
      api.post('/favours/remove', body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['favours'] });
      qc.invalidateQueries({ queryKey: ['players', vars.playerId] });
    },
  });
}

export function useCreateFavourCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; shortName?: string; description?: string; emoji?: string; colour?: string; spendableOn?: string[]; sortOrder?: number }) =>
      api.post<FavourCategory>('/favours/categories', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['favour-categories'] }); },
  });
}

/** Staff: list ALL categories including inactive ones. Falls back to active list (caller must filter). */
export function useAllFavourCategories() {
  return useQuery({
    queryKey: ['favour-categories', 'all'],
    queryFn: () => api.get<FavourCategory[]>('/favours/categories?includeInactive=1'),
  });
}

export function useUpdateFavourCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      name?: string;
      shortName?: string | null;
      description?: string | null;
      emoji?: string | null;
      colour?: string | null;
      spendableOn?: string[] | null;
      isActive?: boolean;
      sortOrder?: number;
    }) => api.patch<FavourCategory>(`/favours/categories/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['favour-categories'] }); },
  });
}

export function useDeleteFavourCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<FavourCategory>(`/favours/categories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['favour-categories'] }); },
  });
}
