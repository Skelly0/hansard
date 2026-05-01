import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, sql, asc } from 'drizzle-orm';
import { db } from '../../db.js';
import { players, parties, factions } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

// Parse "#RRGGBB" hex into a Discord embed colour integer.
function parseHexColour(hex: string | null | undefined): number | undefined {
  if (!hex) return undefined;
  const cleaned = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return undefined;
  return parseInt(cleaned, 16);
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('party-list')
    .setDescription('List all active parties with member counts and colours') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    // Active parties
    const partyRows = await db
      .select({
        id: parties.id,
        name: parties.name,
        shortName: parties.shortName,
        ideology: parties.ideology,
        colour: parties.colour,
        factionId: parties.factionId,
        discordRoleId: parties.discordRoleId,
      })
      .from(parties)
      .where(eq(parties.isActive, true))
      .orderBy(asc(parties.name));

    if (partyRows.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: 'Active Parties',
            description: '*No active parties exist yet.*',
            system: 'offices',
          }),
        ],
      });
      return;
    }

    // Member counts grouped by partyId
    const counts = await db
      .select({
        partyId: players.partyId,
        count: sql<number>`count(*)::int`,
      })
      .from(players)
      .where(eq(players.isActive, true))
      .groupBy(players.partyId);

    const countMap = new Map<string | null, number>();
    for (const c of counts) countMap.set(c.partyId, c.count);

    // Faction names
    const factionRows = await db.select({ id: factions.id, name: factions.name }).from(factions);
    const factionMap = new Map(factionRows.map((f) => [f.id, f.name]));

    // NOTE: per-party seat totals are not stored on `parties` directly; seat
    // allocations live in voting.results.seatAllocation per election. Skipped
    // for now — will be aggregated once seat-tracking ledger lands.

    const partyLines = partyRows.map((p) => {
      const members = countMap.get(p.id) ?? 0;
      const faction = p.factionId ? factionMap.get(p.factionId) ?? 'Unknown' : 'Cross-faction';
      const ideology = p.ideology ? ` — *${p.ideology}*` : '';
      const colourSwatch = p.colour ? ` \`${p.colour}\`` : '';
      const roleMention = p.discordRoleId ? ` <@&${p.discordRoleId}>` : '';
      return [
        `**${p.name}**${p.shortName ? ` (${p.shortName})` : ''}${colourSwatch}${roleMention}`,
        `> ${faction}${ideology}`,
        `> Members: **${members}**`,
      ].join('\n');
    });

    const independentCount = countMap.get(null) ?? 0;

    const embed = createEmbed({
      title: 'Active Parties',
      description: partyLines.join('\n\n').slice(0, 4000),
      system: 'offices',
      fields: [
        {
          name: 'Independents',
          value: `**${independentCount}** unaffiliated player${independentCount === 1 ? '' : 's'}.`,
        },
        {
          name: 'Seats',
          value: '*Per-party seat totals not yet tracked at the party level.*',
        },
      ],
    });

    // If only one party, tint the embed with its colour for flavour
    if (partyRows.length === 1) {
      const tint = parseHexColour(partyRows[0].colour);
      if (tint !== undefined) embed.setColor(tint);
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
