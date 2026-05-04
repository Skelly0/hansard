import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq, asc } from 'drizzle-orm';
import { favourCategories } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('favour-category-edit')
    .setDescription('Edit an existing favour category (staff only)')
    .addStringOption((opt) =>
      opt.setName('category').setDescription('Category to edit (name match)').setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('name').setDescription('New display name').setRequired(false).setMaxLength(128),
    )
    .addStringOption((opt) =>
      opt.setName('short-name').setDescription('New short name (use "-" to clear)').setRequired(false).setMaxLength(32),
    )
    .addStringOption((opt) =>
      opt.setName('description').setDescription('New description (use "-" to clear)').setRequired(false).setMaxLength(2000),
    )
    .addStringOption((opt) =>
      opt.setName('emoji').setDescription('New emoji (use "-" to clear)').setRequired(false).setMaxLength(8),
    )
    .addStringOption((opt) =>
      opt.setName('colour').setDescription('New hex colour (use "-" to clear)').setRequired(false).setMaxLength(7),
    )
    .addStringOption((opt) =>
      opt.setName('spendable-on').setDescription('Comma-separated list (use "-" to clear)').setRequired(false).setMaxLength(512),
    )
    .addIntegerOption((opt) =>
      opt.setName('sort-order').setDescription('New sort order').setRequired(false).setMinValue(0),
    )
    .addBooleanOption((opt) =>
      opt.setName('active').setDescription('Set active state').setRequired(false),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }
    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can edit favour categories.')] });
      return;
    }

    const query = interaction.options.getString('category', true);
    const all = await db.select().from(favourCategories).orderBy(asc(favourCategories.sortOrder));
    const target =
      all.find((c) => c.name.toLowerCase() === query.toLowerCase()) ??
      all.find((c) => c.name.toLowerCase().includes(query.toLowerCase()));

    if (!target) {
      await interaction.editReply({ embeds: [errorEmbed(`No favour category matching "${query}" found.`)] });
      return;
    }

    const clearable = (raw: string | null): string | null | undefined => {
      if (raw === null) return undefined;
      return raw.trim() === '-' ? null : raw.trim();
    };

    const updates: Record<string, unknown> = {};
    const name = interaction.options.getString('name');
    if (name) updates.name = name.trim();

    const shortName = clearable(interaction.options.getString('short-name'));
    if (shortName !== undefined) updates.shortName = shortName;

    const description = clearable(interaction.options.getString('description'));
    if (description !== undefined) updates.description = description;

    const emoji = clearable(interaction.options.getString('emoji'));
    if (emoji !== undefined) updates.emoji = emoji;

    const colour = clearable(interaction.options.getString('colour'));
    if (colour !== undefined) {
      if (colour !== null && !/^#[0-9a-fA-F]{6}$/.test(colour)) {
        await interaction.editReply({ embeds: [errorEmbed('Colour must be a 6-digit hex code like `#b94a48`, or `-` to clear.')] });
        return;
      }
      updates.colour = colour;
    }

    const spendableRaw = clearable(interaction.options.getString('spendable-on'));
    if (spendableRaw !== undefined) {
      updates.spendableOn = spendableRaw === null
        ? null
        : spendableRaw.split(',').map((s) => s.trim()).filter(Boolean);
    }

    const sortOrder = interaction.options.getInteger('sort-order');
    if (sortOrder !== null) updates.sortOrder = sortOrder;

    const active = interaction.options.getBoolean('active');
    if (active !== null) updates.isActive = active;

    if (Object.keys(updates).length === 0) {
      await interaction.editReply({ embeds: [errorEmbed('No fields to update. Provide at least one option.')] });
      return;
    }

    try {
      const [updated] = await db
        .update(favourCategories)
        .set(updates)
        .where(eq(favourCategories.id, target.id))
        .returning();

      const changed = Object.keys(updates).join(', ');
      await interaction.editReply({
        embeds: [successEmbed(
          'Favour Category Updated',
          `${updated.emoji ? `${updated.emoji} ` : ''}**${updated.name}**\nFields changed: \`${changed}\``,
        )],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update category';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
