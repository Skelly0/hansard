import { eq, and, desc, isNull, asc } from 'drizzle-orm';
import {
  offices,
  officeHolders,
  players,
  playerEventLog,
  type Database,
} from '@hansard/db';
import type { Office, OfficeHolder } from '@hansard/shared';
import { PlayerEventType } from '@hansard/shared';

// ============================================================
// Types for service inputs
// ============================================================

export interface CreateOfficeInput {
  name: string;
  tier: string;
  factionId?: string;
  maxHolders?: number;
  permissions?: string[];
  filledBy?: string;
  appointableBy?: string;
  requiresConfirmation?: boolean;
  discordRoleId?: string;
  sortOrder?: number;
}

export interface UpdateOfficeInput {
  name?: string;
  tier?: string;
  factionId?: string | null;
  maxHolders?: number;
  permissions?: string[];
  filledBy?: string;
  appointableBy?: string | null;
  requiresConfirmation?: boolean;
  discordRoleId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface OfficeWithHolder extends Office {
  currentHolders: (OfficeHolder & { playerName: string | null; discordUsername: string })[];
}

export interface OfficeDetail extends OfficeWithHolder {
  holderHistory: (OfficeHolder & { playerName: string | null; discordUsername: string })[];
}

// ============================================================
// Service Functions
// ============================================================

/**
 * List all offices with their current holders.
 */
export async function listOffices(db: Database): Promise<OfficeWithHolder[]> {
  const allOffices = await db
    .select()
    .from(offices)
    .where(eq(offices.isActive, true))
    .orderBy(asc(offices.sortOrder), asc(offices.name));

  const result: OfficeWithHolder[] = [];

  for (const office of allOffices) {
    const holders = await db
      .select({
        holder: officeHolders,
        playerName: players.characterName,
        discordUsername: players.discordUsername,
      })
      .from(officeHolders)
      .innerJoin(players, eq(officeHolders.playerId, players.id))
      .where(
        and(
          eq(officeHolders.officeId, office.id),
          isNull(officeHolders.endDate),
        ),
      );

    result.push({
      ...toOffice(office),
      currentHolders: holders.map((h) => ({
        ...toOfficeHolder(h.holder),
        playerName: h.playerName,
        discordUsername: h.discordUsername,
      })),
    });
  }

  return result;
}

/**
 * Get a single office by ID with full details and holder history.
 */
export async function getOffice(db: Database, id: string): Promise<OfficeDetail | null> {
  const [office] = await db
    .select()
    .from(offices)
    .where(eq(offices.id, id))
    .limit(1);

  if (!office) return null;

  // Current holders
  const currentHolders = await db
    .select({
      holder: officeHolders,
      playerName: players.characterName,
      discordUsername: players.discordUsername,
    })
    .from(officeHolders)
    .innerJoin(players, eq(officeHolders.playerId, players.id))
    .where(
      and(
        eq(officeHolders.officeId, id),
        isNull(officeHolders.endDate),
      ),
    );

  // Full holder history (most recent first)
  const holderHistory = await db
    .select({
      holder: officeHolders,
      playerName: players.characterName,
      discordUsername: players.discordUsername,
    })
    .from(officeHolders)
    .innerJoin(players, eq(officeHolders.playerId, players.id))
    .where(eq(officeHolders.officeId, id))
    .orderBy(desc(officeHolders.startDate));

  return {
    ...toOffice(office),
    currentHolders: currentHolders.map((h) => ({
      ...toOfficeHolder(h.holder),
      playerName: h.playerName,
      discordUsername: h.discordUsername,
    })),
    holderHistory: holderHistory.map((h) => ({
      ...toOfficeHolder(h.holder),
      playerName: h.playerName,
      discordUsername: h.discordUsername,
    })),
  };
}

/**
 * Create a new office (staff only).
 */
export async function createOffice(db: Database, data: CreateOfficeInput): Promise<Office> {
  const [office] = await db.insert(offices).values({
    name: data.name,
    tier: data.tier,
    factionId: data.factionId ?? null,
    maxHolders: data.maxHolders ?? 1,
    permissions: data.permissions ?? null,
    filledBy: data.filledBy ?? 'elected',
    appointableBy: data.appointableBy ?? null,
    requiresConfirmation: data.requiresConfirmation ?? false,
    discordRoleId: data.discordRoleId ?? null,
    sortOrder: data.sortOrder ?? 0,
    isActive: true,
  }).returning();

  return toOffice(office);
}

/**
 * Update an existing office's config (staff only).
 */
export async function updateOffice(
  db: Database,
  id: string,
  data: UpdateOfficeInput,
): Promise<Office | null> {
  const [existing] = await db
    .select()
    .from(offices)
    .where(eq(offices.id, id))
    .limit(1);

  if (!existing) return null;

  const updates: Record<string, unknown> = {};

  if (data.name !== undefined) updates.name = data.name;
  if (data.tier !== undefined) updates.tier = data.tier;
  if (data.factionId !== undefined) updates.factionId = data.factionId;
  if (data.maxHolders !== undefined) updates.maxHolders = data.maxHolders;
  if (data.permissions !== undefined) updates.permissions = data.permissions;
  if (data.filledBy !== undefined) updates.filledBy = data.filledBy;
  if (data.appointableBy !== undefined) updates.appointableBy = data.appointableBy;
  if (data.requiresConfirmation !== undefined) updates.requiresConfirmation = data.requiresConfirmation;
  if (data.discordRoleId !== undefined) updates.discordRoleId = data.discordRoleId;
  if (data.isActive !== undefined) updates.isActive = data.isActive;
  if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;

  if (Object.keys(updates).length === 0) {
    return toOffice(existing);
  }

  const [updated] = await db
    .update(offices)
    .set(updates)
    .where(eq(offices.id, id))
    .returning();

  return toOffice(updated);
}

/**
 * Appoint a player to an office.
 *
 * - Checks max holders and removes excess if needed
 * - Logs an office_appointed event to playerEventLog
 * - Returns the Discord role ID if the caller should sync it
 *
 * If requiresConfirmation is true, the caller is responsible for
 * creating a confirmation vote before calling this function.
 */
export async function appointToOffice(
  db: Database,
  officeId: string,
  playerId: string,
  appointedById: string,
): Promise<{ holder: OfficeHolder; office: Office; discordRoleId: string | null }> {
  const [office] = await db
    .select()
    .from(offices)
    .where(eq(offices.id, officeId))
    .limit(1);

  if (!office) {
    throw new Error(`Office not found: ${officeId}`);
  }

  if (!office.isActive) {
    throw new Error(`Office "${office.name}" is not active`);
  }

  // Verify the player exists
  const [player] = await db
    .select()
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1);

  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  if (!player.isAlive) {
    throw new Error(`Cannot appoint a deceased character to office`);
  }

