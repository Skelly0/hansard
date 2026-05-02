import { eq, and, desc, isNull, ilike, or, type SQL } from 'drizzle-orm';
import {
  players,
  playerEventLog,
  parties,
  factions,
  officeHolders,
  offices,
  type Database,
} from '@hansard/db';
import type {
  PlayerProfile,
  PlayerEvent,
  Ailment,
} from '@hansard/shared';
import { PlayerEventType } from '@hansard/shared';

// ============================================================
// Types for service inputs
// ============================================================

export interface CreateCharacterInput {
  discordId: string;
  discordUsername: string;
  characterName: string;
  characterBio?: string;
  characterPortraitUrl?: string;
  startingAge: number;
  factionId?: string;
  partyId?: string;
  profileData?: { timezone?: string; pronouns?: string; [key: string]: unknown };
}

export interface UpdateCharacterInput {
  characterBio?: string;
  characterPortraitUrl?: string;
  characterName?: string;
}

export interface ListPlayersFilters {
  factionId?: string;
  partyId?: string;
  isActive?: boolean;
  isStaff?: boolean;
  isAlive?: boolean;
  search?: string;       // case-insensitive substring on characterName OR discordUsername
  limit?: number;
  offset?: number;
}

export interface PlayerEventFilters {
  eventType?: string;
  limit?: number;
  offset?: number;
}

// ============================================================
// Starting Age Favour Bonus
// ============================================================

// Default tiers — in production these come from simulation config.
// The service calculates which tier applies and returns the bonus amount.
const DEFAULT_FAVOUR_TIERS = [
  { minAge: 35, totalFavours: 2 },
  { minAge: 45, totalFavours: 5 },
  { minAge: 55, totalFavours: 9 },
  { minAge: 65, totalFavours: 14 },
];

/**
 * Calculate the starting age favour bonus for a given age.
 * Returns the highest tier the age qualifies for, or 0.
 */
export function calculateStartingAgeFavourBonus(age: number): number {
  let bonus = 0;
  for (const tier of DEFAULT_FAVOUR_TIERS) {
    if (age >= tier.minAge) {
      bonus = tier.totalFavours;
    }
  }
  return bonus;
}

// ============================================================
// Service Functions
// ============================================================

/**
 * Create a new player character.
 * Inserts the player record, calculates starting age favour bonus,
 * and logs a registration event.
 */
export async function createCharacter(db: Database, data: CreateCharacterInput): Promise<PlayerProfile> {
  // Calculate birth date from starting age (simple: current year minus age)
  const currentYear = new Date().getFullYear();
  const birthYear = currentYear - data.startingAge;
  const birthDate = `${birthYear}-01-01`;

  const favourBonus = calculateStartingAgeFavourBonus(data.startingAge);

  const [player] = await db.insert(players).values({
    discordId: data.discordId,
    discordUsername: data.discordUsername,
    characterName: data.characterName,
    characterBio: data.characterBio ?? null,
    characterPortraitUrl: data.characterPortraitUrl ?? null,
    startingAge: data.startingAge,
    currentAge: data.startingAge,
    birthDate,
    factionId: data.factionId ?? null,
    partyId: data.partyId ?? null,
    profileData: data.profileData ?? null,
    startingFavoursGranted: favourBonus > 0,
    isAlive: true,
    isActive: true,
    isStaff: false,
    healthStatus: 'healthy',
    ailments: [],
  }).returning();

  // Log registration event
  await db.insert(playerEventLog).values({
    playerId: player.id,
    eventType: PlayerEventType.REGISTRATION,
    description: `${data.characterName} registered as a new character (age ${data.startingAge})`,
    newValue: {
      characterName: data.characterName,
      startingAge: data.startingAge,
      factionId: data.factionId ?? null,
      partyId: data.partyId ?? null,
      favourBonus,
    },
  });

  // TODO: If favourBonus > 0, create favour transactions in the favours table.
  // This depends on the favour service being built — for now we just flag it.

  return toPlayerProfile(player);
}

/**
 * Get a player by their internal UUID.
 */
export async function getPlayer(db: Database, id: string): Promise<PlayerProfile | null> {
  const [player] = await db.select().from(players).where(eq(players.id, id)).limit(1);
  if (!player) return null;
  return toPlayerProfile(player);
}

/**
 * Get a player by their Discord ID.
 */
export async function getPlayerByDiscordId(db: Database, discordId: string): Promise<PlayerProfile | null> {
  const [player] = await db.select().from(players).where(eq(players.discordId, discordId)).limit(1);
  if (!player) return null;
  return toPlayerProfile(player);
}

/**
 * List players with optional filters.
 */
