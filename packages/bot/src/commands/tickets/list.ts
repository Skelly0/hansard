import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, inArray } from 'drizzle-orm';
import { players } from '@hansard/db';
import { TicketService } from '@hansard/api/services/ticketService';
import { createEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import { formatTicketPlayer, getTicketViewer } from '../../utils/ticketAccess.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

/**
 * /ticket list [status] [assignee]
 *
 * Paginated list of tickets with optional filters.
 * Displays 10 tickets per page in a compact format.
 */

const STATUS_EMOJI: Record<string, string> = {
  open: '\uD83D\uDD35',
  in_progress: '\uD83D\uDFE1',
  waiting: '\uD83D\uDFE0',
  resolved: '\uD83D\uDFE2',
  closed: '\u26AB',
};

const PRIORITY_EMOJI: Record<string, string> = {
  low: '\u2B07\uFE0F',
  normal: '',
  high: '\u2B06\uFE0F',
  urgent: '\uD83D\uDD34',
};

const TICKETS_PER_PAGE = 10;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-list')
    .setDescription('List tickets with optional filters')
    .addStringOption((opt) =>
      opt
        .setName('status')
        .setDescription('Filter by status')
        .setRequired(false)
        .addChoices(
          { name: 'Open', value: 'open' },
          { name: 'In Progress', value: 'in_progress' },
          { name: 'Waiting', value: 'waiting' },
          { name: 'Resolved', value: 'resolved' },
          { name: 'Closed', value: 'closed' },
        ),
    )
    .addUserOption((opt) =>
      opt
        .setName('assignee')
        .setDescription('Filter by assigned staff member')
        .setRequired(false),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const statusFilter = interaction.options.getString('status');
    const assigneeUser = interaction.options.getUser('assignee');

    await interaction.deferReply({ ephemeral: true });

    const { viewer } = await getTicketViewer(interaction);
    if (!viewer) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'No Tickets Found',
            description: 'You do not have access to any tickets yet.',
            system: 'tickets',
          }),
        ],
      });
      return;
    }

    const filters: {
      status?: any;
      assignedToId?: string;
      limit: number;
    } = { limit: 100 };

    if (statusFilter) {
      filters.status = statusFilter;
    }
    if (assigneeUser) {
      const [assigneePlayer] = await db
        .select({ id: players.id })
        .from(players)
        .where(eq(players.discordId, assigneeUser.id))
        .limit(1);

      if (!assigneePlayer) {
        filters.assignedToId = '00000000-0000-0000-0000-000000000000';
      } else {
        filters.assignedToId = assigneePlayer.id;
      }
    }

    const result = await new TicketService(db).listTickets(filters, viewer);
    const ticketList = result.tickets;
    const total = result.total;

    if (ticketList.length === 0) {
      const filterDesc = [];
      if (statusFilter) filterDesc.push(`status: **${statusFilter}**`);
      if (assigneeUser) filterDesc.push(`assignee: ${assigneeUser}`);

      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'No Tickets Found',
            description: filterDesc.length
              ? `No tickets match your filters (${filterDesc.join(', ')}).`
              : 'There are no tickets yet.',
            system: 'tickets',
          }),
        ],
      });
      return;
    }

    const assigneeIds = [
      ...new Set(ticketList.map((ticket: any) => ticket.assignedToId).filter(Boolean) as string[]),
    ];
    const assigneeRows = assigneeIds.length
      ? await db
        .select({
          id: players.id,
          discordId: players.discordId,
          characterName: players.characterName,
          discordUsername: players.discordUsername,
        })
        .from(players)
        .where(inArray(players.id, assigneeIds))
      : [];
    const assigneesById = new Map(assigneeRows.map((player) => [player.id, player]));

    // Build pages
    const pages = [];
    for (let i = 0; i < ticketList.length; i += TICKETS_PER_PAGE) {
      const chunk = ticketList.slice(i, i + TICKETS_PER_PAGE);

      const lines = chunk.map((ticket: any) => {
        const statusIcon = STATUS_EMOJI[ticket.status] ?? '';
        const priorityIcon = PRIORITY_EMOJI[ticket.priority] ?? '';
        const assignee = ticket.assignedToId
          ? formatTicketPlayer(assigneesById.get(ticket.assignedToId), '*unassigned*')
          : '*unassigned*';
        const age = `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:R>`;

        return [
          `${statusIcon} **#${ticket.number}** ${ticket.title}`,
          `  ${priorityIcon} ${assignee} \u2022 ${age}`,
        ].join('\n');
      });

      const filterParts = [];
      if (statusFilter) filterParts.push(`Status: ${statusFilter}`);
      if (assigneeUser) filterParts.push(`Assignee: ${assigneeUser.displayName}`);

      pages.push(
        createEmbed({
          title: 'Tickets',
          description: [
            filterParts.length ? `*Filters: ${filterParts.join(', ')}*` : '',
            `Showing ${i + 1}-${Math.min(i + TICKETS_PER_PAGE, total)} of ${total}`,
            '',
            ...lines,
          ]
            .filter((l) => l !== undefined)
            .join('\n'),
          system: 'tickets',
        }),
      );
    }

    await createPaginatedEmbed({
      interaction,
      pages,
    });
  },
};

export default command;
