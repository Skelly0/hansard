import { eq, and, isNull } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import {
  simulationClock,
  timeAdvanceLog,
  players,
  playerEventLog,
  officeHolders,
  offices,
} from '@hansard/db';
import {
  advanceDateByTicks,
  calculateAge,
  PlayerEventType,
  type AgingConfig,
  type AilmentPoolEntry,
  type PendingDeath,
  type ProfileData,
  type TimeAdvanceSummary,
} from '@hansard/shared';

// ============================================================
// Default Aging Config — used when simulation_clock.aging_config is null.
// ============================================================

export const DEFAULT_AGING_CONFIG: AgingConfig = {
  ailmentAgeThreshold: 50,
  ailmentBaseChance: 0.008,
  ailmentAgeScaling: 0.003,
  deathAgeThreshold: 62,
  deathBaseChance: 0.003,
  deathAgeScaling: 0.005,
  criticalAilmentDeathChance: 0.22,
  ailmentPool: [
    { name: 'cancer', severity: 'major', weight: 3, description: 'Serious malignant disease' },
    { name: 'heart disease', severity: 'major', weight: 2, minAge: 55, description: 'Chronic disease of the heart and circulation' },
    { name: 'kidney disease', severity: 'major', weight: 2, minAge: 55, description: 'Progressive loss of kidney function' },
    { name: 'liver disease', severity: 'major', weight: 1, minAge: 55, description: 'Severe chronic liver damage' },
    { name: 'pulmonary fibrosis', severity: 'major', weight: 1, minAge: 55, description: 'Severe scarring of lung tissue' },
    { name: 'chronic obstructive pulmonary disease', severity: 'major', weight: 1, minAge: 60, description: 'Severe long-term lung disease' },
    { name: 'dementia', severity: 'major', weight: 1, minAge: 65, description: 'Serious cognitive decline' },
    { name: "Parkinson's disease", severity: 'major', weight: 1, minAge: 60, description: 'Progressive movement and nerve disorder' },
    { name: 'stroke', severity: 'critical', weight: 1, minAge: 60, description: 'Sudden interruption of blood flow to the brain' },
    { name: 'heart failure', severity: 'critical', weight: 1, minAge: 65, description: 'Acute failure of cardiac function' },
    { name: 'sepsis', severity: 'critical', weight: 1, minAge: 60, description: 'Life-threatening systemic infection' },
    { name: 'pulmonary embolism', severity: 'critical', weight: 1, minAge: 60, description: 'Dangerous blood clot in the lungs' },
    { name: 'ruptured aneurysm', severity: 'critical', weight: 1, minAge: 60, description: 'Catastrophic blood vessel rupture' },
    { name: 'organ failure', severity: 'critical', weight: 1, minAge: 70, description: 'Failure of one or more vital organs' },
  ],
  minStartingAge: 18,
  maxStartingAge: 70,
  defaultStartingAge: 30,
};

// ============================================================
// Types
// ============================================================

export interface AdvanceResult {
  fromTick: number;
  toTick: number;
  fromDate: string;
  toDate: string;
  summary: TimeAdvanceSummary;
  deathDetails: DeathDetail[];
  pendingDeathDetails: PendingDeathDetail[];
  ailmentDetails: AilmentDetail[];
  aged: number;
}

export interface DeathDetail {
  playerId: string;
  characterName: string | null;
  age: number | null;
  cause: string;
}

