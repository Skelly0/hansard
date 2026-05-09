import { GuildMember, type APIInteractionGuildMember } from 'discord.js';
import { and, eq, isNull } from 'drizzle-orm';
import { officeHolders, offices, players } from '@hansard/db';
import { db } from '../db.js';

/**
 * Staff role name — checked against member roles.
 * This will be configurable via DB/env in the future.
 */
const STAFF_ROLE_NAME = 'Staff';
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;

type InteractionMember = APIInteractionGuildMember | GuildMember | null | undefined;

/**
 * Check whether a guild member is staff.
 *
 * Currently checks:
 * 1. Whether the member has a role named "Staff"
 * 2. Whether the member has `isStaff` set in the DB
 *
 * Returns true if either condition is met.
 *
 * Accepts the full `interaction.member` union — `APIInteractionGuildMember`
 * only carries role IDs (no names), so without a `Guild` lookup we cannot
 * resolve the staff role name there. In practice the bot has the
 * `GUILD_MEMBERS` intent so call sites always receive a real `GuildMember`;
 * the API-only branch is a safe fallback.
 */
export async function isStaff(member: InteractionMember): Promise<boolean> {
  if (!member) {
    return false;
  }

  // Role-based check — only resolvable on a full GuildMember (cache has names).
  if (member instanceof GuildMember) {
    const hasStaffRole = member.roles.cache.some(
      (role) => role.name === STAFF_ROLE_NAME || role.id === STAFF_ROLE_ID,
    );

    if (hasStaffRole) {
      return true;
    }
  }

  if (STAFF_ROLE_ID && Array.isArray(member.roles) && member.roles.includes(STAFF_ROLE_ID)) {
    return true;
  }

  const discordId = getDiscordId(member);
  if (!discordId) {
    return false;
  }

  const [player] = await db
    .select({ isStaff: players.isStaff })
    .from(players)
    .where(eq(players.discordId, discordId))
    .limit(1);

  return player?.isStaff ?? false;
}

/**
 * Known permission strings for office-based access control.
 * Will be expanded as office system is built out.
 */
export type Permission =
  | 'legislative_leader'
  | 'appoint_ministers'
  | 'call_elections'
  | 'executive_orders'
  | 'veto'
  | 'bills.create'
  | 'bills.edit'
  | 'bills.delete'
  | 'voting.create'
  | 'voting.close'
  | 'players.edit'
  | 'offices.assign'
  | 'favours.grant'
  | 'moderation.warn'
  | 'moderation.ban'
  | 'simulation.advance'
  | 'tickets.manage';

const PERMISSION_ALIASES: Record<string, string[]> = {
  'bills.create': ['legislative_leader'],
  'voting.create': ['call_elections', 'legislative_leader'],
  'voting.close': ['call_elections', 'legislative_leader'],
  'offices.assign': ['appoint_ministers'],
};

/**
 * Check whether a guild member has a specific permission
 * based on their office(s) in the current season.
 *
 * Staff members bypass all permission checks.
 */
export async function hasPermission(
  member: InteractionMember,
  permission: Permission,
): Promise<boolean> {
  // Staff bypass — staff can do everything
  if (await isStaff(member)) {
    return true;
  }

  const discordId = getDiscordId(member);
  if (!discordId) {
    return false;
  }

  const [player] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, discordId))
    .limit(1);

  if (!player) {
    return false;
  }

  const permissionNames = new Set([permission, ...(PERMISSION_ALIASES[permission] ?? [])]);
  const rows = await db
    .select({ permissions: offices.permissions })
    .from(officeHolders)
    .innerJoin(offices, eq(officeHolders.officeId, offices.id))
    .where(and(eq(officeHolders.playerId, player.id), isNull(officeHolders.endDate)));

  return rows.some((row) =>
    Array.isArray(row.permissions) &&
    row.permissions.some((heldPermission) => permissionNames.has(heldPermission as Permission)),
  );
}

function getDiscordId(member: InteractionMember): string | null {
  if (!member) return null;
  if (member instanceof GuildMember) return member.user.id;

  const apiMember = member as APIInteractionGuildMember;
  return apiMember.user?.id ?? null;
}
