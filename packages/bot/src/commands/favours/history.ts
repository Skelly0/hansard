import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, desc, asc, type SQL } from 'drizzle-orm';
import { favourTransactions, favourCategories, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('favour-history')
    .setDescription('View favour transaction history')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Player to view (staff only, defaults to yourself)').setRequired(false),
    )
    .addStringOption((opt) =>
      opt.setName('category').setDescription('Filter by category').setRequired(false).setAutocomplete(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const categoryFilter = interaction.options.getString('category') ?? null;

    // Look up the target player
    const [targetPlayer] = await db
      .select()
      .from(players)
      .where(eq(players.discordId, targetUser.id))
      .limit(1);

    if (!targetPlayer) {
      await interaction.editReply({
        embeds: [errorEmbed(`${targetUser.username} is not registered as a player.`)],
      });
      return;
    }

    // Build query conditions
    const conditions: SQL[] = [eq(favourTransactions.playerId, targetPlayer.id)];

    // Resolve category filter if provided
    if (categoryFilter) {
      const allCategories = await db
        .select()
        .from(favourCategories)
        .where(eq(favourCategories.isActive, true))
        .orderBy(asc(favourCategories.sortOrder));

      const category = allCategories.find(
        (c) => c.name.toLowerCase() === categoryFilter.toLowerCase(),
      ) ?? allCategories.find(
        (c) => c.name.toLowerCase().includes(categoryFilter.toLowerCase()),
      );

      if (category) {
        conditions.push(eq(favourTransactions.categoryId, category.id));
      }
    }

    // Fetch transactions
    const transactions = await db
      .select({
        amount: favourTransactions.amount,
        balanceAfter: favourTransactions.balanceAfter,
        type: favourTransactions.type,
        reason: favourTransactions.reason,
        createdAt: favourTransactions.createdAt,
        categoryName: favourCategories.name,
        categoryEmoji: favourCategories.emoji,
      })
      .from(favourTransactions)
      .innerJoin(favourCategories, eq(favourTransactions.categoryId, favourCategories.id))
      .where(and(...conditions))
      .orderBy(desc(favourTransactions.createdAt))
      .limit(15);

    if (transactions.length === 0) {
      const embed = createEmbed({
        title: 'Favour History',
        description: 'No favour transactions found.',
        system: 'favours',
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const lines = transactions.map((t) => {
      const emoji = t.categoryEmoji ? `${t.categoryEmoji} ` : '';
      const sign = t.amount >= 0 ? '+' : '';
      const date = t.createdAt.toLocaleDateString();
      const reasonText = t.reason ? ` \u2014 ${t.reason}` : '';
      return `\`${date}\` ${emoji}**${t.categoryName}** ${sign}${t.amount} (bal: ${t.balanceAfter}) [${t.type}]${reasonText}`;
    });

    const playerName = targetPlayer.characterName ?? targetUser.username;
    const embed = createEmbed({
      title: `Favour History \u2014 ${playerName}`,
      description: lines.join('\n'),
      system: 'favours',
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
