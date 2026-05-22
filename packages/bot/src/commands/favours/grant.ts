import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, asc, sql } from 'drizzle-orm';
import { favourBalances, favourCategories, favourTransactions, players } from '@hansard/db';
import { FavourTransactionType } from '@hansard/shared';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import { postStaffActionLog } from '../../utils/modLog.js';
import { autocompleteFavourCategory } from './_categoryAutocomplete.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }

  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can grant favours.')] });
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

  if (allCategories.length === 0) {
    await interaction.editReply({
      embeds: [errorEmbed(
        'No favour categories defined. Staff must run `/favour category-create` first.',
      )],
    });
    return;
  }

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
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(favourBalances)
        .set({ balance: sql`${favourBalances.balance} + ${amount}`, updatedAt: new Date() })
        .where(
          and(
            eq(favourBalances.playerId, targetPlayer.id),
            eq(favourBalances.categoryId, category.id),
          ),
        )
        .returning({ balance: favourBalances.balance });

      if (updated) {
        newBalance = updated.balance;
      } else {
        const [inserted] = await tx
          .insert(favourBalances)
          .values({
            playerId: targetPlayer.id,
            categoryId: category.id,
            balance: amount,
          })
          .returning({ balance: favourBalances.balance });
        newBalance = inserted.balance;
      }

      await tx.insert(favourTransactions).values({
        playerId: targetPlayer.id,
        categoryId: category.id,
        amount,
        balanceAfter: newBalance,
        type: FavourTransactionType.GRANT,
        reason,
        grantedById: staffPlayer.id,
      });
    });

    const playerName = targetPlayer.characterName ?? targetUser.username;
    const emoji = category.emoji ? `${category.emoji} ` : '';

    const embed = successEmbed(
      'Favours Granted',
      [
        `${emoji}**+${amount}** ${category.name} favours granted to **${playerName}**.`,
        `New balance: \`${newBalance}\``,
        reason ? `**Reason:** ${reason}` : '',
      ].filter(Boolean).join('\n'),
    );

    await postStaffActionLog(interaction, {
      title: 'Favours Granted',
      system: 'favours',
      fields: [
        { name: 'Player', value: `**${playerName}** (<@${targetUser.id}>)`, inline: true },
        { name: 'Category', value: category.name, inline: true },
        { name: 'Amount', value: `+${amount}`, inline: true },
        { name: 'New Balance', value: `${newBalance}`, inline: true },
        ...(reason ? [{ name: 'Reason', value: reason }] : []),
      ],
    });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Grant failed';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await autocompleteFavourCategory(interaction);
}
