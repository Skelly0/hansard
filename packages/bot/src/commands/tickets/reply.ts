import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { players } from '@hansard/db';
import { TicketService } from '@hansard/api/services/ticketService';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { getTicketViewer } from '../../utils/ticketAccess.js';
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
