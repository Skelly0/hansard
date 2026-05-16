import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import {
  tickets,
  ticketMessages,
  ticketAuditLog,
  players,
} from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import { postToTicketThread } from '@hansard/api/services/ticketThreadNotifier';

/**
 * /ticket note <number> <message>
 *
 * Add a staff-only internal note to a ticket. Mirrors
 * `TicketService.addMessage` with `isInternal: true`.
 */

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member;
  if (!member || !('roles' in member) || !(await isStaff(member as any))) {
    await interaction.editReply({
      embeds: [errorEmbed('Only staff can add internal notes.')],
    });
    return;
  }

  const ticketNumber = interaction.options.getInteger('number', true);
  const content = interaction.options.getString('message', true);

  // Resolve invoker -> player
  const [authorPlayer] = await db
    .select()
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  if (!authorPlayer) {
    await interaction.editReply({
      embeds: [errorEmbed('You are not registered as a player.')],
    });
    return;
  }

  // Look up ticket by number
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.number, ticketNumber))
    .limit(1);

  if (!ticket) {
    await interaction.editReply({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` not found.`)],
    });
    return;
  }

  // Touch updatedAt; firstResponseAt logic intentionally mirrored
  const now = new Date();
  if (!ticket.firstResponseAt && authorPlayer.id !== ticket.createdById) {
    await db
      .update(tickets)
      .set({ firstResponseAt: now, updatedAt: now })
      .where(eq(tickets.id, ticket.id));
  } else {
    await db
      .update(tickets)
      .set({ updatedAt: now })
      .where(eq(tickets.id, ticket.id));
  }

  // Insert internal message
  const [message] = await db
    .insert(ticketMessages)
    .values({
      ticketId: ticket.id,
      authorId: authorPlayer.id,
      content,
      isInternal: true,
    })
    .returning();

  // Audit log
  await db.insert(ticketAuditLog).values({
    ticketId: ticket.id,
    actorId: authorPlayer.id,
    action: 'internal_note',
    newValue: { messageId: message.id },
  });

  const authorName =
    authorPlayer.characterName || authorPlayer.discordUsername || interaction.user.username;
  await postToTicketThread({
    threadId: ticket.discordThreadId,
    content: `🔒 **${authorName}** (internal note):\n${content}`,
  });

  await interaction.editReply({
    embeds: [
      createEmbed({
        title: `Internal note added to #${ticketNumber}`,
        description: content,
        system: 'tickets',
      }),
    ],
  });
}
