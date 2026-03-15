import type { AilmentSeverity } from '../constants/statuses.js';

// ============================================================
// Aging Config — stored in simulation config, tweakable per season
// ============================================================

export interface AilmentPoolEntry {
  name: string;
  severity: AilmentSeverity;
  weight: number;
  minAge?: number;
  description?: string;
}

export interface StartingAgeFavourTier {
  minAge: number;
  totalFavours: number;
  distributionMethod: 'player_choice' | 'random' | 'even';
}

export interface StartingAgeFavourBonus {
  enabled: boolean;
  tiers: StartingAgeFavourTier[];
}

export interface AgingConfig {
  // Ailment thresholds
  ailmentAgeThreshold: number;
  ailmentBaseChance: number;
  ailmentAgeScaling: number;

  // Death thresholds
  deathAgeThreshold: number;
  deathBaseChance: number;
  deathAgeScaling: number;
  criticalAilmentDeathChance: number;

  // Ailment pool
  ailmentPool: AilmentPoolEntry[];

  // Character creation constraints
  minStartingAge: number;
  maxStartingAge: number;
  defaultStartingAge: number;

  // Starting age favour bonus
  startingAgeFavourBonus: StartingAgeFavourBonus;
}

// ============================================================
// Simulation Clock
// ============================================================

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

// ============================================================
// Time Advance Summary (JSONB on time_advance_log table)
// ============================================================

export interface TimeAdvanceSummary {
  deaths: string[];
  ailments: string[];
  aged: number;
}

// ============================================================
// Time Advance Log Entry
// ============================================================

export interface TimeAdvanceLogEntry {
  id: string;
  fromTick: number;
  toTick: number;
  fromDate: string;
  toDate: string;
  advancedById: string;
  summary: TimeAdvanceSummary | null;
  notes: string | null;
  createdAt: string;
}
