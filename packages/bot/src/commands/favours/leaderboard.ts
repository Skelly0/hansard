import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, desc, sum, asc } from 'drizzle-orm';
import { db } from '../../db.js';
import {
  favourBalances,
  favourCategories,
  players,
  parties,
} from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { autocompleteFavourCategory } from './_categoryAutocomplete.js';
import type { Command } from '../../client.js';

const TOP_N = 10;
const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('favour-leaderboard')
    .setDescription('Top favour holders (staff only) — overall, or per category')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('category')
        .setDescription('Restrict to one category (omit for overall ranking)')
        .setRequired(false)
        .setAutocomplete(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member;
    if (!member || !(await isStaff(member as any))) {
      await interaction.editReply({
        embeds: [errorEmbed('Only staff can view favour leaderboards.')],
      });
      return;
    }

    const categoryName = interaction.options.getString('category')?.trim();

    let categoryRow:
      | { id: string; name: string; emoji: string | null }
      | null = null;

    if (categoryName) {
      const allCategories = await db
        .select({
          id: favourCategories.id,
          name: favourCategories.name,
          emoji: favourCategories.emoji,
        })
        .from(favourCategories)
        .where(eq(favourCategories.isActive, true))
        .orderBy(asc(favourCategories.sortOrder));

      const match =
        allCategories.find(
          (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
        ) ??
        allCategories.find((c) =>
          c.name.toLowerCase().includes(categoryName.toLowerCase()),
        );

      if (!match) {
        await interaction.editReply({
          embeds: [
            errorEmbed(`No favour category matching "${categoryName}" found.`),
          ],
        });
        return;
      }
      categoryRow = match;
    }

    // Build the leaderboard rows. For per-category: pull balances directly.
    // For overall: sum balances across all categories per player.
    type Row = {
      playerId: string;
      playerName: string | null;
      discordUsername: string;
      partyId: string | null;
      balance: number;
    };

    let rows: Row[];

    if (categoryRow) {
      // Mirror getLeaderboard from favourService.
      const result = await db
        .select({
          playerId: favourBalances.playerId,
          playerName: players.characterName,
          discordUsername: players.discordUsername,
          partyId: players.partyId,
          balance: favourBalances.balance,
        })
        .from(favourBalances)
        .innerJoin(players, eq(favourBalances.playerId, players.id))
        .where(eq(favourBalances.categoryId, categoryRow.id))
        .orderBy(desc(favourBalances.balance))
        .limit(TOP_N);

      rows = result;
    } else {
      // Overall: sum across all categories grouped by player.
      const result = await db
        .select({
          playerId: favourBalances.playerId,
          playerName: players.characterName,
          discordUsername: players.discordUsername,
          partyId: players.partyId,
          total: sum(favourBalances.balance),
        })
        .from(favourBalances)
        .innerJoin(players, eq(favourBalances.playerId, players.id))
        .groupBy(
          favourBalances.playerId,
          players.characterName,
          players.discordUsername,
          players.partyId,
        )
        .orderBy(desc(sum(favourBalances.balance)))
        .limit(TOP_N);

      rows = result.map((r) => ({
        playerId: r.playerId,
        playerName: r.playerName,
        discordUsername: r.discordUsername,
        partyId: r.partyId,
        // drizzle returns SUM as string for bigint-safety; coerce
        balance: Number(r.total ?? 0),
      }));
    }

    if (rows.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: categoryRow
              ? `Leaderboard — ${categoryRow.name}`
              : 'Leaderboard — Overall',
            description: '*No favour balances recorded yet.*',
            system: 'favours',
          }),
        ],
      });
      return;
    }

    // Resolve party names in one query.
    const partyIds = [
      ...new Set(rows.map((r) => r.partyId).filter((x): x is string => Boolean(x))),
    ];
    const partyMap = new Map<string, string>();
    if (partyIds.length > 0) {
      const partyRows = await db
        .select({ id: parties.id, name: parties.name })
        .from(parties);
      for (const p of partyRows) partyMap.set(p.id, p.name);
    }

    const lines = rows.map((r, i) => {
      const rank = i < 3 ? MEDALS[i] : `**#${i + 1}**`;
      const name = r.playerName ?? r.discordUsername;
      const partyName = r.partyId ? partyMap.get(r.partyId) ?? 'Unknown' : 'Independent';
      return `${rank} **${name}** (${partyName}) — \`${r.balance}\``;
    });

    const titleLabel = categoryRow
      ? `${categoryRow.emoji ? `${categoryRow.emoji} ` : ''}${categoryRow.name}`
      : 'Overall';

    const embed = createEmbed({
      title: `Favour Leaderboard — ${titleLabel}`,
      description: lines.join('\n'),
      system: 'favours',
      fields: [
        {
          name: 'Scope',
          value: categoryRow
            ? `Top ${rows.length} in **${categoryRow.name}**`
            : `Top ${rows.length} by total favours across all categories`,
        },
      ],
    });

    await interaction.editReply({ embeds: [embed] });
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await autocompleteFavourCategory(interaction);
  },
};

export default command;
