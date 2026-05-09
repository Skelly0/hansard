import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { asc, eq } from 'drizzle-orm';
import { ticketCategories } from '@hansard/db';
import { db } from '../../db.js';
import { createEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';
import { buildTicketCategoryFields } from './categoryHelpers.js';

const MAX_EMBED_FIELDS = 25;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-categories')
    .setDescription('List active ticket categories') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const categories = await db
      .select()
      .from(ticketCategories)
      .where(eq(ticketCategories.isActive, true))
      .orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.name));

    if (categories.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Ticket Categories',
            description: 'No ticket categories have been created yet. Staff can create one with `/ticket-category-create`.',
            system: 'tickets',
          }),
        ],
      });
      return;
    }

    const visibleCategories = categories.slice(0, MAX_EMBED_FIELDS);
    const hiddenCount = categories.length - visibleCategories.length;

    await interaction.editReply({
      embeds: [
        createEmbed({
          title: 'Ticket Categories',
          description: [
            `${categories.length} active categor${categories.length === 1 ? 'y' : 'ies'}.`,
            hiddenCount > 0 ? `Showing the first ${MAX_EMBED_FIELDS}; ${hiddenCount} more are configured.` : '',
          ].filter(Boolean).join('\n'),
          system: 'tickets',
          fields: buildTicketCategoryFields(visibleCategories),
        }),
      ],
    });
  },
};

export default command;
