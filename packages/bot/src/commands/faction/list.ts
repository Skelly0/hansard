import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq, sql, asc } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, parties, factions } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

function parseHexColour(hex: string | null | undefined): number | undefined {
  if (!hex) return undefined;
  const cleaned = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return undefined;
  return parseInt(cleaned, 16);
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('faction-list')
    .setDescription('List all active factions with member and party counts') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const factionRows = await db
      .select()
      .from(factions)
      .where(eq(factions.isActive, true))
      .orderBy(asc(factions.name));

    if (factionRows.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Active Factions',
            description: '*No active factions exist yet. Create one with `/faction-create`.*',
            system: 'offices',
          }),
        ],
      });
      return;
    }

    const playerCounts = await db
      .select({ factionId: players.factionId, count: sql<number>`count(*)::int` })
      .from(players)
      .where(eq(players.isActive, true))
      .groupBy(players.factionId);
    const playerMap = new Map<string | null, number>();
    for (const c of playerCounts) playerMap.set(c.factionId, c.count);

    const partyCounts = await db
      .select({ factionId: parties.factionId, count: sql<number>`count(*)::int` })
      .from(parties)
      .where(eq(parties.isActive, true))
      .groupBy(parties.factionId);
    const partyMap = new Map<string | null, number>();
    for (const c of partyCounts) partyMap.set(c.factionId, c.count);

    const lines = factionRows.map((f) => {
      const memberCount = playerMap.get(f.id) ?? 0;
      const partyCount = partyMap.get(f.id) ?? 0;
      const colourSwatch = f.colour ? ` \`${f.colour}\`` : '';
      const roleMention = f.discordRoleId ? ` <@&${f.discordRoleId}>` : '';
      const desc = f.description ? `\n> *${f.description}*` : '';
      return [
        `**${f.name}**${f.shortName ? ` (${f.shortName})` : ''}${colourSwatch}${roleMention}`,
        `> Parties: **${partyCount}** · Members: **${memberCount}**${desc}`,
      ].join('\n');
    });

    const embed = createEmbed({
      title: 'Active Factions',
      description: lines.join('\n\n').slice(0, 4000),
      system: 'offices',
    });

    if (factionRows.length === 1) {
      const tint = parseHexColour(factionRows[0].colour);
      if (tint !== undefined) embed.setColor(tint);
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
