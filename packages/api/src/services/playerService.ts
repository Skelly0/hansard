import { eq, and, desc, isNull, isNotNull, ilike, or, inArray, count, ne, type SQL } from 'drizzle-orm';
import {
  players,
  playerEventLog,
  parties,
  factions,
  officeHolders,
  offices,
  simulationClock,
  ballots,
  elections,
  type Database,
} from '@hansard/db';
import type {
  PlayerProfile,
  PlayerEvent,
  Ailment,
  ElectionConfig,
} from '@hansard/shared';
import {
  DEFAULT_SIMULATION_CURRENT_DATE,
  PlayerEventType,
  birthDateForAge,
  buildArchivedCharacter,
  profileDataWithArchive,
} from '@hansard/shared';
import {
  expireCharacterFavourBalances,
  grantStartingFactionFavours,
} from './favourService.js';

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

export interface PlayerOfficeHistoryEntry {
  officeId: string;
  officeName: string;
  startDate: string;
  endDate: string | null;
  appointmentMethod: string;
}

export interface PlayerVoteRecordEntry {
  electionId: string;
  electionTitle: string;
  choice: string | null;
  castAt: string | null;
}

export interface PlayerVoteRecordViewer {
  userId: string;
  isStaff: boolean;
}

export interface PlayerPrivacyViewer {
  userId: string;
  isStaff: boolean;
}

export const PUBLIC_PLAYER_EVENT_TYPES = [
  PlayerEventType.PARTY_CHANGE,
  PlayerEventType.FACTION_CHANGE,
  PlayerEventType.OFFICE_APPOINTED,
  PlayerEventType.OFFICE_LEFT,
  PlayerEventType.DEATH,
  PlayerEventType.REGISTRATION,
  PlayerEventType.REINCARNATION,
  PlayerEventType.NAME_CHANGE,
];

export function canViewPrivatePlayerData(
  targetPlayerId: string,
  viewer?: PlayerPrivacyViewer,
): boolean {
  return !viewer || viewer.isStaff || viewer.userId === targetPlayerId;
}

// ============================================================
// Starting Age Favour Bonus
// ============================================================

