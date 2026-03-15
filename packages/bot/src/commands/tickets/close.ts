import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { successEmbed, errorEmbed, createEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

/**
 * /ticket close <number> [reason]
 *
 * Closes a ticket with an optional resolution note.
 * The ticket creator or any staff member can close a ticket.
 */

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-close')
    .setDescription('Close a ticket')
    .addIntegerOption((opt) =>
      opt
        .setName('number')
        .setDescription('The ticket number')
        .setRequired(true)
        .setMinValue(1),
    )
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Resolution note')
        .setRequired(false)
        .setMaxLength(1000),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const ticketNumber = interaction.options.getInteger('number', true);
    const reason = interaction.options.getString('reason');

    await interaction.deferReply();

    // TODO: Replace with actual DB/API call
    // const ticket = await ticketService.getTicketByNumber(ticketNumber);
    const ticket = null as any;

    if (!ticket) {
      await interaction.editReply({
        embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` not found.`)],
      });
      return;
    }

    if (ticket.status === 'closed') {
      await interaction.editReply({
        embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` is already closed.`)],
      });
      return;
    }

    // TODO: Permission check — only creator or staff can close
    // TODO: Actually close via service
    // await ticketService.closeTicket(ticket.id, reason, actorDbId);

    const description = [
      `**Ticket:** #${ticketNumber} — ${ticket.title}`,
      `**Closed by:** ${interaction.user}`,
    ];

    if (reason) {
      description.push(`**Resolution:** ${reason}`);
    }

    await interaction.editReply({
      embeds: [successEmbed('Ticket Closed', description.join('\n'))],
    });

    // Notify and archive the thread
    if (ticket?.discordThreadId && interaction.guild) {
      try {
        const thread = await interaction.guild.channels.fetch(ticket.discordThreadId);
        if (thread?.isTextBased()) {
          const closeEmbed = createEmbed({
            title: `Ticket #${ticketNumber} Closed`,
            description: reason
              ? `**Resolution:** ${reason}`
              : 'This ticket has been closed.',
            system: 'tickets',
          });

          await (thread as any).send({ embeds: [closeEmbed] });

          // Archive the thread
          if ('setArchived' in thread) {
            await (thread as any).setArchived(true, `Ticket #${ticketNumber} closed`);
          }
        }
      } catch {
        // Thread operations failed — not critical
      }
    }
  },
};

export default command;
