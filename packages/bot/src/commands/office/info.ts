import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, isNull, asc, desc } from 'drizzle-orm';
import { offices, officeHolders, players } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { autocompleteOffice } from './_officeAutocomplete.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('office-info')
    .setDescription('Details on an office — permissions, how filled, holder history')
    .addStringOption((opt) =>
      opt
        .setName('office')
        .setDescription('Name of the office')
        .setRequired(true)
        .setAutocomplete(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();
    const staffViewer = interaction.guild && interaction.member
      ? await isStaff(await interaction.guild.members.fetch(interaction.user.id))
      : false;

    const officeName = interaction.options.getString('office', true);

    // Look up the office by name (case-insensitive)
    const allOffices = await db
      .select()
      .from(offices)
      .where(eq(offices.isActive, true))
      .orderBy(asc(offices.sortOrder));

    const match = allOffices.find(
      (o) => o.name.toLowerCase() === officeName.toLowerCase(),
    ) ?? allOffices.find(
      (o) => o.name.toLowerCase().includes(officeName.toLowerCase()),
    );

    if (!match) {
      const embed = createEmbed({
        title: 'Office Not Found',
        description: `No office matching "${officeName}" was found.`,
        system: 'offices',
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Current holders
    const currentHolders = await db
      .select({
        playerName: players.characterName,
        discordUsername: players.discordUsername,
        startDate: officeHolders.startDate,
      })
      .from(officeHolders)
      .innerJoin(players, eq(officeHolders.playerId, players.id))
      .where(
        and(
          eq(officeHolders.officeId, match.id),
          isNull(officeHolders.endDate),
        ),
      );

    const currentHolderText = currentHolders.length > 0
      ? currentHolders
          .map((h) => `**${h.playerName ?? h.discordUsername}** (since ${h.startDate.toLocaleDateString()})`)
          .join('\n')
      : '*Vacant*';

    // Full holder history (most recent first, limit 5 for embed)
    const holderHistory = await db
      .select({
        playerName: players.characterName,
        discordUsername: players.discordUsername,
        startDate: officeHolders.startDate,
        endDate: officeHolders.endDate,
      })
      .from(officeHolders)
      .innerJoin(players, eq(officeHolders.playerId, players.id))
      .where(eq(officeHolders.officeId, match.id))
      .orderBy(desc(officeHolders.startDate));

    const fields = [
      { name: 'Tier', value: formatTier(match.tier), inline: true },
      { name: 'Filled By', value: match.filledBy, inline: true },
      { name: 'Max Holders', value: `${match.maxHolders}`, inline: true },
      { name: 'Current Holder', value: currentHolderText },
    ];

    const permissions = match.permissions as string[] | null;
    if (staffViewer && permissions && permissions.length > 0) {
      fields.push({
        name: 'Permissions',
        value: permissions.map((p) => `\`${p}\``).join(', '),
        inline: false,
      });
    }

    if (match.requiresConfirmation) {
      fields.push({
        name: 'Confirmation',
        value: 'Requires NPC house confirmation',
        inline: false,
      });
    }

    if (holderHistory.length > 0) {
      const historyLines = holderHistory.slice(0, 5).map((h) => {
        const name = h.playerName ?? h.discordUsername;
        const start = h.startDate.toLocaleDateString();
        const end = h.endDate ? h.endDate.toLocaleDateString() : 'present';
        return `${name}: ${start} \u2013 ${end}`;
      });

      fields.push({
        name: `Holder History (${holderHistory.length} total)`,
        value: historyLines.join('\n'),
        inline: false,
      });
    }

    const embed = createEmbed({
      title: match.name,
      system: 'offices',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await autocompleteOffice(interaction);
  },
};

function formatTier(tier: string): string {
  return tier
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default command;
