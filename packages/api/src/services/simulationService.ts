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
import type { AgingConfig, AilmentPoolEntry, TimeAdvanceSummary } from '@hansard/shared';

// ============================================================
// Default Aging Config
// ============================================================

const DEFAULT_AGING_CONFIG: AgingConfig = {
  ailmentAgeThreshold: 55,
  ailmentBaseChance: 0.05,
  ailmentAgeScaling: 0.02,
  deathAgeThreshold: 70,
  deathBaseChance: 0.02,
  deathAgeScaling: 0.03,
  criticalAilmentDeathChance: 0.15,
  ailmentPool: [
    { name: 'gout', severity: 'minor', weight: 3, description: 'Painful joint inflammation' },
    { name: 'fever', severity: 'minor', weight: 3, description: 'Persistent high fever' },
    { name: 'pneumonia', severity: 'major', weight: 2, description: 'Severe lung infection' },
    { name: 'heart disease', severity: 'major', weight: 2, minAge: 60, description: 'Weakening of the heart' },
    { name: 'tuberculosis', severity: 'major', weight: 1, description: 'Wasting disease of the lungs' },
    { name: 'stroke', severity: 'critical', weight: 1, minAge: 65, description: 'Sudden cerebral event' },
  ],
  minStartingAge: 18,
  maxStartingAge: 70,
  defaultStartingAge: 30,
  startingAgeFavourBonus: {
    enabled: false,
    tiers: [],
  },
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
  ailmentDetails: AilmentDetail[];
  aged: number;
}

interface DeathDetail {
  playerId: string;
  characterName: string | null;
  age: number | null;
  cause: string;
}

interface AilmentDetail {
  playerId: string;
  characterName: string | null;
  condition: string;
  severity: string;
}

// ============================================================
// Helpers
// ============================================================

function getAgingConfig(): AgingConfig {
  // Future: load from DB or config table. For now, use defaults.
  return DEFAULT_AGING_CONFIG;
}

/**
 * Advance a date string by N ticks of the given unit.
 * Supports ISO-style dates (YYYY-MM-DD) and freeform "Year X, Month Y".
 */
function advanceDateByTicks(dateStr: string, ticks: number, tickUnit: string): string {
  // Try ISO date first
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const date = new Date(`${dateStr}T00:00:00Z`);
    switch (tickUnit) {
      case 'day':
        date.setUTCDate(date.getUTCDate() + ticks);
        break;
      case 'week':
        date.setUTCDate(date.getUTCDate() + ticks * 7);
        break;
      case 'month':
        date.setUTCMonth(date.getUTCMonth() + ticks);
        break;
      case 'year':
        date.setUTCFullYear(date.getUTCFullYear() + ticks);
        break;
    }
    return date.toISOString().split('T')[0]!;
  }

  // Freeform: "Year X, Month Y" pattern
  const freeformMatch = dateStr.match(/Year\s+(\d+),?\s*Month\s+(\d+)/i);
  if (freeformMatch) {
    let year = parseInt(freeformMatch[1]!, 10);
    let month = parseInt(freeformMatch[2]!, 10);

    switch (tickUnit) {
      case 'month':
        month += ticks;
        while (month > 12) { month -= 12; year++; }
        while (month < 1) { month += 12; year--; }
        break;
      case 'year':
        year += ticks;
        break;
      case 'day':
      case 'week':
        // For freeform dates, approximate: treat as months
        month += ticks;
        while (month > 12) { month -= 12; year++; }
        break;
    }
    return `Year ${year}, Month ${month}`;
  }

  // Fallback: just append tick info
  return `${dateStr} +${ticks} ${tickUnit}s`;
}

/**
 * Calculate how many years a player ages per tick.
 */
