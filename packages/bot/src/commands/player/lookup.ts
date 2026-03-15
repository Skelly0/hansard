import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, factions, parties } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Look up a player by character name')
    .addStringOption((opt) =>
      opt
        .setName('name')
        .setDescription('The character name to search for')
        .setRequired(true)
        .setMaxLength(128),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const searchName = interaction.options.getString('name', true).trim();

    // Case-insensitive search using ilike
    const results = await db
      .select()
      .from(players)
      .where(ilike(players.characterName, `%${searchName}%`))
      .limit(10);

    if (results.length === 0) {
      await interaction.editReply({
        embeds: [
          errorEmbed(`No characters found matching **${searchName}**.`),
        ],
      });
      return;
    }

    // For a single exact (or close) match, show the full dossier-style card
    if (results.length === 1) {
      const player = results[0];

      // Fetch faction
      let factionName = 'None';
      if (player.factionId) {
        const factionRows = await db
          .select({ name: factions.name })
          .from(factions)
          .where(eq(factions.id, player.factionId))
          .limit(1);
        if (factionRows.length > 0) factionName = factionRows[0].name;
      }

      // Fetch party
      let partyName = 'Independent';
      if (player.partyId) {
        const partyRows = await db
          .select({ name: parties.name })
          .from(parties)
          .where(eq(parties.id, player.partyId))
          .limit(1);
        if (partyRows.length > 0) partyName = partyRows[0].name;
      }

      const embed = createEmbed({
        title: player.characterName ?? 'Unknown',
        description: player.characterBio
          ? `> ${player.characterBio.length > 300 ? player.characterBio.slice(0, 297) + '...' : player.characterBio}`
          : undefined,
        system: 'players',
        thumbnail: player.characterPortraitUrl ?? undefined,
        fields: [
          { name: 'Player', value: `<@${player.discordId}>`, inline: true },
          {
            name: 'Age',
            value: String(player.currentAge ?? player.startingAge ?? '?'),
            inline: true,
          },
          {
            name: 'Status',
            value: player.isAlive ? '\u{1F7E2} Alive' : '\u{26B0}\u{FE0F} Deceased',
            inline: true,
          },
          { name: 'Faction', value: factionName, inline: true },
          { name: 'Party', value: partyName, inline: true },
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Multiple matches — show a list
    const lines = results.map((p) => {
      const status = p.isAlive ? '\u{1F7E2}' : '\u{26B0}\u{FE0F}';
      const age = p.currentAge ?? p.startingAge ?? '?';
      return `${status} **${p.characterName}** — <@${p.discordId}> (Age ${age})`;
    });

    const embed = createEmbed({
      title: `Search Results for "${searchName}"`,
      description: lines.join('\n'),
      system: 'players',
      fields: [
        {
          name: 'Results',
          value: `Found ${results.length} character${results.length === 1 ? '' : 's'}. Use \`/character view @user\` for full details.`,
        },
      ],
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
