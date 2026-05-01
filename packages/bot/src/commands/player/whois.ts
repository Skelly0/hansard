import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, ilike, and, isNull } from 'drizzle-orm';
import { db } from '../../db.js';
import {
  players,
  factions,
  parties,
  offices,
  officeHolders,
  favourBalances,
  favourCategories,
} from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

const HEALTH_DISPLAY: Record<string, string> = {
  healthy: '\u{1F7E2} Healthy',
  minor: '\u{1F7E1} Minor Ailment',
  major: '\u{1F7E0} Major Ailment',
  critical: '\u{1F534} Critical',
  deceased: '\u{26B0}\u{FE0F} Deceased',
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Reverse-lookup a player by their in-character name')
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

    // Case-insensitive partial search on characterName
    const results = await db
      .select()
      .from(players)
      .where(ilike(players.characterName, `%${searchName}%`))
      .limit(10);

    if (results.length === 0) {
      await interaction.editReply({
        embeds: [errorEmbed(`No characters found matching **${searchName}**.`)],
      });
      return;
    }

    // Multiple matches — short list
    if (results.length > 1) {
      const lines = results.map((p) => {
        const status = p.isAlive ? '\u{1F7E2}' : '\u{26B0}\u{FE0F}';
        const age = p.currentAge ?? p.startingAge ?? '?';
        return `${status} **${p.characterName}** — <@${p.discordId}> (Age ${age})`;
      });

      const embed = createEmbed({
        title: `Whois — "${searchName}"`,
        description: lines.join('\n'),
        system: 'players',
        fields: [
          {
            name: 'Multiple matches',
            value: `Found ${results.length} characters. Refine your search for a full dossier.`,
          },
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Single match — full dossier
    const player = results[0];

    // Faction
    let factionName = 'None';
    if (player.factionId) {
      const rows = await db
        .select({ name: factions.name })
        .from(factions)
        .where(eq(factions.id, player.factionId))
        .limit(1);
      if (rows.length > 0) factionName = rows[0].name;
    }

    // Party + party Discord role
    let partyName = 'Independent';
    let partyRoleId: string | null = null;
    if (player.partyId) {
      const rows = await db
        .select({ name: parties.name, discordRoleId: parties.discordRoleId })
        .from(parties)
        .where(eq(parties.id, player.partyId))
        .limit(1);
      if (rows.length > 0) {
        partyName = rows[0].name;
        partyRoleId = rows[0].discordRoleId ?? null;
      }
    }

    // Active offices (endDate IS NULL) — joined with offices for name/tier/role
    const activeOffices = await db
      .select({
        officeName: offices.name,
        officeTier: offices.tier,
        officeRoleId: offices.discordRoleId,
      })
      .from(officeHolders)
      .innerJoin(offices, eq(officeHolders.officeId, offices.id))
      .where(
        and(eq(officeHolders.playerId, player.id), isNull(officeHolders.endDate)),
      );

    // Favour balances — brief stats
    const balances = await db
      .select({
        categoryName: favourCategories.name,
        categoryEmoji: favourCategories.emoji,
        balance: favourBalances.balance,
      })
      .from(favourBalances)
      .innerJoin(favourCategories, eq(favourBalances.categoryId, favourCategories.id))
      .where(eq(favourBalances.playerId, player.id));

    const totalFavours = balances.reduce((sum, b) => sum + b.balance, 0);

    const officeText = activeOffices.length > 0
      ? activeOffices.map((o) => `**${o.officeName}** (${o.officeTier})`).join('\n')
      : '*No offices held*';

    // Discord roles found via DB join — party role + each office role
    const roleMentions: string[] = [];
    if (partyRoleId) roleMentions.push(`<@&${partyRoleId}>`);
    for (const o of activeOffices) {
      if (o.officeRoleId) roleMentions.push(`<@&${o.officeRoleId}>`);
    }

    const rolesText = roleMentions.length > 0
      ? roleMentions.join(' ')
      : '*No mapped party/office roles*';

    const favoursBrief = balances.length > 0
      ? `${totalFavours} total across ${balances.length} categor${balances.length === 1 ? 'y' : 'ies'}`
      : '*No favour balances*';

    const healthDisplay = HEALTH_DISPLAY[player.healthStatus] ?? player.healthStatus;
    const age = player.currentAge ?? player.startingAge ?? '?';

    const bio = player.characterBio
      ? player.characterBio.length > 300
        ? player.characterBio.slice(0, 297) + '...'
        : player.characterBio
      : undefined;

    const embed = createEmbed({
      title: player.characterName ?? 'Unknown',
      description: bio ? `> ${bio}` : undefined,
      system: 'players',
      thumbnail: player.characterPortraitUrl ?? undefined,
      fields: [
        { name: 'Discord User', value: `<@${player.discordId}>`, inline: true },
        { name: 'Age', value: String(age), inline: true },
        { name: 'Health', value: healthDisplay, inline: true },
        { name: 'Faction', value: factionName, inline: true },
        { name: 'Party', value: partyName, inline: true },
        {
          name: 'Status',
          value: player.isAlive ? '\u{1F7E2} Alive' : '\u{26B0}\u{FE0F} Deceased',
          inline: true,
        },
        { name: 'Current Offices', value: officeText },
        { name: 'Discord Roles', value: rolesText },
        { name: 'Favours', value: favoursBrief, inline: true },
      ],
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