// Default tiers — in production these come from simulation config.
// The service calculates which tier applies and returns the bonus amount.
const DEFAULT_FAVOUR_TIERS = [
  { minAge: 35, totalFavours: 1 },
  { minAge: 45, totalFavours: 2 },
  { minAge: 60, totalFavours: 3 },
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
 * applies it to the selected faction's matching favour category when present,
 * and logs a registration event.
 */
export async function createCharacter(db: Database, data: CreateCharacterInput): Promise<PlayerProfile> {
  // Anchor birthDate to the simulation clock's current date, not wall-clock time.
  // Falls back to the 2075 season date if the sim clock isn't initialised.
  const [clock] = await db.select().from(simulationClock).limit(1);
  const simNow = clock?.currentDate ?? DEFAULT_SIMULATION_CURRENT_DATE;
  const birthDate = birthDateForAge(simNow, data.startingAge);

  const favourBonus = calculateStartingAgeFavourBonus(data.startingAge);

  const player = await db.transaction(async (tx) => {
    // Reincarnation: if the Discord user already has a row whose character
    // is dead, archive the dead character and reset the row.
    const [existing] = await tx
      .select()
      .from(players)
      .where(eq(players.discordId, data.discordId))
      .limit(1);

    let writtenRow: typeof players.$inferSelect;
    let isReincarnation = false;
    let previousCharacterName: string | null = null;

    if (existing && existing.characterName && !existing.isAlive) {
      isReincarnation = true;
      previousCharacterName = existing.characterName;
      const archive = buildArchivedCharacter(existing);
      const baseProfileData = profileDataWithArchive(existing.profileData, archive);
      const mergedProfileData = data.profileData
        ? { ...baseProfileData, ...data.profileData, previousCharacters: baseProfileData.previousCharacters }
        : baseProfileData;

      await expireCharacterFavourBalances(tx, existing.id, {
        reason: 'Previous character favours expired on reincarnation',
        simTick: clock?.currentTick ?? null,
        simDate: simNow,
      });

      const [updated] = await tx
        .update(players)
        .set({
          discordUsername: data.discordUsername,
          characterName: data.characterName,
          characterBio: data.characterBio ?? null,
          characterPortraitUrl: data.characterPortraitUrl ?? null,
          startingAge: data.startingAge,
          currentAge: data.startingAge,
          birthDate,
          factionId: data.factionId ?? null,
          partyId: data.partyId ?? null,
          deathDate: null,
          causeOfDeath: null,
          isAlive: true,
          healthStatus: 'healthy',
          ailments: [],
          startingFavoursGranted: false,
          isActive: true,
          profileData: mergedProfileData,
        })
        .where(and(eq(players.id, existing.id), eq(players.isAlive, false)))
        .returning();

      if (!updated) {
        throw new Error('CHARACTER_RACE_CONDITION');
      }
      writtenRow = updated;
    } else if (existing && !existing.characterName) {
      // OAuth placeholder row — fill it in.
      const [updated] = await tx
        .update(players)
        .set({
          discordUsername: data.discordUsername,
          characterName: data.characterName,
          characterBio: data.characterBio ?? null,
          characterPortraitUrl: data.characterPortraitUrl ?? null,
          startingAge: data.startingAge,
          currentAge: data.startingAge,
          birthDate,
          factionId: data.factionId ?? null,
          partyId: data.partyId ?? null,
          profileData: data.profileData ?? existing.profileData ?? null,
          startingFavoursGranted: false,
          isActive: true,
        })
        .where(and(eq(players.id, existing.id), isNull(players.characterName)))
        .returning();

      if (!updated) {
        throw new Error('CHARACTER_RACE_CONDITION');
      }
      writtenRow = updated;
    } else {
      const [created] = await tx.insert(players).values({
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
        startingFavoursGranted: false,
        isAlive: true,
        isActive: true,
        isStaff: false,
        healthStatus: 'healthy',
        ailments: [],
      }).returning();
      writtenRow = created;
    }

    await tx.insert(playerEventLog).values({
      playerId: writtenRow.id,
      eventType: isReincarnation ? PlayerEventType.REINCARNATION : PlayerEventType.REGISTRATION,
      description: isReincarnation
        ? `${data.characterName} registered as the successor to ${previousCharacterName} (age ${data.startingAge})`
        : `${data.characterName} registered as a new character (age ${data.startingAge})`,
      newValue: {
        characterName: data.characterName,
        startingAge: data.startingAge,
        factionId: data.factionId ?? null,
        partyId: data.partyId ?? null,
        favourBonus,
        ...(isReincarnation ? { previousCharacterName } : {}),
      },
    });

    const startingFavourGrant = await grantStartingFactionFavours(tx, writtenRow.id, data.factionId, favourBonus);
    if (!startingFavourGrant) {
      return writtenRow;
    }

    const [updated] = await tx
      .update(players)
      .set({ startingFavoursGranted: true })
      .where(eq(players.id, writtenRow.id))
      .returning();

    return updated;
  });

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
function playerListConditions(filters: ListPlayersFilters): SQL[] {
  const conditions: SQL[] = [isNotNull(players.characterName)];

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

  return conditions;
}

export async function listPlayers(db: Database, filters: ListPlayersFilters = {}): Promise<PlayerProfile[]> {
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const conditions = playerListConditions(filters);
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

export async function countPlayers(db: Database, filters: ListPlayersFilters = {}): Promise<number> {
  const conditions = playerListConditions(filters);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [row] = await db
    .select({ value: count() })
    .from(players)
    .where(whereClause);

  return row?.value ?? 0;
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
  options: { allowInviteOnly?: boolean } = {},
): Promise<PlayerProfile | null> {
  const existing = await getPlayer(db, playerId);
  if (!existing) return null;
  if (existing.partyId === newPartyId) return existing; // no-op: already in this party

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
  if (newParty.isInviteOnly && !options.allowInviteOnly) {
    throw new Error(`Party "${newParty.name}" is invite-only`);
  }
  newPartyName = newParty.name;

  // Update the player
  const [updated] = await db
    .update(players)
    .set({ partyId: newPartyId })
    .where(eq(players.id, playerId))
    .returning();

  // If the player was leading their old party, clear that stale leaderId
  // so the old party doesn't keep displaying the now-departed member as leader.
  if (existing.partyId) {
    await db
      .update(parties)
      .set({ leaderId: null })
      .where(and(eq(parties.id, existing.partyId), eq(parties.leaderId, playerId)));
  }

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

  // Clear stale leaderId if the leaving player was the party's leader.
  await db
    .update(parties)
    .set({ leaderId: null })
    .where(and(eq(parties.id, existing.partyId), eq(parties.leaderId, playerId)));

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
  viewer?: PlayerPrivacyViewer,
): Promise<PlayerEvent[]> {
  const conditions: SQL[] = [eq(playerEventLog.playerId, playerId)];

  if (filters.eventType) {
    conditions.push(eq(playerEventLog.eventType, filters.eventType));
  }
  if (viewer && !viewer.isStaff) {
    conditions.push(
      viewer.userId === playerId
        ? ne(playerEventLog.eventType, PlayerEventType.DEATH_PENDING)
        : inArray(playerEventLog.eventType, PUBLIC_PLAYER_EVENT_TYPES),
    );
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

  return sanitizePlayerEvents(results.map(toPlayerEvent), viewer);
}

/**
 * Get a player's current health status and ailment history.
 */
export async function getPlayerHealth(
  db: Database,
  playerId: string,
  viewer?: PlayerPrivacyViewer,
): Promise<{ healthStatus: PlayerProfile['healthStatus']; ailments: Ailment[]; events: PlayerEvent[] } | null> {
  const player = await getPlayer(db, playerId);
  if (!player) return null;
  if (!canViewPrivatePlayerData(playerId, viewer)) {
    return {
      healthStatus: player.isAlive ? null : player.healthStatus,
      ailments: [],
      events: [],
    };
  }

  const healthEventTypes: PlayerEventType[] = [
    PlayerEventType.AILMENT_ACQUIRED,
    PlayerEventType.AILMENT_RECOVERED,
    PlayerEventType.HEALTH_CHANGED,
    PlayerEventType.DEATH,
  ];
  if (!viewer || viewer.isStaff) {
    healthEventTypes.push(PlayerEventType.DEATH_PENDING);
  }

  // Filter to health-related event types in SQL so the LIMIT 50 actually
  // returns up to 50 health events (not 50 events of any type).
  const healthEvents = await db
    .select()
    .from(playerEventLog)
    .where(
      and(
        eq(playerEventLog.playerId, playerId),
        inArray(playerEventLog.eventType, healthEventTypes),
      ),
    )
    .orderBy(desc(playerEventLog.createdAt))
    .limit(50);

  return {
    healthStatus: player.healthStatus,
    ailments: player.ailments,
    events: sanitizePlayerEvents(healthEvents.map(toPlayerEvent), viewer),
  };
}

/**
 * Get all offices a player has held, newest first.
 */
export async function getPlayerOfficeHistory(
  db: Database,
  playerId: string,
): Promise<PlayerOfficeHistoryEntry[]> {
  const rows = await db
    .select({
      holder: officeHolders,
      officeName: offices.name,
    })
    .from(officeHolders)
    .innerJoin(offices, eq(officeHolders.officeId, offices.id))
    .where(eq(officeHolders.playerId, playerId))
    .orderBy(desc(officeHolders.startDate));

  return rows.map((row) => ({
    officeId: row.holder.officeId,
    officeName: row.officeName,
    startDate: row.holder.startDate.toISOString(),
    endDate: row.holder.endDate?.toISOString() ?? null,
    appointmentMethod: row.holder.appointmentMethod,
  }));
}

/**
 * Get a player's voting record across elections, newest first.
 */
export async function getPlayerVotingRecord(
  db: Database,
  playerId: string,
  viewer?: PlayerVoteRecordViewer,
): Promise<PlayerVoteRecordEntry[]> {
  const rows = await db
    .select({
      ballot: ballots,
      electionTitle: elections.title,
      electionStatus: elections.status,
      electionConfig: elections.config,
    })
    .from(ballots)
    .innerJoin(elections, eq(ballots.electionId, elections.id))
    .where(eq(ballots.voterId, playerId))
    .orderBy(desc(ballots.castAt));

  return rows.map((row) => {
    const canViewDetails = canViewBallotDetails({
      targetPlayerId: playerId,
      viewer,
      electionStatus: row.electionStatus,
      electionConfig: row.electionConfig as ElectionConfig,
    });

    return {
      electionId: row.ballot.electionId,
      electionTitle: row.electionTitle,
      choice: canViewDetails ? formatBallotChoice(row.ballot.vote) : null,
      castAt: canViewDetails ? row.ballot.castAt.toISOString() : null,
    };
  });
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

export function sanitizePlayerProfile(
  profile: PlayerProfile,
  viewer?: PlayerPrivacyViewer,
): PlayerProfile {
  if (!viewer || viewer.isStaff) return profile;
  const canViewOwnHealth = viewer.userId === profile.id;

  return {
    ...profile,
    healthStatus: canViewOwnHealth || !profile.isAlive ? profile.healthStatus : null,
    ailments: canViewOwnHealth ? profile.ailments : [],
    staffRole: null,
    profileData: null,
  };
}

export function sanitizePlayerEvents(
  events: PlayerEvent[],
  viewer?: PlayerPrivacyViewer,
): PlayerEvent[] {
  if (!viewer || viewer.isStaff) return events;
  const withoutStaffOnlyEvents = events.filter(
    (event) => event.eventType !== PlayerEventType.DEATH_PENDING,
  );
  if (withoutStaffOnlyEvents.every((event) => event.playerId === viewer.userId)) {
    return withoutStaffOnlyEvents;
  }

  const publicTypes = new Set<string>(PUBLIC_PLAYER_EVENT_TYPES);
  return withoutStaffOnlyEvents
    .filter((event) => publicTypes.has(event.eventType))
    .map((event) => ({
      ...event,
      oldValue: null,
      newValue: null,
    }));
}

function formatBallotChoice(vote: typeof ballots.$inferSelect.vote): string {
  switch (vote.type) {
    case 'yea_nay_abstain':
      return vote.choice;
    case 'fptp':
    case 'two_round':
    case 'exhaustive':
      return vote.candidateId;
    case 'approval':
      return vote.approved.join(', ');
    case 'ranked':
      return vote.ranking.join(' > ');
  }
}

function canViewBallotDetails({
  targetPlayerId,
  viewer,
  electionStatus,
  electionConfig,
}: {
  targetPlayerId: string;
  viewer?: PlayerVoteRecordViewer;
  electionStatus: string;
  electionConfig: ElectionConfig;
}): boolean {
  if (viewer?.userId === targetPlayerId) {
    return true;
  }

  if (electionConfig.anonymousBallots) {
    return false;
  }

  const detailsArePublic = electionStatus === 'tallied' || electionStatus === 'certified';
  if (electionConfig.sealedResults && !detailsArePublic) {
    return false;
  }

  if (viewer?.isStaff) {
    return true;
  }

  return detailsArePublic;
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
 * The "fresh insert" check uses the row's createdAt vs updatedAt-style heuristic:
 * if the row was inserted just now (within the last few seconds AND the username
 * was already up to date), treat it as the creating call. We avoid the
 * SELECT-then-INSERT pattern entirely so two concurrent OAuth callbacks can't
 * both think they are the creator.
 */
export async function findOrCreatePlayerByDiscordId(
  db: Database,
  input: { discordId: string; discordUsername: string },
): Promise<FindOrCreateResult> {
  const before = Date.now();

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
  // If registeredAt is at-or-after the moment we entered this call, this row
  // was created by THIS call (vs. updated by ON CONFLICT). Allow a small skew
  // for clock drift between app and DB.
  const registeredMs = player.registeredAt instanceof Date
    ? player.registeredAt.getTime()
    : new Date(player.registeredAt as unknown as string).getTime();
  const wasCreated = registeredMs >= before - 1000;

  if (wasCreated) {
    try {
      await db.insert(playerEventLog).values({
        playerId: player.id,
        eventType: 'registration',
        description: `Player auto-registered via Discord OAuth (@${input.discordUsername})`,
      });
    } catch (err) {
      console.warn('Failed to write registration event log for player', player.id, err);
    }
  }

  return { player, wasCreated };
}

/**
 * Aggregate permissions for a player from all currently-active office holdings.
 * Currently-active = office_holders.endDate IS NULL and office is active.
 * Returns a deduped list of permission strings.
 */
export async function aggregatePermissionsForPlayer(db: Database, playerId: string): Promise<string[]> {
  const rows = await db
    .select({ permissions: offices.permissions })
    .from(officeHolders)
    .innerJoin(offices, eq(officeHolders.officeId, offices.id))
    .where(and(
      eq(officeHolders.playerId, playerId),
      isNull(officeHolders.endDate),
      eq(offices.isActive, true),
    ));

  const set = new Set<string>();
  for (const row of rows) {
    if (Array.isArray(row.permissions)) {
      for (const p of row.permissions) set.add(p);
    }
  }
  return Array.from(set);
}
