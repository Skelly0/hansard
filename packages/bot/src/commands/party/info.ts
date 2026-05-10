import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq, and, asc } from 'drizzle-orm';
import { parties, players, factions } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

function parseHexColour(hex: string | null | undefined): number | undefined {
  if (!hex) return undefined;
  const cleaned = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return undefined;
  return parseInt(cleaned, 16);
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('party-info')
    .setDescription('Show party details — leader, members, faction, ideology')
    .addStringOption((opt) =>
      opt.setName('party').setDescription('Party (name or short tag)').setRequired(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const query = interaction.options.getString('party', true);
    const actorIsStaff = !!interaction.member && (await isStaff(interaction.member as any));
    const all = actorIsStaff
      ? await db.select().from(parties).orderBy(asc(parties.name))
      : await db.select().from(parties).where(eq(parties.isActive, true)).orderBy(asc(parties.name));
    const target =
      all.find((p) => p.name.toLowerCase() === query.toLowerCase()) ??
      all.find((p) => p.shortName?.toLowerCase() === query.toLowerCase()) ??
      all.find((p) => p.name.toLowerCase().includes(query.toLowerCase()));

    if (!target) {
      await interaction.editReply({ embeds: [errorEmbed(`No party matching "${query}" found.`)] });
      return;
    }

    let factionName: string | null = null;
    if (target.factionId) {
      const [f] = await db.select({ name: factions.name }).from(factions).where(eq(factions.id, target.factionId)).limit(1);
      factionName = f?.name ?? null;
    }

    let leaderLabel: string | null = null;
    if (target.leaderId) {
      const [l] = await db
        .select({ id: players.id, characterName: players.characterName, discordUsername: players.discordUsername, discordId: players.discordId })
        .from(players)
        .where(eq(players.id, target.leaderId))
        .limit(1);
      if (l) leaderLabel = `<@${l.discordId}> — ${l.characterName ?? l.discordUsername}`;
    }

    const memberRows = await db
      .select({
        characterName: players.characterName,
        discordUsername: players.discordUsername,
        discordId: players.discordId,
      })
      .from(players)
      .where(and(eq(players.partyId, target.id), eq(players.isActive, true)))
      .orderBy(asc(players.characterName));

    const memberLines = memberRows.length === 0
      ? '*No active members.*'
      : memberRows.map((m) => `• <@${m.discordId}> — ${m.characterName ?? m.discordUsername}`).join('\n').slice(0, 1024);

    const meta = [
      target.shortName ? `**Tag:** ${target.shortName}` : '',
      target.ideology ? `**Ideology:** ${target.ideology}` : '',
      factionName ? `**Faction:** ${factionName}` : '',
      target.colour ? `**Colour:** \`${target.colour}\`` : '',
      target.discordRoleId ? `**Role:** <@&${target.discordRoleId}>` : '',
      `**Access:** ${target.isInviteOnly ? 'Invite-only' : 'Open join'}`,
      target.isActive ? '' : `**Dissolved:** ${target.dissolvedAt ? target.dissolvedAt.toISOString().slice(0, 10) : 'unknown'}`,
    ].filter(Boolean).join('\n');

    const embed = createEmbed({
      title: `${target.name}${target.isActive ? '' : ' (Dissolved)'}`,
      description: meta || '*No metadata.*',
      system: 'offices',
      fields: [
        { name: 'Leader', value: leaderLabel ?? '*Vacant*' },
        { name: `Members (${memberRows.length})`, value: memberLines },
      ],
    });

    const tint = parseHexColour(target.colour);
    if (tint !== undefined) embed.setColor(tint);

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
