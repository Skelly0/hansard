import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { ticketCategories } from '@hansard/db';
import { db } from '../../db.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import {
  buildTicketCategoryCreatedDescription,
  normalizeTicketCategoryInput,
} from './categoryHelpers.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket-category-create')
    .setDescription('Create a ticket category (staff only)')
    .addStringOption((opt) =>
      opt
        .setName('name')
        .setDescription('Display name, e.g. Appeals')
        .setRequired(true)
        .setMaxLength(64),
    )
    .addStringOption((opt) =>
      opt
        .setName('description')
        .setDescription('What this category is for')
        .setRequired(false)
        .setMaxLength(2000),
    )
    .addStringOption((opt) =>
      opt
        .setName('emoji')
        .setDescription('Emoji used in embeds and menus')
        .setRequired(false)
        .setMaxLength(8),
    )
    .addStringOption((opt) =>
      opt
        .setName('colour')
        .setDescription('Hex colour for UI, e.g. #7B8BA8')
        .setRequired(false)
        .setMaxLength(7),
    )
    .addStringOption((opt) =>
      opt
        .setName('assignable-roles')
        .setDescription('Comma-separated staff role names for this category')
        .setRequired(false)
        .setMaxLength(512),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('sort-order')
        .setDescription('Display order; lower appears first')
        .setRequired(false)
        .setMinValue(0),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.guild) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can create ticket categories.')] });
      return;
    }

    let values;
    try {
      values = normalizeTicketCategoryInput({
        name: interaction.options.getString('name', true),
        description: interaction.options.getString('description'),
        emoji: interaction.options.getString('emoji'),
        colour: interaction.options.getString('colour'),
        assignableRoles: interaction.options.getString('assignable-roles'),
        sortOrder: interaction.options.getInteger('sort-order'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid category options.';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
      return;
    }

    try {
      const [category] = await db
        .insert(ticketCategories)
        .values(values)
        .returning();

      await interaction.editReply({
        embeds: [
          successEmbed(
            'Ticket Category Created',
            buildTicketCategoryCreatedDescription(category),
          ),
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create ticket category.';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
