// ============================================================
// Permission Constants
// ============================================================

/**
 * Office-level permissions — these are stored in the `permissions` JSONB
 * array on the `offices` table. An office holder inherits all permissions
 * listed on their office.
 */
export const PERMISSIONS = {
  /** Can create legislative votes, schedule bills, manage legislature */
  LEGISLATIVE_LEADER: 'legislative_leader',
  /** Can appoint/remove holders of offices with filledBy='appointed' */
  APPOINT_MINISTERS: 'appoint_ministers',
  /** Can create position_election votes */
  CALL_ELECTIONS: 'call_elections',
  /** Can issue executive orders (future) */
  EXECUTIVE_ORDERS: 'executive_orders',
  /** Can veto passed legislation (future) */
  VETO: 'veto',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** All known permission strings as an array, useful for validation */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

// ============================================================
// Staff Role Helpers
// ============================================================

/** Staff roles used in the `staffRole` column on the players table */
export const StaffRole = {
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  GAME_MASTER: 'game_master',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

/**
 * Check whether a given staff role has at least the specified access level.
 * Hierarchy: admin > game_master > moderator
 */
export function hasStaffLevel(
  userRole: string | null | undefined,
  requiredRole: StaffRole,
): boolean {
  if (!userRole) return false;

  const hierarchy: Record<string, number> = {
    [StaffRole.MODERATOR]: 1,
    [StaffRole.GAME_MASTER]: 2,
    [StaffRole.ADMIN]: 3,
  };

  return (hierarchy[userRole] ?? 0) >= (hierarchy[requiredRole] ?? 0);
}

/**
 * Check whether a player holds an office that grants a specific permission.
 * Designed for use in permission middleware — pass in the player's
 * aggregated office permissions array.
 */
export function hasPermission(
  officePermissions: readonly string[],
  required: Permission,
): boolean {
  return officePermissions.includes(required);
}
