import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { formatSimDate, plural } from '../../lib/format';

/** "Clock advanced to 1 January 2076 · 1 death, 2 ailments" */
function describeAdvance(result: { toDate?: string; summary?: { deaths?: unknown[]; ailments?: unknown[]; recoveries?: unknown[]; pendingDeaths?: unknown[] } } | undefined) {
  if (!result?.toDate) return 'Clock advanced';
  const s = result.summary ?? {};
  const parts = [
    s.deaths?.length ? plural(s.deaths.length, 'death') : null,
    s.pendingDeaths?.length ? plural(s.pendingDeaths.length, 'pending death') : null,
    s.ailments?.length ? plural(s.ailments.length, 'new ailment') : null,
    s.recoveries?.length ? plural(s.recoveries.length, 'recovery', 'recoveries') : null,
  ].filter(Boolean);
  return `Clock advanced to ${formatSimDate(result.toDate)}${parts.length ? ` · ${parts.join(', ')}` : ''}`;
}

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
  advancedBy?: { id: string; characterName: string | null; discordUsername?: string } | null;
  /** Staff-only: character names for the player ids in `summary`. */
  playerNames?: Record<string, string>;
  summary?: {
    deaths: string[];
    pendingDeaths?: string[];
    ailments: string[];
    recoveries?: string[];
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
  ailments: DeathAilmentDetail[];
}

export interface PendingDeathDetail extends AdvanceDetail {
  triggeredTick: number;
  triggeredDate: string;
  eligibleFromTick: number;
  eligibleFromDate: string;
}

export interface DeathAilmentDetail {
  condition: string;
  severity: string;
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
    recoveries?: string[];
    aged: number;
  };
  deathDetails: AdvanceDetail[];
  pendingDeathDetails: PendingDeathDetail[];
  ailmentDetails: AilmentDetail[];
  recoveryDetails: AilmentDetail[];
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
    meta: { successMessage: describeAdvance },
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
    meta: { successMessage: 'Clock updated', errorMessage: 'Could not update the clock' },
    mutationFn: (body: { tickUnit?: string; isPaused?: boolean }) =>
      api.patch<SimulationClock>('/simulation/clock', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['simulation', 'clock'] }); },
  });
}

export function useAssignAilment() {
  const qc = useQueryClient();
  return useMutation({
    meta: { successMessage: 'Ailment assigned' },
    mutationFn: (body: { playerId: string; condition: string; severity: 'minor' | 'major' | 'critical'; notes?: string; durationYears?: number }) =>
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
    meta: { successMessage: 'Death recorded' },
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
    meta: { successMessage: 'Ailment removed', errorMessage: 'Could not remove the ailment' },
    mutationFn: (body: { playerId: string; condition: string }) =>
      api.post('/simulation/heal', body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['players', vars.playerId] });
    },
  });
}
