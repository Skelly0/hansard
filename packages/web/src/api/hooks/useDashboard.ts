import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface DashboardOverview {
  activeTickets?: number;
  upcomingVotes: number;
  playerCount: number;
  activeBills: number;
  activeModActions?: number;
  currentSimTick: number;
  currentSimDate: string | null;
  prevWeek: {
    activeTickets?: number;
    upcomingVotes: number;
    playerCount: number;
    activeBills: number;
    activeModActions?: number;
  } | null;
}

export interface DashboardActivityItem {
  type: string;
  system: 'tickets' | 'bills' | 'players' | 'moderation' | string;
  description: string;
  timestamp: string;
  actorName: string | null;
  /** Player UUID of the actor (colours the avatar consistently with other pages). */
  actorId?: string | null;
  /** In-app path for the record the item is about. */
  href?: string | null;
}

export function useDashboardOverview() {
  return useQuery<DashboardOverview>({
    queryKey: ['dashboard', 'overview'],
    queryFn: () => api.get<DashboardOverview>('/dashboard/overview'),
    staleTime: 30_000,
  });
}

export function useDashboardActivity() {
  return useQuery<DashboardActivityItem[]>({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => api.get<DashboardActivityItem[]>('/dashboard/activity'),
    staleTime: 30_000,
  });
}
