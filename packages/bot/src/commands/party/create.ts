import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { parties } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('party-create')
    .setDescription('Create a new political party (staff only)')
    .addStringOption((opt) =>
      opt.setName('name').setDescription('Full party name').setRequired(true).setMaxLength(128),
    )
    .addStringOption((opt) =>
      opt.setName('short-name').setDescription('Short tag (e.g. "LDP")').setRequired(false).setMaxLength(16),
    )
    .addStringOption((opt) =>
      opt.setName('ideology').setDescription('Brief ideology summary').setRequired(false).setMaxLength(256),
    )
    .addStringOption((opt) =>
      opt.setName('colour').setDescription('Hex colour, e.g. #b94a48').setRequired(false).setMaxLength(7),
    )
    .addStringOption((opt) =>
      opt.setName('faction-id').setDescription('Optional faction UUID this party belongs to').setRequired(false),
    )
    .addRoleOption((opt) =>
      opt.setName('discord-role').setDescription('Discord role to map to this party').setRequired(false),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }
    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can create parties.')] });
      return;
    }

    const name = interaction.options.getString('name', true).trim();
    const shortName = interaction.options.getString('short-name')?.trim() || null;
    const ideology = interaction.options.getString('ideology')?.trim() || null;
    const colour = interaction.options.getString('colour')?.trim() || null;
    const factionId = interaction.options.getString('faction-id')?.trim() || null;
    const discordRole = interaction.options.getRole('discord-role');

    if (colour && !/^#[0-9a-fA-F]{6}$/.test(colour)) {
      await interaction.editReply({ embeds: [errorEmbed('Colour must be a 6-digit hex like `#b94a48`.')] });
      return;
    }

    try {
      const [party] = await db
        .insert(parties)
        .values({
          name,
          shortName,
          ideology,
          colour,
          factionId,
          discordRoleId: discordRole?.id ?? null,
          isActive: true,
        })
        .returning();

      const lines = [
        `**${party.name}**${party.shortName ? ` (${party.shortName})` : ''}`,
        party.ideology ? `*${party.ideology}*` : '',
        party.colour ? `Colour: \`${party.colour}\`` : '',
        party.discordRoleId ? `Role: <@&${party.discordRoleId}>` : '',
        `\nID: \`${party.id}\``,
      ].filter(Boolean).join('\n');

      await interaction.editReply({ embeds: [successEmbed('Party Founded', lines)] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create party';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
