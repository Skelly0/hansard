import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// ---- Types ----

export interface SimulationClock {
  id: string;
  currentDate: string;
  currentTick: number;
  tickUnit: string;
  startDate: string;
  seasonName: string;
  isPaused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TimeAdvanceEntry {
  id: string;
  fromTick: number;
  toTick: number;
  fromDate: string;
  toDate: string;
  advancedById: string;
  advancedBy?: { id: string; characterName: string };
  summary?: {
    deaths: string[];
    pendingDeaths?: string[];
    ailments: string[];
    aged: number;
  };
  notes?: string;
  createdAt: string;
}

export interface AdvanceDetail {
  playerId: string;
  characterName: string | null;
  age: number | null;
  cause: string;
}

export interface PendingDeathDetail extends AdvanceDetail {
  triggeredTick: number;
  triggeredDate: string;
  eligibleFromTick: number;
  eligibleFromDate: string;
}

export interface AilmentDetail {
  playerId: string;
  characterName: string | null;
  condition: string;
  severity: string;
}

export interface AdvancePreview {
  preview: true;
  fromTick: number;
  toTick: number;
  fromDate: string;
  toDate: string;
  summary: {
    deaths: string[];
    pendingDeaths?: string[];
    ailments: string[];
    aged: number;
  };
  deathDetails: AdvanceDetail[];
  pendingDeathDetails: PendingDeathDetail[];
  ailmentDetails: AilmentDetail[];
  aged: number;
}

// ---- Hooks ----

export function useSimulationClock() {
  return useQuery({
    queryKey: ['simulation', 'clock'],
    queryFn: () => api.get<SimulationClock>('/simulation/clock'),
  });
}

export interface SimEvent {
  id: string;
  playerId: string;
  eventType: string;
  description: string;
  simTick?: number;
  simDate?: string;
  isAutomatic: boolean;
  createdAt: string;
  characterName?: string | null;
  discordUsername?: string | null;
}

export function useSimEvents(limit = 50) {
  return useQuery({
    queryKey: ['simulation', 'events', limit],
    queryFn: () => api.get<SimEvent[]>(`/simulation/events?limit=${limit}`),
  });
}

export function useTimeAdvanceHistory() {
  return useQuery({
    queryKey: ['simulation', 'history'],
    queryFn: () => api.get<TimeAdvanceEntry[]>('/simulation/history'),
  });
}

export function useAdvancePreview(ticks: number) {
  return useQuery({
    queryKey: ['simulation', 'preview', ticks],
    queryFn: () => api.post<AdvancePreview>('/simulation/advance/preview', { ticks }),
    enabled: ticks > 0,
  });
}

export function useAdvanceTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ticks: number; notes?: string }) =>
      api.post<TimeAdvanceEntry>('/simulation/advance', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['simulation'] });
      qc.invalidateQueries({ queryKey: ['players'] });
    },
  });
}

export function useUpdateClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { tickUnit?: string; isPaused?: boolean }) =>
      api.patch<SimulationClock>('/simulation/clock', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['simulation', 'clock'] }); },
  });
}

export function useAssignAilment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { playerId: string; condition: string; severity: 'minor' | 'major' | 'critical'; notes?: string }) =>
      api.post('/simulation/ailment', body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['players', vars.playerId] });
      qc.invalidateQueries({ queryKey: ['simulation'] });
    },
  });
}

export function useKillCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { playerId: string; causeOfDeath: string }) =>
      api.post('/simulation/death', body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['players'] });
      qc.invalidateQueries({ queryKey: ['players', vars.playerId] });
      qc.invalidateQueries({ queryKey: ['simulation'] });
    },
  });
}

export function useHealCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { playerId: string; condition: string }) =>
      api.post('/simulation/heal', body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['players', vars.playerId] });
    },
  });
}
