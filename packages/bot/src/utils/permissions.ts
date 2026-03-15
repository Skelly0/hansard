import type { GuildMember } from 'discord.js';

/**
 * Staff role name — checked against member roles.
 * This will be configurable via DB/env in the future.
 */
const STAFF_ROLE_NAME = 'Staff';

/**
 * Check whether a guild member is staff.
 *
 * Currently checks:
 * 1. Whether the member has a role named "Staff"
 * 2. (Future) Whether the member has `isStaff` set in the DB
 *
 * Returns true if either condition is met.
 */
export async function isStaff(member: GuildMember): Promise<boolean> {
  // Role-based check
  const hasStaffRole = member.roles.cache.some(
    (role) => role.name === STAFF_ROLE_NAME,
  );

  if (hasStaffRole) {
    return true;
  }

  // DB-based check — will query player record once DB integration is wired up.
  // For now, returns false if the role check didn't match.
  // TODO: Query @hansard/db for player.isStaff flag
  return false;
}

/**
 * Known permission strings for office-based access control.
 * Will be expanded as office system is built out.
 */
export type Permission =
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

/**
 * Check whether a guild member has a specific permission
 * based on their office(s) in the current season.
 *
 * Currently a stub — will query the DB for the member's offices
 * and check their associated permissions.
 *
 * Staff members bypass all permission checks.
 */
export async function hasPermission(
  member: GuildMember,
  permission: Permission,
): Promise<boolean> {
  // Staff bypass — staff can do everything
  if (await isStaff(member)) {
    return true;
  }

  // Office-based permission check — will be implemented when the
  // offices and permissions tables are wired up.
  // TODO: Query @hansard/db for member's offices -> office.permissions
  void permission; // suppress unused warning until implemented
  return false;
}
