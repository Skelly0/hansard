import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, asc } from 'drizzle-orm';
import { favourBalances, favourCategories, favourTransactions, players } from '@hansard/db';
import { FavourTransactionType } from '@hansard/shared';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('favour-remove')
    .setDescription('Remove favours from a player as a penalty/correction (staff only)')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('The player to penalise').setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('category')
        .setDescription('Favour category name')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('amount')
        .setDescription('Number of favours to remove (positive number)')
        .setRequired(true)
        .setMinValue(1),
    )
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason for removal').setRequired(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({
        embeds: [errorEmbed('This command can only be used in a server.')],
      });
      return;
    }

    if (!(await isStaff(member))) {
      await interaction.editReply({
        embeds: [errorEmbed('Only staff can remove favours.')],
      });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    const categoryName = interaction.options.getString('category', true);
    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason', true);

    // Resolve staff player record
    const [staffPlayer] = await db
      .select()
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!staffPlayer) {
      await interaction.editReply({
        embeds: [errorEmbed('You are not registered as a player.')],
      });
      return;
    }

    // Resolve target player
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

    // Resolve category (case-insensitive)
    const allCategories = await db
      .select()
      .from(favourCategories)
      .where(eq(favourCategories.isActive, true))
      .orderBy(asc(favourCategories.sortOrder));

    const category = allCategories.find(
      (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
    ) ?? allCategories.find(
      (c) => c.name.toLowerCase().includes(categoryName.toLowerCase()),
    );

    if (!category) {
      await interaction.editReply({
        embeds: [errorEmbed(`No favour category matching "${categoryName}" found.`)],
      });
      return;
    }

    try {
      // Get or create balance row (mirroring grant.ts)
      let [balanceRow] = await db
        .select()
        .from(favourBalances)
        .where(
          and(
            eq(favourBalances.playerId, targetPlayer.id),
            eq(favourBalances.categoryId, category.id),
          ),
        )
        .limit(1);

      if (!balanceRow) {
        [balanceRow] = await db.insert(favourBalances).values({
          playerId: targetPlayer.id,
          categoryId: category.id,
          balance: 0,
        }).returning();
      }

      const newBalance = balanceRow.balance - amount;

      await db
        .update(favourBalances)
        .set({ balance: newBalance, updatedAt: new Date() })
        .where(eq(favourBalances.id, balanceRow.id));

      // Log transaction with negative amount per favours schema convention
      await db.insert(favourTransactions).values({
        playerId: targetPlayer.id,
        categoryId: category.id,
        amount: -amount,
        balanceAfter: newBalance,
        type: FavourTransactionType.REMOVE,
        reason,
        grantedById: staffPlayer.id,
      });

      const playerName = targetPlayer.characterName ?? targetUser.username;
      const emoji = category.emoji ? `${category.emoji} ` : '';

      const embed = successEmbed(
        'Favours Removed',
        [
          `${emoji}**−${amount}** ${category.name} favours removed from **${playerName}**.`,
          `New balance: \`${newBalance}\``,
          `**Reason:** ${reason}`,
        ].join('\n'),
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Removal failed';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
