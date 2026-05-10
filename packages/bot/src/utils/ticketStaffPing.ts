import type { Guild } from 'discord.js';

const STAFF_ROLE_ENV = 'STAFF_ROLE_ID';
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

function findStaffRoleId(roles: RoleCollectionLike | null | undefined): string | null {
  if (!roles) return null;

  const found = roles.find?.((role) => role.name === STAFF_ROLE_NAME);
  if (found) return found.id;

  for (const role of roles.values?.() ?? []) {
    if (role.name === STAFF_ROLE_NAME) return role.id;
  }

  return null;
}

async function resolveStaffRoleId(guild: Pick<Guild, 'roles'>): Promise<string | null> {
  const configuredRoleId = process.env[STAFF_ROLE_ENV]?.trim();
  if (configuredRoleId) return configuredRoleId;

  const cachedRoleId = findStaffRoleId(guild.roles.cache as RoleCollectionLike);
  if (cachedRoleId) return cachedRoleId;

  try {
    const fetchedRoles = await guild.roles.fetch();
    return findStaffRoleId(fetchedRoles as RoleCollectionLike);
  } catch (err) {
    console.error('Failed to resolve staff role for ticket ping:', err);
    return null;
  }
}

export async function sendTicketStaffPing(
  thread: TicketThreadLike,
  guild: Pick<Guild, 'roles'>,
  ticketNumber: number,
): Promise<void> {
  const staffRoleId = await resolveStaffRoleId(guild);
  if (!staffRoleId) return;

  try {
    await thread.send({
      allowedMentions: { roles: [staffRoleId] },
      content: `<@&${staffRoleId}> New ticket #${ticketNumber} is ready for staff review.`,
    });
  } catch (err) {
    console.error(`Failed to ping staff for ticket #${ticketNumber}:`, err);
  }
}