export interface PendingDeathDetail {
  playerId: string;
  characterName: string | null;
  age: number | null;
  cause: string;
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

export interface SimulationPrivacyViewer {
  isStaff: boolean;
}

type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

// ============================================================
// Helpers
// ============================================================

/**
 * Resolve the aging config for the current season. Reads from
 * simulation_clock.aging_config if present; otherwise returns the defaults.
 */
export async function getAgingConfig(db: Database): Promise<AgingConfig> {
  const clock = await getClock(db);
  return clock?.agingConfig ?? DEFAULT_AGING_CONFIG;
}

/**
 * Pick a random ailment from the pool, weighted and filtered by age.
 */
function rollAilment(config: AgingConfig, playerAge: number): AilmentPoolEntry | null {
  const eligible = config.ailmentPool.filter(a => !a.minAge || playerAge >= a.minAge);
  if (eligible.length === 0) return null;

  const totalWeight = eligible.reduce((sum, a) => sum + a.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const ailment of eligible) {
    roll -= ailment.weight;
    if (roll <= 0) return ailment;
  }

  return eligible[eligible.length - 1]!;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPendingDeath(profileData: unknown): PendingDeath | null {
  if (!isRecord(profileData)) return null;
  const pending = profileData.pendingDeath;
  if (!isRecord(pending)) return null;

  const {
    cause,
    triggeredTick,
    triggeredDate,
    eligibleFromTick,
    eligibleFromDate,
    ageAtProc,
  } = pending;

  if (
    typeof cause !== 'string'
    || typeof triggeredTick !== 'number'
    || typeof triggeredDate !== 'string'
    || typeof eligibleFromTick !== 'number'
    || typeof eligibleFromDate !== 'string'
    || !(typeof ageAtProc === 'number' || ageAtProc === null)
  ) {
    return null;
  }

  return {
    cause,
    triggeredTick,
    triggeredDate,
    eligibleFromTick,
    eligibleFromDate,
    ageAtProc,
  };
}

function withPendingDeath(profileData: unknown, pendingDeath: PendingDeath): ProfileData {
  return {
    ...(isRecord(profileData) ? profileData : {}),
    pendingDeath,
  };
}

function withoutPendingDeath(profileData: unknown): ProfileData | null {
  if (!isRecord(profileData)) return null;
  const { pendingDeath: _pendingDeath, ...rest } = profileData;
  return Object.keys(rest).length > 0 ? rest : null;
}

function toPendingDeathDetail(
  player: typeof players.$inferSelect,
  pendingDeath: PendingDeath,
): PendingDeathDetail {
  return {
    playerId: player.id,
    characterName: player.characterName,
    age: pendingDeath.ageAtProc,
    cause: pendingDeath.cause,
    triggeredTick: pendingDeath.triggeredTick,
    triggeredDate: pendingDeath.triggeredDate,
    eligibleFromTick: pendingDeath.eligibleFromTick,
    eligibleFromDate: pendingDeath.eligibleFromDate,
  };
}

// ============================================================
// Per-tick roll engine — shared between advance / preview.
// Mutates `state` in place; returns nothing. The caller decides
// whether to persist the resulting deaths and ailments.
// ============================================================

interface PlayerTickState {
  id: string;
  characterName: string | null;
  birthDate: string | null;
  ailments: AilmentEntry[];
  isAlive: boolean;
}

interface AilmentEntry {
  condition: string;
  severity: 'minor' | 'major' | 'critical';
  acquiredAtTick: number;
  acquiredAtAge: number;
  notes?: string;
}

interface TickRoll {
  newAilment?: AilmentEntry;
  death?: { cause: string };
}

/**
 * Run one tick's worth of ailment + death rolls for a single player at
 * a known age. Pure of side effects beyond Math.random().
 */
function rollSingleTick(
  config: AgingConfig,
  age: number,
  ailments: AilmentEntry[],
  tick: number,
): TickRoll {
  const result: TickRoll = {};
  let currentAilments = ailments;

  // --- Ailment roll ---
  if (age >= config.ailmentAgeThreshold) {
    const ailmentChance =
      config.ailmentBaseChance + (age - config.ailmentAgeThreshold) * config.ailmentAgeScaling;
    if (Math.random() < ailmentChance) {
      const ailment = rollAilment(config, age);
      if (ailment && !currentAilments.some(a => a.condition === ailment.name)) {
        const newAilment: AilmentEntry = {
          condition: ailment.name,
          severity: ailment.severity,
          acquiredAtTick: tick,
          acquiredAtAge: age,
        };
        result.newAilment = newAilment;
        currentAilments = [...currentAilments, newAilment];
      }
    }
  }

  // --- Death roll ---
  let deathChance = 0;
  let causeOfDeath: string | null = null;

  const criticalAilments = currentAilments.filter(a => a.severity === 'critical');
  if (criticalAilments.length > 0) {
    deathChance += config.criticalAilmentDeathChance * criticalAilments.length;
    causeOfDeath = criticalAilments[0]!.condition;
  }

  const majorAilments = currentAilments.filter(a => a.severity === 'major');
  if (majorAilments.length >= 2) {
    deathChance += 0.05 * majorAilments.length;
    if (!causeOfDeath) causeOfDeath = 'complications from multiple ailments';
  }

  if (age >= config.deathAgeThreshold) {
    const ageDeathChance =
      config.deathBaseChance + (age - config.deathAgeThreshold) * config.deathAgeScaling;
    if (ageDeathChance > deathChance) causeOfDeath = 'natural causes';
    deathChance = Math.max(deathChance, ageDeathChance);
  }

  if (deathChance > 0 && Math.random() < deathChance) {
    result.death = { cause: causeOfDeath ?? 'unknown causes' };
  }

  return result;
}

// ============================================================
// Service Functions
// ============================================================

/**
 * Get the current simulation clock state.
 */
export async function getClock(db: Database) {
  const rows = await db.select().from(simulationClock).limit(1);
  return rows[0] ?? null;
}

/**
 * Advance time by N ticks. This is the big one -- the full aging pipeline.
 *
 * Steps:
 * 1. Increment currentTick by N
 * 2. Update currentDate
 * 3. Age all living players
 * 4. Ailment rolls for players above age threshold
 * 5. Death rolls for players with critical ailments or extreme age
 * 6. On death: mark dead, vacate offices, log events
 * 7. Create timeAdvanceLog entry
 * 8. Return summary
 */
/**
 * Walk a player through `ticks` sequential ticks of aging, ailment rolls
 * and death rolls. Returns final state plus collected events.
 *
 * Pure of DB side effects — caller persists the result. Mutates the
 * passed-in `state` object as it iterates so each tick sees the latest
 * ailments / age.
 */
function simulatePlayerTicks(
  state: PlayerTickState,
  config: AgingConfig,
  fromTick: number,
  ticks: number,
  perTickDates: string[],
): {
  finalAge: number | null;
  ageChanged: boolean;
  newAilments: { ailment: AilmentEntry; tick: number; date: string }[];
  death: { cause: string; tick: number; date: string; age: number } | null;
} {
  const startAge = calculateAge(state.birthDate, perTickDates[0] ?? null);
  if (startAge == null) {
    return { finalAge: null, ageChanged: false, newAilments: [], death: null };
  }

  let lastAge = startAge;
  const newAilments: { ailment: AilmentEntry; tick: number; date: string }[] = [];

  for (let i = 0; i < ticks; i++) {
    if (!state.isAlive) break;
    const tickNum = fromTick + i + 1;
    const tickDate = perTickDates[i + 1]!;
    const ageThisTick = calculateAge(state.birthDate, tickDate) ?? lastAge;
    lastAge = ageThisTick;

    const roll = rollSingleTick(config, ageThisTick, state.ailments, tickNum);

    if (roll.newAilment) {
      state.ailments = [...state.ailments, roll.newAilment];
      newAilments.push({ ailment: roll.newAilment, tick: tickNum, date: tickDate });
    }

    if (roll.death) {
      state.isAlive = false;
      return {
        finalAge: ageThisTick,
        ageChanged: ageThisTick !== startAge,
        newAilments,
        death: { cause: roll.death.cause, tick: tickNum, date: tickDate, age: ageThisTick },
      };
    }
  }

  return {
    finalAge: lastAge,
    ageChanged: lastAge !== startAge,
    newAilments,
    death: null,
  };
}

function getWorstSeverity(ailments: { severity: 'minor' | 'major' | 'critical' }[]): string {
  if (ailments.some(a => a.severity === 'critical')) return 'critical';
  if (ailments.some(a => a.severity === 'major')) return 'major';
  if (ailments.some(a => a.severity === 'minor')) return 'minor';
  return 'healthy';
}

/**
 * Build the per-tick date sequence from a starting date. Index 0 is the
 * start; index N is the date after N ticks. Throws on freeform + day/week.
 */
function buildPerTickDates(fromDate: string, ticks: number, tickUnit: string): string[] {
  const dates: string[] = [fromDate];
  let current = fromDate;
  for (let i = 0; i < ticks; i++) {
    current = advanceDateByTicks(current, 1, tickUnit);
    dates.push(current);
  }
  return dates;
}

async function markPlayerDeathPending(
  db: DbOrTx,
  player: typeof players.$inferSelect,
  pendingDeath: PendingDeath,
) {
  await db
    .update(players)
    .set({
      profileData: withPendingDeath(player.profileData, pendingDeath),
    })
    .where(eq(players.id, player.id));

  await db.insert(playerEventLog).values({
    playerId: player.id,
    eventType: PlayerEventType.DEATH_PENDING,
    description: `Death roll triggered (${pendingDeath.cause}); death will be processed after the grace tick.`,
    newValue: pendingDeath,
    simTick: pendingDeath.triggeredTick,
    simDate: pendingDeath.triggeredDate,
    isAutomatic: true,
  });
}

/**
 * Advance time by N ticks. Per-tick rolls; transactional persistence.
 */
export async function advanceTime(
  db: Database,
  ticks: number,
  advancedById: string,
): Promise<AdvanceResult> {
  const clock = await getClock(db);
  if (!clock) throw new Error('No simulation clock found. Create one first.');
  if (clock.isPaused) throw new Error('Simulation clock is paused. Unpause before advancing.');

  const config = clock.agingConfig ?? DEFAULT_AGING_CONFIG;
  const fromTick = clock.currentTick;
  const toTick = fromTick + ticks;
  const fromDate = clock.currentDate;
  const perTickDates = buildPerTickDates(fromDate, ticks, clock.tickUnit);
  const toDate = perTickDates[perTickDates.length - 1]!;

  const livingPlayers = await db.select().from(players).where(eq(players.isAlive, true));

  const deathDetails: DeathDetail[] = [];
  const pendingDeathDetails: PendingDeathDetail[] = [];
  const ailmentDetails: AilmentDetail[] = [];
  let agedCount = 0;

  await db.transaction(async (tx) => {
    for (const player of livingPlayers) {
      const pendingDeath = getPendingDeath(player.profileData);
      if (pendingDeath) {
        const deathTick = fromTick + 1;
        const deathDate = perTickDates[1] ?? toDate;

        if (deathTick >= pendingDeath.eligibleFromTick) {
          const ageAtDeath = calculateAge(player.birthDate, deathDate) ?? player.currentAge ?? null;
          await processPlayerDeath(
            tx,
            player.id,
            pendingDeath.cause,
            deathDate,
            deathTick,
            null,
            true,
            withoutPendingDeath(player.profileData),
          );
          deathDetails.push({
            playerId: player.id,
            characterName: player.characterName,
            age: ageAtDeath,
            cause: pendingDeath.cause,
          });
        } else {
          pendingDeathDetails.push(toPendingDeathDetail(player, pendingDeath));
        }

        continue;
      }

      const state: PlayerTickState = {
        id: player.id,
        characterName: player.characterName,
        birthDate: player.birthDate,
        ailments: ((player.ailments ?? []) as AilmentEntry[]).slice(),
        isAlive: true,
      };

      const result = simulatePlayerTicks(state, config, fromTick, ticks, perTickDates);
      if (result.finalAge == null) continue;

      if (result.ageChanged) agedCount++;

      // Persist new ailments + final age + health status
      if (result.newAilments.length > 0 || result.ageChanged) {
        await tx
          .update(players)
          .set({
            currentAge: result.finalAge,
            ailments: state.ailments,
            healthStatus: getWorstSeverity(state.ailments),
          })
          .where(eq(players.id, player.id));
      }

      for (const { ailment, tick, date } of result.newAilments) {
        await tx.insert(playerEventLog).values({
          playerId: player.id,
          eventType: 'ailment_acquired',
          description: `Acquired ${ailment.severity} ailment: ${ailment.condition}`,
          newValue: ailment,
          simTick: tick,
          simDate: date,
          isAutomatic: true,
        });
        ailmentDetails.push({
          playerId: player.id,
          characterName: player.characterName,
          condition: ailment.condition,
          severity: ailment.severity,
        });
      }

      if (result.death) {
        const pendingDeath: PendingDeath = {
          cause: result.death.cause,
          triggeredTick: result.death.tick,
          triggeredDate: result.death.date,
          eligibleFromTick: toTick + 1,
          eligibleFromDate: advanceDateByTicks(toDate, 1, clock.tickUnit),
          ageAtProc: result.death.age,
        };

        await markPlayerDeathPending(tx, player, pendingDeath);
        pendingDeathDetails.push(toPendingDeathDetail(player, pendingDeath));
      }
    }

    await tx
      .update(simulationClock)
      .set({ currentTick: toTick, currentDate: toDate, updatedAt: new Date() })
      .where(eq(simulationClock.id, clock.id));

    const summary: TimeAdvanceSummary = {
      deaths: deathDetails.map(d => d.playerId),
      pendingDeaths: pendingDeathDetails.map(d => d.playerId),
      ailments: ailmentDetails.map(a => a.playerId),
      aged: agedCount,
    };

    await tx.insert(timeAdvanceLog).values({
      fromTick,
      toTick,
      fromDate,
      toDate,
      advancedById,
      summary,
    });
  });

  return {
    fromTick,
    toTick,
    fromDate,
    toDate,
    summary: {
      deaths: deathDetails.map(d => d.playerId),
      pendingDeaths: pendingDeathDetails.map(d => d.playerId),
      ailments: ailmentDetails.map(a => a.playerId),
      aged: agedCount,
    },
    deathDetails,
    pendingDeathDetails,
    ailmentDetails,
    aged: agedCount,
  };
}

/**
 * Dry run of advanceTime — same logic, no writes.
 */
export async function previewAdvance(
  db: Database,
  ticks: number,
): Promise<AdvanceResult> {
  const clock = await getClock(db);
  if (!clock) throw new Error('No simulation clock found.');

  const config = clock.agingConfig ?? DEFAULT_AGING_CONFIG;
  const fromTick = clock.currentTick;
  const toTick = fromTick + ticks;
  const fromDate = clock.currentDate;
  const perTickDates = buildPerTickDates(fromDate, ticks, clock.tickUnit);
  const toDate = perTickDates[perTickDates.length - 1]!;

  const livingPlayers = await db.select().from(players).where(eq(players.isAlive, true));

  const deathDetails: DeathDetail[] = [];
  const pendingDeathDetails: PendingDeathDetail[] = [];
  const ailmentDetails: AilmentDetail[] = [];
  let agedCount = 0;

  for (const player of livingPlayers) {
    const pendingDeath = getPendingDeath(player.profileData);
    if (pendingDeath) {
      const deathTick = fromTick + 1;
      const deathDate = perTickDates[1] ?? toDate;

      if (deathTick >= pendingDeath.eligibleFromTick) {
        deathDetails.push({
          playerId: player.id,
          characterName: player.characterName,
          age: calculateAge(player.birthDate, deathDate) ?? player.currentAge ?? null,
          cause: pendingDeath.cause,
        });
      } else {
        pendingDeathDetails.push(toPendingDeathDetail(player, pendingDeath));
      }

      continue;
    }

    const state: PlayerTickState = {
      id: player.id,
      characterName: player.characterName,
      birthDate: player.birthDate,
      ailments: ((player.ailments ?? []) as AilmentEntry[]).slice(),
      isAlive: true,
    };

    const result = simulatePlayerTicks(state, config, fromTick, ticks, perTickDates);
    if (result.finalAge == null) continue;
    if (result.ageChanged) agedCount++;

    for (const { ailment } of result.newAilments) {
      ailmentDetails.push({
        playerId: player.id,
        characterName: player.characterName,
        condition: ailment.condition,
        severity: ailment.severity,
      });
    }

    if (result.death) {
      pendingDeathDetails.push(toPendingDeathDetail(player, {
        cause: result.death.cause,
        triggeredTick: result.death.tick,
        triggeredDate: result.death.date,
        eligibleFromTick: toTick + 1,
        eligibleFromDate: advanceDateByTicks(toDate, 1, clock.tickUnit),
        ageAtProc: result.death.age,
      }));
    }
  }

  return {
    fromTick,
    toTick,
    fromDate,
    toDate,
    summary: {
      deaths: deathDetails.map(d => d.playerId),
      pendingDeaths: pendingDeathDetails.map(d => d.playerId),
      ailments: ailmentDetails.map(a => a.playerId),
      aged: agedCount,
    },
    deathDetails,
    pendingDeathDetails,
    ailmentDetails,
    aged: agedCount,
  };
}

/**
 * Manually assign an ailment to a player.
 */
export async function manualAilment(
  db: Database,
  playerId: string,
  condition: string,
  severity: 'minor' | 'major' | 'critical',
  triggeredById?: string,
) {
  const [player] = await db.select().from(players).where(eq(players.id, playerId));
  if (!player) throw new Error('Player not found');
  if (!player.isAlive) throw new Error('Cannot assign ailments to a dead character');

  const clock = await getClock(db);
  const currentTick = clock?.currentTick ?? 0;
  const currentDate = clock?.currentDate ?? 'unknown';

  const currentAilments = (player.ailments ?? []) as {
    condition: string;
    severity: 'minor' | 'major' | 'critical';
    acquiredAtTick: number;
    acquiredAtAge: number;
    notes?: string;
  }[];

  // Check for duplicate
  if (currentAilments.some(a => a.condition === condition)) {
    throw new Error(`Player already has ailment: ${condition}`);
  }

  const newAilment = {
    condition,
    severity,
    acquiredAtTick: currentTick,
    acquiredAtAge: player.currentAge ?? 0,
    notes: 'Manually assigned by staff',
  };

  const updatedAilments = [...currentAilments, newAilment];
  const worstSeverity = getWorstSeverity(updatedAilments);

  await db
    .update(players)
    .set({
      ailments: updatedAilments,
      healthStatus: worstSeverity,
    })
    .where(eq(players.id, playerId));

  await db.insert(playerEventLog).values({
    playerId,
    eventType: 'ailment_acquired',
    description: `Staff assigned ${severity} ailment: ${condition}`,
    newValue: newAilment,
    simTick: currentTick,
    simDate: currentDate,
    triggeredById: triggeredById ?? null,
    isAutomatic: false,
  });

  return { player, ailment: newAilment, healthStatus: worstSeverity };
}

/**
 * Remove an ailment from a player (heal / cure).
 */
export async function heal(
  db: Database,
  playerId: string,
  condition: string,
  triggeredById?: string,
) {
  const [player] = await db.select().from(players).where(eq(players.id, playerId));
  if (!player) throw new Error('Player not found');

  const clock = await getClock(db);
  const currentTick = clock?.currentTick ?? 0;
  const currentDate = clock?.currentDate ?? 'unknown';

  const currentAilments = (player.ailments ?? []) as {
    condition: string;
    severity: 'minor' | 'major' | 'critical';
    acquiredAtTick: number;
    acquiredAtAge: number;
    notes?: string;
  }[];

  const ailmentIndex = currentAilments.findIndex(a => a.condition === condition);
  if (ailmentIndex === -1) {
    throw new Error(`Player does not have ailment: ${condition}`);
  }

  const removed = currentAilments[ailmentIndex]!;
  const updatedAilments = currentAilments.filter((_, i) => i !== ailmentIndex);
  const worstSeverity = updatedAilments.length > 0 ? getWorstSeverity(updatedAilments) : 'healthy';

  await db
    .update(players)
    .set({
      ailments: updatedAilments,
      healthStatus: worstSeverity,
    })
    .where(eq(players.id, playerId));

  await db.insert(playerEventLog).values({
    playerId,
    eventType: 'ailment_recovered',
    description: `Recovered from ${removed.severity} ailment: ${condition}`,
    oldValue: removed,
    simTick: currentTick,
    simDate: currentDate,
    triggeredById: triggeredById ?? null,
    isAutomatic: false,
  });

  return { player, removed, healthStatus: worstSeverity };
}

/**
 * Manually kill a player character.
 */
export async function manualDeath(
  db: Database,
  playerId: string,
  cause: string,
  triggeredById?: string,
) {
  const [player] = await db.select().from(players).where(eq(players.id, playerId));
  if (!player) throw new Error('Player not found');
  if (!player.isAlive) throw new Error('Player is already dead');

  const clock = await getClock(db);
  const currentDate = clock?.currentDate ?? 'unknown';
  const currentTick = clock?.currentTick ?? 0;

  await processPlayerDeath(
    db,
    playerId,
    cause,
    currentDate,
    currentTick,
    triggeredById ?? null,
    false,
    withoutPendingDeath(player.profileData),
  );

  return { player, cause, deathDate: currentDate };
}

/**
 * Generate obituary data for a deceased player, assembled from their event log.
 */
export async function generateObituary(db: Database, playerId: string) {
  const [player] = await db.select().from(players).where(eq(players.id, playerId));
  if (!player) throw new Error('Player not found');

  // Fetch all events for narrative
  const events = await db
    .select()
    .from(playerEventLog)
    .where(eq(playerEventLog.playerId, playerId));

  // Party history
  const partyChanges = events
    .filter(e => e.eventType === 'party_change')
    .map(e => ({
      description: e.description,
      date: e.simDate,
      oldValue: e.oldValue as { partyName?: string } | null,
      newValue: e.newValue as { partyName?: string } | null,
    }));

  // Offices held
  const officesHeld = events
    .filter(e => e.eventType === 'office_appointed' || e.eventType === 'office_left')
    .map(e => ({
      description: e.description,
      date: e.simDate,
      eventType: e.eventType,
      newValue: e.newValue as { officeName?: string } | null,
    }));

  // Build narrative
  const name = player.characterName ?? 'Unknown';
  const narrativeParts: string[] = [];

  // Prefer the age computed from birthDate vs deathDate when both are present;
  // fall back to the cached currentAge otherwise.
  const ageAtDeath =
    calculateAge(player.birthDate, player.deathDate) ?? player.currentAge;

  if (ageAtDeath != null) {
    narrativeParts.push(`${name} lived to the age of ${ageAtDeath}.`);
  }

  if (partyChanges.length > 0) {
    const lastParty = partyChanges[partyChanges.length - 1];
    const partyName = lastParty?.newValue?.partyName ?? 'an independent faction';
    narrativeParts.push(`A member of ${partyName}.`);
  }

  if (officesHeld.length > 0) {
    const officeNames = officesHeld
      .filter(o => o.eventType === 'office_appointed')
      .map(o => o.newValue?.officeName ?? o.description)
      .filter(Boolean);

    if (officeNames.length > 0) {
      narrativeParts.push(`Served as ${officeNames.join(', ')}.`);
    }
  }

  if (player.causeOfDeath) {
    narrativeParts.push(`Died of ${player.causeOfDeath}.`);
  }

  return {
    characterName: player.characterName ?? 'Unknown',
    birthDate: player.birthDate ?? 'unknown',
    deathDate: player.deathDate ?? 'unknown',
    age: ageAtDeath,
    causeOfDeath: player.causeOfDeath ?? 'unknown causes',
    partyHistory: partyChanges,
    officesHeld,
    narrative: narrativeParts.join(' '),
    portraitUrl: player.characterPortraitUrl,
  };
}

/**
 * Get time advance history log.
 */
function sanitizeAdvanceSummary(
  summary: unknown,
  viewer?: SimulationPrivacyViewer,
): unknown {
  if (!viewer || viewer.isStaff || !isRecord(summary)) return summary;

  return {
    ...summary,
    deaths: [],
    pendingDeaths: [],
    ailments: [],
  };
}

export function sanitizeTimeAdvanceLog<T extends { summary: unknown; notes?: unknown }>(
  row: T,
  viewer?: SimulationPrivacyViewer,
): T {
  if (!viewer || viewer.isStaff) return row;
  return {
    ...row,
    notes: null,
    summary: sanitizeAdvanceSummary(row.summary, viewer),
  };
}

export async function getHistory(db: Database, limit = 20, viewer?: SimulationPrivacyViewer) {
  const rows = await db
    .select()
    .from(timeAdvanceLog)
    .orderBy(timeAdvanceLog.createdAt)
    .limit(limit);
  return rows.map((row) => sanitizeTimeAdvanceLog(row, viewer));
}

// ============================================================
// Internal Helpers
// ============================================================

/**
 * Process a player's death -- shared between advanceTime and manualDeath.
 *
 * - Marks player as dead
 * - Vacates all offices
 * - Logs death event and office-left events
 *
 * Accepts either a Database or a transaction handle.
 */
async function processPlayerDeath(
  db: DbOrTx,
  playerId: string,
  causeOfDeath: string,
  deathDate: string,
  deathTick: number,
  triggeredById: string | null,
  isAutomatic: boolean,
  profileData?: ProfileData | null,
) {
  // Mark player dead
  await db
    .update(players)
    .set({
      isAlive: false,
      deathDate,
      causeOfDeath,
      healthStatus: 'deceased',
      ...(profileData !== undefined ? { profileData } : {}),
    })
    .where(eq(players.id, playerId));

  // Log death event
  await db.insert(playerEventLog).values({
    playerId,
    eventType: 'death',
    description: `Died of ${causeOfDeath}`,
    newValue: { causeOfDeath, deathDate },
    simTick: deathTick,
    simDate: deathDate,
    triggeredById,
    isAutomatic,
  });

  // Vacate all offices held by this player
  const heldOffices = await db
    .select({
      holderId: officeHolders.id,
      officeId: officeHolders.officeId,
      officeName: offices.name,
    })
    .from(officeHolders)
    .innerJoin(offices, eq(officeHolders.officeId, offices.id))
    .where(
      and(
        eq(officeHolders.playerId, playerId),
        isNull(officeHolders.endDate),
      ),
    );

  for (const held of heldOffices) {
    await db
      .update(officeHolders)
      .set({
        endDate: new Date(),
        removalReason: 'died',
      })
      .where(eq(officeHolders.id, held.holderId));

    // Log office vacated
    await db.insert(playerEventLog).values({
      playerId,
      eventType: 'office_left',
      description: `Vacated ${held.officeName} (died in office)`,
      oldValue: { officeId: held.officeId, officeName: held.officeName },
      simTick: deathTick,
      simDate: deathDate,
      triggeredById,
      isAutomatic,
    });
  }
}