export async function listPlayers(db: Database, filters: ListPlayersFilters = {}): Promise<PlayerProfile[]> {
  const conditions: SQL[] = [];

  if (filters.factionId !== undefined) {
    conditions.push(eq(players.factionId, filters.factionId));
  }
  if (filters.partyId !== undefined) {
    conditions.push(eq(players.partyId, filters.partyId));
  }
  if (filters.isActive !== undefined) {
    conditions.push(eq(players.isActive, filters.isActive));
  }
  if (filters.isStaff !== undefined) {
    conditions.push(eq(players.isStaff, filters.isStaff));
  }
  if (filters.isAlive !== undefined) {
    conditions.push(eq(players.isAlive, filters.isAlive));
  }
  if (filters.search !== undefined && filters.search.length > 0) {
    const term = `%${filters.search}%`;
    conditions.push(or(ilike(players.characterName, term), ilike(players.discordUsername, term))!);
  }

  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select()
    .from(players)
    .where(whereClause)
    .orderBy(desc(players.registeredAt))
    .limit(limit)
    .offset(offset);

  return results.map(toPlayerProfile);
}

/**
 * Update a player's character info (bio, portrait, name).
 * Name changes are flagged via an event log entry.
 */
export async function updateCharacter(
  db: Database,
  id: string,
  data: UpdateCharacterInput,
): Promise<PlayerProfile | null> {
  const existing = await getPlayer(db, id);
  if (!existing) return null;

  const updates: Record<string, unknown> = {};

  if (data.characterBio !== undefined) {
    updates.characterBio = data.characterBio;
  }
  if (data.characterPortraitUrl !== undefined) {
    updates.characterPortraitUrl = data.characterPortraitUrl;
  }
  if (data.characterName !== undefined && data.characterName !== existing.characterName) {
    updates.characterName = data.characterName;

    // Log name change — these get flagged for staff review
    await db.insert(playerEventLog).values({
      playerId: id,
      eventType: PlayerEventType.NAME_CHANGE,
      description: `Name changed from "${existing.characterName}" to "${data.characterName}"`,
      oldValue: { characterName: existing.characterName },
      newValue: { characterName: data.characterName },
    });
  }

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  const [updated] = await db
    .update(players)
    .set(updates)
    .where(eq(players.id, id))
    .returning();

  return toPlayerProfile(updated);
}

/**
 * Change a player's party. Logs the event with old/new values.
 */
export async function changeParty(
  db: Database,
  playerId: string,
  newPartyId: string,
  triggeredById?: string,
): Promise<PlayerProfile | null> {
  const existing = await getPlayer(db, playerId);
  if (!existing) return null;

  // Fetch party names for the event log
  let oldPartyName: string | null = null;
  let newPartyName: string | null = null;

  if (existing.partyId) {
    const [oldParty] = await db.select().from(parties).where(eq(parties.id, existing.partyId)).limit(1);
    oldPartyName = oldParty?.name ?? null;
  }

  const [newParty] = await db.select().from(parties).where(eq(parties.id, newPartyId)).limit(1);
  if (!newParty) {
    throw new Error(`Party not found: ${newPartyId}`);
  }
  newPartyName = newParty.name;

  // Update the player
  const [updated] = await db
    .update(players)
    .set({ partyId: newPartyId })
    .where(eq(players.id, playerId))
    .returning();

  // Log the event
  await db.insert(playerEventLog).values({
    playerId,
    eventType: PlayerEventType.PARTY_CHANGE,
    description: oldPartyName
      ? `Left ${oldPartyName} and joined ${newPartyName}`
      : `Joined ${newPartyName}`,
    oldValue: existing.partyId
      ? { partyId: existing.partyId, partyName: oldPartyName }
      : null,
    newValue: { partyId: newPartyId, partyName: newPartyName },
    triggeredById: triggeredById ?? null,
  });

  return toPlayerProfile(updated);
}

/**
 * Leave current party (become independent).
 */
export async function leaveParty(
  db: Database,
  playerId: string,
): Promise<PlayerProfile | null> {
  const existing = await getPlayer(db, playerId);
  if (!existing) return null;
  if (!existing.partyId) return existing; // already independent

  // Fetch old party name
  let oldPartyName: string | null = null;
  const [oldParty] = await db.select().from(parties).where(eq(parties.id, existing.partyId)).limit(1);
  oldPartyName = oldParty?.name ?? null;

  const [updated] = await db
    .update(players)
    .set({ partyId: null })
    .where(eq(players.id, playerId))
    .returning();

  await db.insert(playerEventLog).values({
    playerId,
    eventType: PlayerEventType.PARTY_CHANGE,
    description: `Left ${oldPartyName ?? 'their party'} (now independent)`,
    oldValue: { partyId: existing.partyId, partyName: oldPartyName },
    newValue: null,
  });

  return toPlayerProfile(updated);
}

/**
 * Get events for a player, with optional filters.
 */
