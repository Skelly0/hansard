import { eq, asc, sql, and, inArray } from 'drizzle-orm';
import {
  parties,
  factions,
  players,
  playerEventLog,
  type Database,
} from '@hansard/db';
import type {
  Party,
  PartyWithStats,
  CreatePartyInput,
  UpdatePartyInput,
} from '@hansard/shared';

function toParty(row: typeof parties.$inferSelect): Party {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    factionId: row.factionId,
    leaderId: row.leaderId,
    ideology: row.ideology,
    colour: row.colour,
    discordRoleId: row.discordRoleId,
    isInviteOnly: row.isInviteOnly,
    isActive: row.isActive,
    foundedAt: row.foundedAt.toISOString(),
    dissolvedAt: row.dissolvedAt ? row.dissolvedAt.toISOString() : null,
  };
}

export interface GetPartiesOptions {
  includeInactive?: boolean;
}

/**
 * List parties with member counts, faction name, and leader name attached.
 */
export async function getParties(
  db: Database,
  options: GetPartiesOptions = {},
): Promise<PartyWithStats[]> {
  const baseQuery = db
    .select({
      party: parties,
      factionName: factions.name,
    })
    .from(parties)
    .leftJoin(factions, eq(parties.factionId, factions.id));

  const rows = options.includeInactive
    ? await baseQuery.orderBy(asc(parties.name))
    : await baseQuery.where(eq(parties.isActive, true)).orderBy(asc(parties.name));

  // Member counts grouped by partyId (active players only).
  const counts = await db
    .select({
      partyId: players.partyId,
      count: sql<number>`count(*)::int`,
    })
    .from(players)
    .where(eq(players.isActive, true))
    .groupBy(players.partyId);

  const countMap = new Map<string | null, number>();
  for (const c of counts) countMap.set(c.partyId, c.count);

  // Resolve leader names in a single follow-up fetch.
  const leaderIds = rows
    .map((r) => r.party.leaderId)
    .filter((id): id is string => Boolean(id));

  const leaderMap = new Map<string, string>();
  if (leaderIds.length > 0) {
    const leaderRows = await db
      .select({
        id: players.id,
        characterName: players.characterName,
        discordUsername: players.discordUsername,
      })
      .from(players)
      .where(inArray(players.id, leaderIds));
    for (const lr of leaderRows) {
      leaderMap.set(lr.id, lr.characterName ?? lr.discordUsername);
    }
  }

  return rows.map(({ party, factionName }) => ({
    ...toParty(party),
    memberCount: countMap.get(party.id) ?? 0,
    factionName: factionName ?? null,
    leaderName: party.leaderId ? leaderMap.get(party.leaderId) ?? null : null,
  }));
}

/**
 * Fetch a single party by id, with members + faction + leader info.
 */
export async function getPartyById(
  db: Database,
  id: string,
): Promise<(PartyWithStats & {
  members: { id: string; characterName: string | null; discordUsername: string }[];
}) | null> {
  const [row] = await db
    .select({
      party: parties,
      factionName: factions.name,
    })
    .from(parties)
    .leftJoin(factions, eq(parties.factionId, factions.id))
    .where(eq(parties.id, id))
    .limit(1);

  if (!row) return null;

  const memberRows = await db
    .select({
      id: players.id,
      characterName: players.characterName,
      discordUsername: players.discordUsername,
    })
    .from(players)
    .where(and(eq(players.partyId, id), eq(players.isActive, true)))
    .orderBy(asc(players.characterName));

  let leaderName: string | null = null;
  if (row.party.leaderId) {
    const [leader] = await db
      .select({
        characterName: players.characterName,
        discordUsername: players.discordUsername,
      })
      .from(players)
      .where(eq(players.id, row.party.leaderId))
      .limit(1);
    if (leader) leaderName = leader.characterName ?? leader.discordUsername;
  }

  return {
    ...toParty(row.party),
    factionName: row.factionName ?? null,
    leaderName,
    memberCount: memberRows.length,
    members: memberRows,
  };
}

/**
 * Create a new party.
 */
export async function createParty(
  db: Database,
  data: CreatePartyInput,
): Promise<Party> {
  if (data.colour && !/^#[0-9a-fA-F]{6}$/.test(data.colour)) {
    throw new Error('Colour must be a 6-digit hex like #b94a48');
  }

  const [row] = await db
    .insert(parties)
    .values({
      name: data.name,
      shortName: data.shortName ?? null,
      factionId: data.factionId ?? null,
      leaderId: data.leaderId ?? null,
      ideology: data.ideology ?? null,
      colour: data.colour ?? null,
      discordRoleId: data.discordRoleId ?? null,
      isInviteOnly: data.isInviteOnly ?? false,
      isActive: true,
    })
    .returning();

  return toParty(row);
}

/**
 * Update an existing party. Returns null if not found.
 */
export async function updateParty(
  db: Database,
  id: string,
  data: UpdatePartyInput,
): Promise<Party | null> {
  const [existing] = await db
    .select()
    .from(parties)
    .where(eq(parties.id, id))
    .limit(1);

  if (!existing) return null;

  if (data.colour !== undefined && data.colour !== null && !/^#[0-9a-fA-F]{6}$/.test(data.colour)) {
    throw new Error('Colour must be a 6-digit hex like #b94a48');
  }

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.shortName !== undefined) updates.shortName = data.shortName;
  if (data.factionId !== undefined) updates.factionId = data.factionId;
  if (data.leaderId !== undefined) updates.leaderId = data.leaderId;
  if (data.ideology !== undefined) updates.ideology = data.ideology;
  if (data.colour !== undefined) updates.colour = data.colour;
  if (data.discordRoleId !== undefined) updates.discordRoleId = data.discordRoleId;
  if (data.isInviteOnly !== undefined) updates.isInviteOnly = data.isInviteOnly;
  if (data.isActive !== undefined) {
    updates.isActive = data.isActive;
    if (data.isActive === false) {
      updates.dissolvedAt = new Date();
    } else {
      updates.dissolvedAt = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return toParty(existing);
  }

  const [row] = await db
    .update(parties)
    .set(updates)
    .where(eq(parties.id, id))
    .returning();

  return toParty(row);
}

/**
 * Soft-delete a party. Members are unassigned (partyId set to null) and an
 * event-log entry is written for each affected player. This is the ledger
 * equivalent of dissolving a political party — the row stays for history.
 */
export async function dissolveParty(
  db: Database,
  id: string,
  triggeredById: string | null,
): Promise<{ party: Party; unassigned: number } | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(parties)
      .where(eq(parties.id, id))
      .limit(1);

    if (!existing) return null;

    const memberRows = await tx
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.partyId, id), eq(players.isActive, true)));

    if (memberRows.length > 0) {
      await tx
        .update(players)
        .set({ partyId: null })
        .where(eq(players.partyId, id));

      await tx.insert(playerEventLog).values(
        memberRows.map((m) => ({
          playerId: m.id,
          eventType: 'party_change' as const,
          description: `Party "${existing.name}" was dissolved`,
          oldValue: { partyId: existing.id, partyName: existing.name },
          newValue: { partyId: null, partyName: null },
          triggeredById,
          isAutomatic: false,
        })),
      );
    }

    const [row] = await tx
      .update(parties)
      .set({ isActive: false, dissolvedAt: new Date() })
      .where(eq(parties.id, id))
      .returning();

    return { party: toParty(row), unassigned: memberRows.length };
  });
}