  // Check if this player already holds this office
  const [existingHolding] = await db
    .select()
    .from(officeHolders)
    .where(
      and(
        eq(officeHolders.officeId, officeId),
        eq(officeHolders.playerId, playerId),
        isNull(officeHolders.endDate),
      ),
    )
    .limit(1);

  if (existingHolding) {
    throw new Error(`${player.characterName ?? player.discordUsername} already holds the office of ${office.name}`);
  }

  // Check current holder count — if at max, this is still allowed
  // (the caller should remove existing holders first, or we can enforce here)
  const currentHolders = await db
    .select()
    .from(officeHolders)
    .where(
      and(
        eq(officeHolders.officeId, officeId),
        isNull(officeHolders.endDate),
      ),
    );

  if (currentHolders.length >= office.maxHolders) {
    throw new Error(
      `Office "${office.name}" already has ${currentHolders.length}/${office.maxHolders} holders. Remove existing holder(s) first.`,
    );
  }

  // Create the office holder record
  const [holder] = await db.insert(officeHolders).values({
    officeId,
    playerId,
    appointedBy: appointedById,
    appointmentMethod: 'appointed',
  }).returning();

  // Log the event
  await db.insert(playerEventLog).values({
    playerId,
    eventType: PlayerEventType.OFFICE_APPOINTED,
    description: `Appointed to ${office.name}`,
    newValue: {
      officeId,
      officeName: office.name,
      appointedById,
    },
    triggeredById: appointedById,
  });

