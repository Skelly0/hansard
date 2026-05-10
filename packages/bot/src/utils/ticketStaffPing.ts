import type { Guild } from 'discord.js';

const STAFF_ROLE_ENV = 'STAFF_ROLE_ID';
const STAFF_ROLES_ENV = 'STAFF_ROLE_IDS';
const STAFF_ROLE_NAME = 'Staff';

type RoleLike = {
  id: string;
  name: string;
};

type RoleCollectionLike = {
  find?: (predicate: (role: RoleLike) => boolean) => RoleLike | undefined;
  values?: () => IterableIterator<RoleLike>;
};

type TicketThreadLike = {
  send: (options: {
    allowedMentions: { roles: string[] };
    content: string;
  }) => Promise<unknown>;
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

async function resolveStaffRoleIds(guild: Pick<Guild, 'roles'>): Promise<string[]> {
  const configuredRoleIds = getConfiguredStaffRoleIds();
  if (configuredRoleIds.length > 0) return configuredRoleIds;

  const cachedRoleId = findStaffRoleId(guild.roles.cache as RoleCollectionLike);
  if (cachedRoleId) return [cachedRoleId];

  try {
    const fetchedRoles = await guild.roles.fetch();
    const fetchedRoleId = findStaffRoleId(fetchedRoles as RoleCollectionLike);
    return fetchedRoleId ? [fetchedRoleId] : [];
  } catch (err) {
    console.error('Failed to resolve staff role for ticket ping:', err);
    return [];
  }
}

export async function sendTicketStaffPing(
  thread: TicketThreadLike,
  guild: Pick<Guild, 'roles'>,
  ticketNumber: number,
): Promise<void> {
  const staffRoleIds = await resolveStaffRoleIds(guild);
  if (staffRoleIds.length === 0) return;

  const mentions = staffRoleIds.map((staffRoleId) => `<@&${staffRoleId}>`).join(' ');

  try {
    await thread.send({
      allowedMentions: { roles: staffRoleIds },
      content: `${mentions} New ticket #${ticketNumber} is ready for staff review.`,
    });
  } catch (err) {
    console.error(`Failed to ping staff for ticket #${ticketNumber}:`, err);
  }
}