export async function getPlayerEvents(
  db: Database,
  playerId: string,
  filters: PlayerEventFilters = {},
): Promise<PlayerEvent[]> {
  const conditions: SQL[] = [eq(playerEventLog.playerId, playerId)];

  if (filters.eventType) {
    conditions.push(eq(playerEventLog.eventType, filters.eventType));
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const results = await db
    .select()
    .from(playerEventLog)
    .where(and(...conditions))
    .orderBy(desc(playerEventLog.createdAt))
    .limit(limit)
    .offset(offset);

  return results.map(toPlayerEvent);
}

/**
 * Get a player's current health status and ailment history.
 */
export async function getPlayerHealth(
  db: Database,
  playerId: string,
): Promise<{ healthStatus: string; ailments: Ailment[]; events: PlayerEvent[] } | null> {
  const player = await getPlayer(db, playerId);
  if (!player) return null;

  // Get health-related events
  const healthEvents = await db
    .select()
    .from(playerEventLog)
    .where(
      and(
        eq(playerEventLog.playerId, playerId),
        // We fetch all health-related event types
      ),
    )
    .orderBy(desc(playerEventLog.createdAt))
    .limit(50);

  // Filter to health-related events in JS (simpler than building an OR chain)
  const healthEventTypes = new Set([
    PlayerEventType.AILMENT_ACQUIRED,
    PlayerEventType.AILMENT_RECOVERED,
    PlayerEventType.HEALTH_CHANGED,
    PlayerEventType.DEATH,
  ]);

  const filteredEvents = healthEvents
    .filter((e) => healthEventTypes.has(e.eventType as PlayerEvent['eventType']))
    .map(toPlayerEvent);

  return {
    healthStatus: player.healthStatus,
    ailments: player.ailments,
    events: filteredEvents,
  };
}

// ============================================================
// Mappers
// ============================================================

/**
 * Map a raw DB row to a PlayerProfile shape.
 */
function toPlayerProfile(row: typeof players.$inferSelect): PlayerProfile {
  return {
    id: row.id,
    discordId: row.discordId,
    discordUsername: row.discordUsername,
    characterName: row.characterName,
    characterBio: row.characterBio,
    characterPortraitUrl: row.characterPortraitUrl,
    factionId: row.factionId,
    partyId: row.partyId,
    birthDate: row.birthDate,
    startingAge: row.startingAge,
    currentAge: row.currentAge,
    deathDate: row.deathDate,
    causeOfDeath: row.causeOfDeath,
    isAlive: row.isAlive,
    healthStatus: row.healthStatus as PlayerProfile['healthStatus'],
    ailments: (row.ailments ?? []) as Ailment[],
    startingFavoursGranted: row.startingFavoursGranted,
    isActive: row.isActive,
    isStaff: row.isStaff,
    staffRole: row.staffRole,
    registeredAt: row.registeredAt.toISOString(),
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    profileData: row.profileData ?? null,
  };
}

/**
 * Map a raw DB row to a PlayerEvent shape.
 */
function toPlayerEvent(row: typeof playerEventLog.$inferSelect): PlayerEvent {
  return {
    id: row.id,
    playerId: row.playerId,
    eventType: row.eventType as PlayerEvent['eventType'],
    description: row.description,
    oldValue: row.oldValue,
    newValue: row.newValue,
    simTick: row.simTick,
    simDate: row.simDate,
    triggeredById: row.triggeredById,
    isAutomatic: row.isAutomatic,
    createdAt: row.createdAt.toISOString(),
  };
}

// ============================================================
// Discord OAuth: find-or-create player on login
// ============================================================

export interface FindOrCreateResult {
  player: typeof players.$inferSelect;
  wasCreated: boolean;
}

/**
 * Look up a player by Discord ID. If absent, insert a new active player row.
 * Uses ON CONFLICT to be safe under concurrent OAuth callbacks (two tabs).
 *
 * On fresh insert, also writes a playerEventLog row (eventType='registration').
 */
export async function findOrCreatePlayerByDiscordId(
  db: Database,
  input: { discordId: string; discordUsername: string },
): Promise<FindOrCreateResult> {
  const existing = await db.select().from(players).where(eq(players.discordId, input.discordId)).limit(1);
  if (existing.length > 0) {
    return { player: existing[0], wasCreated: false };
  }

  const inserted = await db
    .insert(players)
    .values({
      discordId: input.discordId,
      discordUsername: input.discordUsername,
    })
    .onConflictDoUpdate({
      target: players.discordId,
      set: { discordUsername: input.discordUsername },
    })
    .returning();

  const player = inserted[0];

  try {
    await db.insert(playerEventLog).values({
      playerId: player.id,
      eventType: 'registration',
      description: `Player auto-registered via Discord OAuth (@${input.discordUsername})`,
    });
  } catch (err) {
    console.warn('Failed to write registration event log for player', player.id, err);
  }

  return { player, wasCreated: true };
}

/**
 * Aggregate permissions for a player from all currently-active office holdings.
 * Currently-active = office_holders.endDate IS NULL.
 * Returns a deduped list of permission strings.
 */
export async function aggregatePermissionsForPlayer(db: Database, playerId: string): Promise<string[]> {
  const rows = await db
    .select({ permissions: offices.permissions })
    .from(officeHolders)
    .innerJoin(offices, eq(officeHolders.officeId, offices.id))
    .where(and(eq(officeHolders.playerId, playerId), isNull(officeHolders.endDate)));

  const set = new Set<string>();
  for (const row of rows) {
    if (Array.isArray(row.permissions)) {
      for (const p of row.permissions) set.add(p);
    }
  }
  return Array.from(set);
}
