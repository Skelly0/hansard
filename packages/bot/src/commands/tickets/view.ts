import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { buildTicketActionRow } from '../../components/ticketButtons.js';
import type { Command } from '../../client.js';

/**
 * /ticket view <number>
 *
 * Shows a ticket embed with status, assignee, priority, and metadata.
 * In production this will query the API/DB. Currently stubbed with
 * a "not found" response until the DB layer is wired up.
 */

const STATUS_DISPLAY: Record<string, string> = {
  open: '\uD83D\uDD35 Open',
  in_progress: '\uD83D\uDFE1 In Progress',
  waiting: '\uD83D\uDFE0 Waiting',
  resolved: '\uD83D\uDFE2 Resolved',
  closed: '\u26AB Closed',
};

const PRIORITY_DISPLAY: Record<string, string> = {
  low: '\u2B07\uFE0F Low',
  normal: '\u2796 Normal',
  high: '\u2B06\uFE0F High',
  urgent: '\uD83D\uDD34 Urgent',
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-view')
    .setDescription('View a ticket by its number')
    .addIntegerOption((opt) =>
      opt
        .setName('number')
        .setDescription('The ticket number (e.g. 1042)')
        .setRequired(true)
        .setMinValue(1),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const ticketNumber = interaction.options.getInteger('number', true);

    await interaction.deferReply();

    // TODO: Replace with actual DB/API query
    // const ticket = await ticketService.getTicketByNumber(ticketNumber);

    // For now, demonstrate what the embed looks like with mock data
    // In production, this block is replaced by a real lookup.
    const ticket = null as any; // placeholder — will be a real query

    if (!ticket) {
      await interaction.editReply({
        embeds: [errorEmbed(`Ticket \`#${ticketNumber}\` not found.`)],
      });
      return;
    }

    const fields = [
      {
        name: 'Status',
        value: STATUS_DISPLAY[ticket.status] ?? ticket.status,
        inline: true,
      },
      {
        name: 'Priority',
        value: PRIORITY_DISPLAY[ticket.priority] ?? ticket.priority,
        inline: true,
      },
      {
        name: 'Category',
        value: ticket.category?.name ?? 'Unknown',
        inline: true,
      },
      {
        name: 'Created By',
        value: ticket.createdById ? `<@${ticket.createdById}>` : 'Unknown',
        inline: true,
      },
      {
        name: 'Assigned To',
        value: ticket.assignedToId ? `<@${ticket.assignedToId}>` : '*Unassigned*',
        inline: true,
      },
      {
        name: 'Created',
        value: `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:R>`,
        inline: true,
      },
    ];

    if (ticket.tags?.length) {
      fields.push({
        name: 'Tags',
        value: ticket.tags.map((t: string) => `\`${t}\``).join(', '),
        inline: false,
      });
    }

    if (ticket.discordThreadId) {
      fields.push({
        name: 'Thread',
        value: `<#${ticket.discordThreadId}>`,
        inline: true,
      });
    }

    const embed = createEmbed({
      title: `Ticket #${ticket.number}: ${ticket.title}`,
      description: ticket.description.length > 300
        ? ticket.description.slice(0, 300) + '...'
        : ticket.description,
      system: 'tickets',
      fields,
    });

    const actionRow = buildTicketActionRow(ticket.number);

    await interaction.editReply({
      embeds: [embed],
      components: [actionRow],
    });
  },
};

export default command;
