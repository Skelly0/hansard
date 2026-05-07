import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq, asc } from 'drizzle-orm';
import { factions } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('faction-edit')
    .setDescription('Edit an existing faction (staff only)')
    .addStringOption((opt) =>
      opt.setName('faction').setDescription('Faction to edit (name match)').setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('name').setDescription('New full name').setRequired(false).setMaxLength(128),
    )
    .addStringOption((opt) =>
      opt.setName('short-name').setDescription('New short tag (use "-" to clear)').setRequired(false).setMaxLength(16),
    )
    .addStringOption((opt) =>
      opt.setName('description').setDescription('New description (use "-" to clear)').setRequired(false).setMaxLength(1024),
    )
    .addStringOption((opt) =>
      opt.setName('colour').setDescription('New hex colour (use "-" to clear)').setRequired(false).setMaxLength(7),
    )
    .addRoleOption((opt) =>
      opt.setName('discord-role').setDescription('New Discord role (omit + role-clear:true to remove)').setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt.setName('role-clear').setDescription('Clear the mapped Discord role').setRequired(false),
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
      await interaction.editReply({ embeds: [errorEmbed('Only staff can edit factions.')] });
      return;
    }

    const query = interaction.options.getString('faction', true);
    const all = await db.select().from(factions).orderBy(asc(factions.name));
    const target =
      all.find((f) => f.name.toLowerCase() === query.toLowerCase()) ??
      all.find((f) => f.shortName?.toLowerCase() === query.toLowerCase()) ??
      all.find((f) => f.name.toLowerCase().includes(query.toLowerCase()));

    if (!target) {
      await interaction.editReply({ embeds: [errorEmbed(`No faction matching "${query}" found.`)] });
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

    const colour = clearable(interaction.options.getString('colour'));
    if (colour !== undefined) {
      if (colour !== null && !/^#[0-9a-fA-F]{6}$/.test(colour)) {
        await interaction.editReply({ embeds: [errorEmbed('Colour must be a 6-digit hex code like `#b94a48`, or `-` to clear.')] });
        return;
      }
      updates.colour = colour;
    }

    const discordRole = interaction.options.getRole('discord-role');
    const roleClear = interaction.options.getBoolean('role-clear');
    if (discordRole) updates.discordRoleId = discordRole.id;
    else if (roleClear) updates.discordRoleId = null;

    const active = interaction.options.getBoolean('active');
    if (active !== null) updates.isActive = active;

    if (Object.keys(updates).length === 0) {
      await interaction.editReply({ embeds: [errorEmbed('No fields to update. Provide at least one option.')] });
      return;
    }

    try {
      const [updated] = await db
        .update(factions)
        .set(updates)
        .where(eq(factions.id, target.id))
        .returning();

      const changed = Object.keys(updates).join(', ');
      await interaction.editReply({
        embeds: [successEmbed(
          'Faction Updated',
          `**${updated.name}**\nFields changed: \`${changed}\``,
        )],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update faction';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
