import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { players } from '@hansard/db';
import { TicketService } from '@hansard/api/services/ticketService';
import { createEmbed, successEmbed, errorEmbed } from '../../utils/embeds.js';
import { getTicketViewer } from '../../utils/ticketAccess.js';
import { db } from '../../db.js';

/**
 * /ticket reply <number> <message>
 *
 * Append a public message to a ticket. Mirrors the logic of
 * `TicketService.addMessage` (POST /api/tickets/:id/messages) with
 * `isInternal: false`. Author resolved from invoking discord user.
 */

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

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

  const { viewer, isStaff } = await getTicketViewer(interaction);
  const ticket = viewer
    ? await new TicketService(db).getTicketByNumber(ticketNumber, viewer)
    : null;

  if (!ticket) {
    await interaction.editReply({
      embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` not found or you do not have access.`)],
    });
    return;
  }

  const message = await new TicketService(db).addMessage(
    ticket.id,
    content,
    authorPlayer.id,
    false,
    undefined,
    isStaff,
  );
  if (!message) {
    await interaction.editReply({
      embeds: [errorEmbed('Could not post this reply.')],
    });
    return;
  }

  const authorName = authorPlayer.characterName ?? interaction.user.username;
  await notifyTicketOwner({
    ticket,
    content,
    authorName,
    authorPlayerId: authorPlayer.id,
    interaction,
  });

  await interaction.editReply({
    embeds: [
      successEmbed(
        `Reply posted to #${ticketNumber}`,
        [
          `**From:** ${authorName}`,
          '',
          content,
        ].join('\n'),
      ),
    ],
  });
}

async function notifyTicketOwner({
  ticket,
  content,
  authorName,
  authorPlayerId,
  interaction,
}: {
  ticket: {
    number: number;
    title: string;
    createdById: string;
  };
  content: string;
  authorName: string;
  authorPlayerId: string;
  interaction: ChatInputCommandInteraction;
}): Promise<void> {
  if (ticket.createdById === authorPlayerId) {
    return;
  }

  try {
    const [owner] = await db
      .select()
      .from(players)
      .where(eq(players.id, ticket.createdById))
      .limit(1);

    if (!owner?.discordId || owner.discordId === interaction.user.id) {
      return;
    }

    const ownerUser = await interaction.client.users.fetch(owner.discordId);
    await ownerUser.send({
      embeds: [
        createEmbed({
          title: `Ticket #${ticket.number}: New Reply`,
          description: [
            `**Ticket:** ${ticket.title}`,
            `**From:** ${authorName}`,
            '',
            content,
          ].join('\n'),
          system: 'tickets',
        }),
      ],
    });
  } catch (err) {
    console.error(`Failed to notify owner for ticket #${ticket.number}:`, err);
  }
}
