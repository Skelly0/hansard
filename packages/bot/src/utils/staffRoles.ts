import type { Guild } from 'discord.js';

const STAFF_ROLE_ENV = 'STAFF_ROLE_ID';
const STAFF_ROLES_ENV = 'STAFF_ROLE_IDS';
const STAFF_ROLE_NAME = 'Staff';

type RoleLike = { id: string; name: string };
type RoleCollectionLike = {
  find?: (predicate: (role: RoleLike) => boolean) => RoleLike | undefined;
  values?: () => IterableIterator<RoleLike>;
};

function uniqueRoleIds(roleIds: string[]): string[] {
  return [...new Set(roleIds.map((roleId) => roleId.trim()).filter(Boolean))];
}

function parseRoleIds(value: string | undefined): string[] {
  return uniqueRoleIds(value?.split(/[,\s]+/) ?? []);
}

function getConfiguredStaffRoleIds(): string[] {
  return uniqueRoleIds([
    ...parseRoleIds(process.env[STAFF_ROLES_ENV]),
    ...parseRoleIds(process.env[STAFF_ROLE_ENV]),
  ]);
}

function findStaffRoleId(roles: RoleCollectionLike | null | undefined): string | null {
  if (!roles) return null;
  const found = roles.find?.((role) => role.name === STAFF_ROLE_NAME);
  if (found) return found.id;
  for (const role of roles.values?.() ?? []) {
    if (role.name === STAFF_ROLE_NAME) return role.id;
  }
  return null;
}

/**
 * Resolve staff role IDs for a guild, in priority order:
 *   1. `STAFF_ROLE_IDS` env (comma- or whitespace-separated snowflakes)
 *   2. `STAFF_ROLE_ID` env (single snowflake)
 *   3. A guild role named "Staff" (case-sensitive)
 *
 * Returns an empty array if nothing matches. Callers should treat that as
 * "no staff role configured" and degrade gracefully rather than throw.
 */
export async function resolveStaffRoleIds(guild: Pick<Guild, 'roles'>): Promise<string[]> {
  const configuredRoleIds = getConfiguredStaffRoleIds();
  if (configuredRoleIds.length > 0) return configuredRoleIds;

  const cachedRoleId = findStaffRoleId(guild.roles.cache as RoleCollectionLike);
  if (cachedRoleId) return [cachedRoleId];

  try {
    const fetchedRoles = await guild.roles.fetch();
    const fetchedRoleId = findStaffRoleId(fetchedRoles as RoleCollectionLike);
    return fetchedRoleId ? [fetchedRoleId] : [];
  } catch (err) {
    console.error('Failed to resolve staff role:', err);
    return [];
  }
}
