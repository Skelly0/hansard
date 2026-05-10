import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, desc, and, type SQL } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { createPaginatedEmbed } from '../../utils/pagination.js';
import type { Command } from '../../client.js';
import { formatBillStatus, statusEmoji } from './shared.js';

const RESULTS_PER_PAGE = 8;

const STATUS_CHOICES = [
  { name: 'Submitted', value: 'submitted' },
  { name: 'Voting', value: 'voting' },
  { name: 'Player Passed', value: 'player_passed' },
  { name: 'Player Rejected', value: 'player_rejected' },
  { name: 'NPC Pending', value: 'npc_pending' },
  { name: 'NPC Passed', value: 'npc_passed' },
  { name: 'NPC Rejected', value: 'npc_rejected' },
  { name: 'Enacted', value: 'enacted' },
  { name: 'Active', value: 'active' },
  { name: 'Amended', value: 'amended' },
  { name: 'Repealed', value: 'repealed' },
];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bill-list')
    .setDescription('Browse bills with optional filters')
    .addStringOption((opt) =>
      opt
        .setName('status')
        .setDescription('Filter by status')
        .setRequired(false)
        .addChoices(...STATUS_CHOICES),
    )
    .addUserOption((opt) =>
      opt
        .setName('author')
        .setDescription('Filter by author')
        .setRequired(false),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const statusFilter = interaction.options.getString('status');
    const authorUser = interaction.options.getUser('author');

    const conditions: SQL[] = [];

    if (statusFilter) {
      conditions.push(eq(bills.status, statusFilter));
    }

    if (authorUser) {
      // Look up player ID from Discord ID
      const [player] = await db
        .select({ id: players.id })
        .from(players)
        .where(eq(players.discordId, authorUser.id))
        .limit(1);

      if (!player) {
        await interaction.editReply({
          embeds: [errorEmbed(`**${authorUser.displayName}** doesn't have a character.`)],
        });
        return;
      }

      conditions.push(eq(bills.authorId, player.id));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await db
      .select({
        id: bills.id,
        billNumber: bills.billNumber,
        title: bills.title,
        status: bills.status,
        submittedAt: bills.submittedAt,
      })
      .from(bills)
      .where(whereClause)
      .orderBy(desc(bills.submittedAt))
      .limit(50);

    if (results.length === 0) {
      const filterDesc = [
        statusFilter ? `status: **${formatBillStatus(statusFilter)}**` : null,
        authorUser ? `author: **${authorUser.displayName}**` : null,
      ]
        .filter(Boolean)
        .join(', ');

      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Bills',
            description: filterDesc
              ? `No bills found with ${filterDesc}.`
              : 'No bills have been submitted yet.',
            system: 'bills',
          }),
        ],
      });
      return;
    }

    // Build paginated embeds
    const pages: EmbedBuilder[] = [];
    for (let i = 0; i < results.length; i += RESULTS_PER_PAGE) {
      const chunk = results.slice(i, i + RESULTS_PER_PAGE);

      const lines = chunk.map((bill) => {
        const status = formatBillStatus(bill.status);
        const emoji = statusEmoji(bill.status);
        return `**#${bill.billNumber}** ${emoji} ${bill.title}\n\u2003\u2003${status} \u2014 <t:${Math.floor(bill.submittedAt.getTime() / 1000)}:R>`;
      });

      const filterParts = [
        statusFilter ? `Status: ${formatBillStatus(statusFilter)}` : null,
        authorUser ? `Author: ${authorUser.displayName}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      pages.push(
        createEmbed({
          title: 'Bills',
          description: [
            filterParts ? `*${filterParts}*` : null,
            `Showing **${results.length}** bill${results.length !== 1 ? 's' : ''}.\n`,
            ...lines,
          ]
            .filter((l) => l !== null)
            .join('\n'),
          system: 'bills',
        }),
      );
    }

    await createPaginatedEmbed({ interaction, pages });
  },
};

export default command;