  return {
    holder: toOfficeHolder(holder),
    office: toOffice(office),
    discordRoleId: office.discordRoleId,
  };
}

/**
 * Remove the current holder from an office.
 *
 * - Sets endDate and removalReason on the office_holders record
 * - Logs an office_left event to playerEventLog
 * - Returns the Discord role ID if the caller should un-sync it
 */
export async function removeFromOffice(
  db: Database,
  officeId: string,
  removedById: string,
  reason?: string,
): Promise<{ holder: OfficeHolder; office: Office; playerId: string; discordRoleId: string | null }> {
  const [office] = await db
    .select()
    .from(offices)
    .where(eq(offices.id, officeId))
    .limit(1);

  if (!office) {
    throw new Error(`Office not found: ${officeId}`);
  }

  // Find the current holder
  const [currentHolder] = await db
    .select()
    .from(officeHolders)
    .where(
      and(
        eq(officeHolders.officeId, officeId),
        isNull(officeHolders.endDate),
      ),
    )
    .limit(1);

  if (!currentHolder) {
    throw new Error(`Office "${office.name}" has no current holder`);
  }

  // End the tenure
  const [updated] = await db
    .update(officeHolders)
    .set({
      endDate: new Date(),
      removalReason: reason ?? 'removed_by_appointer',
      removedById,
    })
    .where(eq(officeHolders.id, currentHolder.id))
    .returning();

  // Log the event
  await db.insert(playerEventLog).values({
    playerId: currentHolder.playerId,
    eventType: PlayerEventType.OFFICE_LEFT,
    description: `Removed from ${office.name}${reason ? `: ${reason}` : ''}`,
    oldValue: {
      officeId,
      officeName: office.name,
    },
    triggeredById: removedById,
  });

  return {
    holder: toOfficeHolder(updated),
    office: toOffice(office),
    playerId: currentHolder.playerId,
    discordRoleId: office.discordRoleId,
  };
}

/**
 * Get the full holder history for an office, chronologically.
 */
export async function getHolderHistory(
  db: Database,
  officeId: string,
): Promise<(OfficeHolder & { playerName: string | null; discordUsername: string })[]> {
  const history = await db
    .select({
      holder: officeHolders,
      playerName: players.characterName,
      discordUsername: players.discordUsername,
    })
    .from(officeHolders)
    .innerJoin(players, eq(officeHolders.playerId, players.id))
    .where(eq(officeHolders.officeId, officeId))
    .orderBy(asc(officeHolders.startDate));

  return history.map((h) => ({
    ...toOfficeHolder(h.holder),
    playerName: h.playerName,
    discordUsername: h.discordUsername,
  }));
}

// ============================================================
// Mappers
// ============================================================

function toOffice(row: typeof offices.$inferSelect): Office {
  return {
    id: row.id,
    name: row.name,
    tier: row.tier as Office['tier'],
    factionId: row.factionId,
    maxHolders: row.maxHolders,
    permissions: row.permissions as string[] | null,
    filledBy: row.filledBy as Office['filledBy'],
    appointableBy: row.appointableBy,
    requiresConfirmation: row.requiresConfirmation,
    discordRoleId: row.discordRoleId,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

function toOfficeHolder(row: typeof officeHolders.$inferSelect): OfficeHolder {
  return {
    id: row.id,
    officeId: row.officeId,
    playerId: row.playerId,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate?.toISOString() ?? null,
    appointedBy: row.appointedBy,
    appointmentMethod: row.appointmentMethod as OfficeHolder['appointmentMethod'],
    electionId: row.electionId,
    removalReason: row.removalReason,
    removedById: row.removedById,
    simTick: row.simTick,
    simDate: row.simDate,
  };
}
