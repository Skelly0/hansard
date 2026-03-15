import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

/**
 * /ticket assign <number> <user>
 *
 * Assigns a ticket to a staff member. Staff-only command.
 * Updates the ticket status to "in_progress" if currently "open".
 */

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-assign')
    .setDescription('Assign a ticket to a staff member')
    .addIntegerOption((opt) =>
      opt
        .setName('number')
        .setDescription('The ticket number')
        .setRequired(true)
        .setMinValue(1),
    )
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('The staff member to assign')
        .setRequired(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Staff check
    const member = interaction.member;
    if (!member || !(await isStaff(member as any))) {
      await interaction.reply({
        embeds: [errorEmbed('Only staff members can assign tickets.')],
        ephemeral: true,
      });
      return;
    }

    const ticketNumber = interaction.options.getInteger('number', true);
    const assignee = interaction.options.getUser('user', true);

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

    // TODO: Actually assign via service
    // await ticketService.assignTicket(ticket.id, assigneeDbId, actorDbId);

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Ticket Assigned',
          [
            `**Ticket:** #${ticketNumber}`,
            `**Assigned to:** ${assignee}`,
            `**By:** ${interaction.user}`,
          ].join('\n'),
        ),
      ],
    });

    // Notify in the ticket thread if one exists
    if (ticket?.discordThreadId && interaction.guild) {
      try {
        const thread = await interaction.guild.channels.fetch(ticket.discordThreadId);
        if (thread?.isTextBased()) {
          await (thread as any).send({
            content: `\uD83D\uDCCB Ticket assigned to ${assignee} by ${interaction.user}.`,
          });
          // Add the assignee to the thread
          if ('members' in thread) {
            await (thread as any).members.add(assignee.id);
          }
        }
      } catch {
        // Thread notification failed — not critical
      }
    }
  },
};

export default command;
