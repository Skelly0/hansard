import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { favourCategories } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('favour-category-create')
    .setDescription('Create a new favour category / Group of Interest (staff only)')
    .addStringOption((opt) =>
      opt.setName('name').setDescription('Display name (e.g. "Military Establishment")').setRequired(true).setMaxLength(128),
    )
    .addStringOption((opt) =>
      opt.setName('short-name').setDescription('Short name shown in tags (e.g. "Military")').setRequired(false).setMaxLength(32),
    )
    .addStringOption((opt) =>
      opt.setName('description').setDescription('What this group represents').setRequired(false).setMaxLength(2000),
    )
    .addStringOption((opt) =>
      opt.setName('emoji').setDescription('Emoji used in embeds (single character or :name:)').setRequired(false).setMaxLength(8),
    )
    .addStringOption((opt) =>
      opt.setName('colour').setDescription('Hex colour for UI (e.g. #b94a48)').setRequired(false).setMaxLength(7),
    )
    .addStringOption((opt) =>
      opt.setName('spendable-on').setDescription('Comma-separated list (e.g. "military appointments, intelligence")').setRequired(false).setMaxLength(512),
    )
    .addIntegerOption((opt) =>
      opt.setName('sort-order').setDescription('Display order (lower = first)').setRequired(false).setMinValue(0),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }
    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can create favour categories.')] });
      return;
    }

    const name = interaction.options.getString('name', true).trim();
    const shortName = interaction.options.getString('short-name')?.trim() || null;
    const description = interaction.options.getString('description')?.trim() || null;
    const emoji = interaction.options.getString('emoji')?.trim() || null;
    const colour = interaction.options.getString('colour')?.trim() || null;
    const spendableRaw = interaction.options.getString('spendable-on')?.trim() || null;
    const sortOrder = interaction.options.getInteger('sort-order') ?? 0;

    if (colour && !/^#[0-9a-fA-F]{6}$/.test(colour)) {
      await interaction.editReply({ embeds: [errorEmbed('Colour must be a 6-digit hex code like `#b94a48`.')] });
      return;
    }

    const spendableOn = spendableRaw
      ? spendableRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : null;

    try {
      const [category] = await db
        .insert(favourCategories)
        .values({
          name,
          shortName,
          description,
          emoji,
          colour,
          spendableOn,
          sortOrder,
          isActive: true,
        })
        .returning();

      const lines = [
        `${category.emoji ? `${category.emoji} ` : ''}**${category.name}**${category.shortName ? ` (${category.shortName})` : ''}`,
        category.description ? `*${category.description}*` : '',
        spendableOn && spendableOn.length > 0 ? `**Spendable on:** ${spendableOn.join(', ')}` : '',
        `**Sort order:** ${sortOrder}`,
        `\nID: \`${category.id}\``,
      ].filter(Boolean).join('\n');

      await interaction.editReply({ embeds: [successEmbed('Favour Category Created', lines)] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create category';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
