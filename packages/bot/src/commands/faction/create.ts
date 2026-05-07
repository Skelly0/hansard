import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { factions } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('faction-create')
    .setDescription('Create a new political faction (staff only)')
    .addStringOption((opt) =>
      opt.setName('name').setDescription('Full faction name').setRequired(true).setMaxLength(128),
    )
    .addStringOption((opt) =>
      opt.setName('short-name').setDescription('Short tag (e.g. "CRW")').setRequired(false).setMaxLength(16),
    )
    .addStringOption((opt) =>
      opt.setName('description').setDescription('Brief description').setRequired(false).setMaxLength(1024),
    )
    .addStringOption((opt) =>
      opt.setName('colour').setDescription('Hex colour, e.g. #b94a48').setRequired(false).setMaxLength(7),
    )
    .addRoleOption((opt) =>
      opt.setName('discord-role').setDescription('Discord role to map to this faction').setRequired(false),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }
    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can create factions.')] });
      return;
    }

    const name = interaction.options.getString('name', true).trim();
    const shortName = interaction.options.getString('short-name')?.trim() || null;
    const description = interaction.options.getString('description')?.trim() || null;
    const colour = interaction.options.getString('colour')?.trim() || null;
    const discordRole = interaction.options.getRole('discord-role');

    if (colour && !/^#[0-9a-fA-F]{6}$/.test(colour)) {
      await interaction.editReply({ embeds: [errorEmbed('Colour must be a 6-digit hex like `#b94a48`.')] });
      return;
    }

    try {
      const [faction] = await db
        .insert(factions)
        .values({
          name,
          shortName,
          description,
          colour,
          discordRoleId: discordRole?.id ?? null,
          isActive: true,
        })
        .returning();

      const lines = [
        `**${faction.name}**${faction.shortName ? ` (${faction.shortName})` : ''}`,
        faction.description ? `*${faction.description}*` : '',
        faction.colour ? `Colour: \`${faction.colour}\`` : '',
        faction.discordRoleId ? `Role: <@&${faction.discordRoleId}>` : '',
        `\nID: \`${faction.id}\``,
      ].filter(Boolean).join('\n');

      await interaction.editReply({ embeds: [successEmbed('Faction Founded', lines)] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create faction';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
