import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq, and, asc } from 'drizzle-orm';
import { parties, players, factions } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

function parseHexColour(hex: string | null | undefined): number | undefined {
  if (!hex) return undefined;
  const cleaned = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return undefined;
  return parseInt(cleaned, 16);
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('faction-info')
    .setDescription('Show faction details — parties, member count, description')
    .addStringOption((opt) =>
      opt.setName('faction').setDescription('Faction (name or short tag)').setRequired(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

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

    const partyRows = await db
      .select({ name: parties.name, shortName: parties.shortName, isActive: parties.isActive })
      .from(parties)
      .where(eq(parties.factionId, target.id))
      .orderBy(asc(parties.name));

    const memberRows = await db
      .select({
        characterName: players.characterName,
        discordUsername: players.discordUsername,
        discordId: players.discordId,
      })
      .from(players)
      .where(and(eq(players.factionId, target.id), eq(players.isActive, true)))
      .orderBy(asc(players.characterName));

    const partyLines = partyRows.length === 0
      ? '*No parties affiliated.*'
      : partyRows
          .map((p) => `• **${p.name}**${p.shortName ? ` (${p.shortName})` : ''}${p.isActive ? '' : ' *(dissolved)*'}`)
          .join('\n').slice(0, 1024);

    const memberLines = memberRows.length === 0
      ? '*No active members.*'
      : memberRows.map((m) => `• <@${m.discordId}> — ${m.characterName ?? m.discordUsername}`).join('\n').slice(0, 1024);

    const meta = [
      target.shortName ? `**Tag:** ${target.shortName}` : '',
      target.description ? `**Description:** ${target.description}` : '',
      target.colour ? `**Colour:** \`${target.colour}\`` : '',
      target.discordRoleId ? `**Role:** <@&${target.discordRoleId}>` : '',
      target.isActive ? '' : '**Status:** Dissolved',
    ].filter(Boolean).join('\n');

    const embed = createEmbed({
      title: `${target.name}${target.isActive ? '' : ' (Dissolved)'}`,
      description: meta || '*No metadata.*',
      system: 'offices',
      fields: [
        { name: `Parties (${partyRows.length})`, value: partyLines },
        { name: `Members (${memberRows.length})`, value: memberLines },
      ],
    });

    const tint = parseHexColour(target.colour);
    if (tint !== undefined) embed.setColor(tint);

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