function ageIncrementPerTick(tickUnit: string): number {
  switch (tickUnit) {
    case 'year': return 1;
    case 'month': return 1 / 12;
    case 'week': return 1 / 52;
    case 'day': return 1 / 365;
    default: return 1;
  }
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
export async function advanceTime(
  db: Database,
  ticks: number,
  advancedById: string,
): Promise<AdvanceResult> {
  const clock = await getClock(db);
  if (!clock) throw new Error('No simulation clock found. Create one first.');
  if (clock.isPaused) throw new Error('Simulation clock is paused. Unpause before advancing.');

  const config = getAgingConfig();
  const fromTick = clock.currentTick;
  const toTick = fromTick + ticks;
  const fromDate = clock.currentDate;
  const toDate = advanceDateByTicks(fromDate, ticks, clock.tickUnit);
  const ageIncrement = ageIncrementPerTick(clock.tickUnit) * ticks;

  // Fetch all living players with a character
  const livingPlayers = await db
    .select()
    .from(players)
    .where(eq(players.isAlive, true));

  const deathDetails: DeathDetail[] = [];
  const ailmentDetails: AilmentDetail[] = [];
  let agedCount = 0;

  for (const player of livingPlayers) {
    if (player.currentAge == null) continue;

    // --- Step 3: Age the player ---
    const newAge = Math.floor(player.currentAge + ageIncrement);
    const ageChanged = newAge !== player.currentAge;

    await db
      .update(players)
      .set({ currentAge: newAge })
      .where(eq(players.id, player.id));

    if (ageChanged) agedCount++;

    // --- Step 4: Ailment rolls ---
    if (newAge >= config.ailmentAgeThreshold) {
      const ailmentChance =
        config.ailmentBaseChance +
        (newAge - config.ailmentAgeThreshold) * config.ailmentAgeScaling;

      if (Math.random() < ailmentChance) {
        const ailment = rollAilment(config, newAge);
        if (ailment) {
          const currentAilments = (player.ailments ?? []) as {
            condition: string;
            severity: 'minor' | 'major' | 'critical';
            acquiredAtTick: number;
            acquiredAtAge: number;
            notes?: string;
          }[];

          // Don't duplicate the same condition
          const alreadyHas = currentAilments.some(a => a.condition === ailment.name);
          if (!alreadyHas) {
            const newAilment = {
              condition: ailment.name,
              severity: ailment.severity,
              acquiredAtTick: toTick,
              acquiredAtAge: newAge,
            };

            const updatedAilments = [...currentAilments, newAilment];

            // Determine overall health status from worst ailment
            const worstSeverity = getWorstSeverity(updatedAilments);

            await db
              .update(players)
              .set({
                ailments: updatedAilments,
                healthStatus: worstSeverity,
              })
              .where(eq(players.id, player.id));

            // Log ailment event
            await db.insert(playerEventLog).values({
              playerId: player.id,
              eventType: 'ailment_acquired',
              description: `Acquired ${ailment.severity} ailment: ${ailment.name}`,
              newValue: newAilment,
              simTick: toTick,
              simDate: toDate,
              isAutomatic: true,
            });

            ailmentDetails.push({
              playerId: player.id,
              characterName: player.characterName,
              condition: ailment.name,
              severity: ailment.severity,
            });

            // Update local reference for death roll check
            player.ailments = updatedAilments as typeof player.ailments;
          }
        }
      }
    }

    // --- Step 5: Death rolls ---
    const currentAilments = (player.ailments ?? []) as {
      condition: string;
      severity: 'minor' | 'major' | 'critical';
      acquiredAtTick: number;
      acquiredAtAge: number;
    }[];

    let deathChance = 0;
    let causeOfDeath: string | null = null;

    // Critical ailment death chance
    const criticalAilments = currentAilments.filter(a => a.severity === 'critical');
    if (criticalAilments.length > 0) {
      deathChance += config.criticalAilmentDeathChance * criticalAilments.length;
      causeOfDeath = criticalAilments[0]!.condition;
    }

    // Multiple major ailments compound risk
    const majorAilments = currentAilments.filter(a => a.severity === 'major');
    if (majorAilments.length >= 2) {
      deathChance += 0.05 * majorAilments.length;
      if (!causeOfDeath) causeOfDeath = 'complications from multiple ailments';
    }

    // Age-based natural death
    if (newAge >= config.deathAgeThreshold) {
      const ageDeathChance =
        config.deathBaseChance +
        (newAge - config.deathAgeThreshold) * config.deathAgeScaling;
      if (ageDeathChance > deathChance) {
        causeOfDeath = 'natural causes';
      }
      deathChance = Math.max(deathChance, ageDeathChance);
    }

    if (deathChance > 0 && Math.random() < deathChance) {
      // --- Step 6: Process death ---
      await processPlayerDeath(
        db,
        player.id,
        causeOfDeath ?? 'unknown causes',
        toDate,
        toTick,
        null, // system-triggered
        true,
      );

      deathDetails.push({
        playerId: player.id,
        characterName: player.characterName,
        age: newAge,
        cause: causeOfDeath ?? 'unknown causes',
      });
    }
  }

  // --- Step 7: Update clock ---
  await db
    .update(simulationClock)
    .set({
      currentTick: toTick,
      currentDate: toDate,
      updatedAt: new Date(),
    })
    .where(eq(simulationClock.id, clock.id));

  // --- Step 8: Create log entry ---
  const summary: TimeAdvanceSummary = {
    deaths: deathDetails.map(d => d.playerId),
    ailments: ailmentDetails.map(a => a.playerId),
    aged: agedCount,
  };

  await db.insert(timeAdvanceLog).values({
    fromTick,
    toTick,
    fromDate,
    toDate,
    advancedById,
    summary,
  });

  return {
    fromTick,
    toTick,
    fromDate,
    toDate,
    summary,
    deathDetails,
    ailmentDetails,
    aged: agedCount,
  };
}

/**
 * Dry run of advanceTime -- same logic, but doesn't commit anything.
 * Runs the RNG so the preview shows *potential* outcomes, not guaranteed ones.
 */
export async function previewAdvance(
  db: Database,
  ticks: number,
): Promise<AdvanceResult> {
  const clock = await getClock(db);
  if (!clock) throw new Error('No simulation clock found.');

  const config = getAgingConfig();
  const fromTick = clock.currentTick;
  const toTick = fromTick + ticks;
  const fromDate = clock.currentDate;
  const toDate = advanceDateByTicks(fromDate, ticks, clock.tickUnit);
  const ageIncrement = ageIncrementPerTick(clock.tickUnit) * ticks;

  const livingPlayers = await db
    .select()
    .from(players)
    .where(eq(players.isAlive, true));

  const deathDetails: DeathDetail[] = [];
  const ailmentDetails: AilmentDetail[] = [];
  let agedCount = 0;

  for (const player of livingPlayers) {
    if (player.currentAge == null) continue;

    const newAge = Math.floor(player.currentAge + ageIncrement);
    if (newAge !== player.currentAge) agedCount++;

    // Ailment check (simulated)
    if (newAge >= config.ailmentAgeThreshold) {
      const ailmentChance =
        config.ailmentBaseChance +
        (newAge - config.ailmentAgeThreshold) * config.ailmentAgeScaling;

      if (Math.random() < ailmentChance) {
        const ailment = rollAilment(config, newAge);
        if (ailment) {
          const currentAilments = (player.ailments ?? []) as { condition: string }[];
          if (!currentAilments.some(a => a.condition === ailment.name)) {
            ailmentDetails.push({
              playerId: player.id,
              characterName: player.characterName,
              condition: ailment.name,
              severity: ailment.severity,
            });
          }
        }
      }
    }

    // Death check (simulated)
    const currentAilments = (player.ailments ?? []) as {
      condition: string;
      severity: 'minor' | 'major' | 'critical';
    }[];

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

    if (newAge >= config.deathAgeThreshold) {
      const ageDeathChance =
        config.deathBaseChance +
        (newAge - config.deathAgeThreshold) * config.deathAgeScaling;
      if (ageDeathChance > deathChance) causeOfDeath = 'natural causes';
      deathChance = Math.max(deathChance, ageDeathChance);
    }

    if (deathChance > 0 && Math.random() < deathChance) {
      deathDetails.push({
        playerId: player.id,
        characterName: player.characterName,
        age: newAge,
        cause: causeOfDeath ?? 'unknown causes',
      });
    }
  }

  return {
    fromTick,
    toTick,
    fromDate,
    toDate,
    summary: {
      deaths: deathDetails.map(d => d.playerId),
      ailments: ailmentDetails.map(a => a.playerId),
      aged: agedCount,
    },
    deathDetails,
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

  await processPlayerDeath(db, playerId, cause, currentDate, currentTick, triggeredById ?? null, false);

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

  if (player.startingAge != null && player.currentAge != null) {
    narrativeParts.push(
      `${name} lived to the age of ${player.currentAge}.`,
    );
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
    age: player.currentAge,
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
export async function getHistory(db: Database, limit = 20) {
  const rows = await db
    .select()
    .from(timeAdvanceLog)
    .orderBy(timeAdvanceLog.createdAt)
    .limit(limit);
  return rows;
}

// ============================================================
// Internal Helpers
// ============================================================

/**
 * Determine worst severity from an ailments array.
 */
function getWorstSeverity(
  ailments: { severity: 'minor' | 'major' | 'critical' }[],
): string {
  if (ailments.some(a => a.severity === 'critical')) return 'critical';
  if (ailments.some(a => a.severity === 'major')) return 'major';
  if (ailments.some(a => a.severity === 'minor')) return 'minor';
  return 'healthy';
}

/**
 * Process a player's death -- shared between advanceTime and manualDeath.
 *
 * - Marks player as dead
 * - Vacates all offices
 * - Logs death event and office-left events
 */
async function processPlayerDeath(
  db: Database,
  playerId: string,
  causeOfDeath: string,
  deathDate: string,
  deathTick: number,
  triggeredById: string | null,
  isAutomatic: boolean,
) {
  // Mark player dead
  await db
    .update(players)
    .set({
      isAlive: false,
      deathDate,
      causeOfDeath,
      healthStatus: 'deceased',
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
