import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, asc, gte, sql } from 'drizzle-orm';
import { favourBalances, favourCategories, favourTransactions, players } from '@hansard/db';
import { FavourTransactionType } from '@hansard/shared';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('favour-spend')
    .setDescription('Deduct favours from a player (staff only)')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('The player spending favours').setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('category').setDescription('Favour category name').setRequired(true).setAutocomplete(true),
    )
    .addIntegerOption((opt) =>
      opt.setName('amount').setDescription('Number of favours to spend').setRequired(true).setMinValue(1),
    )
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('What the favours are being spent on').setRequired(false),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
      return;
    }

    if (!(await isStaff(member))) {
      await interaction.editReply({ embeds: [errorEmbed('Only staff can process favour spending.')] });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    const categoryName = interaction.options.getString('category', true);
    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason') ?? null;

    // Resolve staff player
    const [staffPlayer] = await db
      .select()
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!staffPlayer) {
      await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player.')] });
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

    // Resolve category
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

    let newBalance = 0;
    try {
      const result = await db.transaction(async (tx) => {
        // Atomic conditional decrement — only succeeds if balance >= amount.
        const [updated] = await tx
          .update(favourBalances)
          .set({ balance: sql`${favourBalances.balance} - ${amount}`, updatedAt: new Date() })
          .where(
            and(
              eq(favourBalances.playerId, targetPlayer.id),
              eq(favourBalances.categoryId, category.id),
              gte(favourBalances.balance, amount),
            ),
          )
          .returning({ balance: favourBalances.balance });

        if (!updated) {
          // Either no row or insufficient balance — read current balance for the error message.
          const [row] = await tx
            .select({ balance: favourBalances.balance })
            .from(favourBalances)
            .where(
              and(
                eq(favourBalances.playerId, targetPlayer.id),
                eq(favourBalances.categoryId, category.id),
              ),
            )
            .limit(1);
          return { ok: false as const, currentBalance: row?.balance ?? 0 };
        }

        await tx.insert(favourTransactions).values({
          playerId: targetPlayer.id,
          categoryId: category.id,
          amount: -amount,
          balanceAfter: updated.balance,
          type: FavourTransactionType.SPEND,
          reason,
          grantedById: staffPlayer.id,
        });
        return { ok: true as const, balance: updated.balance };
      });

      if (!result.ok) {
        const playerName = targetPlayer.characterName ?? targetUser.username;
        await interaction.editReply({
          embeds: [errorEmbed(
            `Insufficient favours: **${playerName}** has \`${result.currentBalance}\` in ${category.name}, cannot spend \`${amount}\`.`,
          )],
        });
        return;
      }
      newBalance = result.balance;

      const playerName = targetPlayer.characterName ?? targetUser.username;
      const emoji = category.emoji ? `${category.emoji} ` : '';

      const embed = successEmbed(
        'Favours Spent',
        [
          `${emoji}**-${amount}** ${category.name} favours deducted from **${playerName}**.`,
          `New balance: \`${newBalance}\``,
          reason ? `**Reason:** ${reason}` : '',
        ].filter(Boolean).join('\n'),
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Spend failed';
      await interaction.editReply({ embeds: [errorEmbed(message)] });
    }
  },
};

export default command;
