import type { Guild } from 'discord.js';
import { resolveStaffRoleIds } from './staffRoles.js';

type TicketThreadLike = {
  send: (options: {
    allowedMentions: { roles: string[] };
    content: string;
  }) => Promise<unknown>;
};

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
