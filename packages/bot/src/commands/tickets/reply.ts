import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import {
  tickets,
  ticketMessages,
  ticketAuditLog,
  players,
} from '@hansard/db';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

/**
 * /ticket-reply <number> <message>
 *
 * Append a public message to a ticket. Mirrors the logic of
 * `TicketService.addMessage` (POST /api/tickets/:id/messages) with
 * `isInternal: false`. Author resolved from invoking discord user.
 */

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-reply')
    .setDescription('Reply to a ticket with a public message')
    .addIntegerOption((opt) =>
      opt
        .setName('number')
        .setDescription('The ticket number')
        .setRequired(true)
        .setMinValue(1),
    )
    .addStringOption((opt) =>
      opt
        .setName('message')
        .setDescription('Your reply')
        .setRequired(true)
        .setMaxLength(2000),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

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

    // First-response tracking — set firstResponseAt if author is not creator
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

    // Insert message
    const [message] = await db
      .insert(ticketMessages)
      .values({
        ticketId: ticket.id,
        authorId: authorPlayer.id,
        content,
        isInternal: false,
      })
      .returning();

    // Audit log
    await db.insert(ticketAuditLog).values({
      ticketId: ticket.id,
      actorId: authorPlayer.id,
      action: 'commented',
      newValue: { messageId: message.id },
    });

    const authorName = authorPlayer.characterName ?? interaction.user.username;
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
  },
};

export default command;
