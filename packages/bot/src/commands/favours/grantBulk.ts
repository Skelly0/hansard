import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from 'discord.js';
import { eq, and, asc, isNull } from 'drizzle-orm';
import {
  favourBalances,
  favourCategories,
  favourTransactions,
  players,
  parties,
  offices,
  officeHolders,
} from '@hansard/db';
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

  const categoryName = interaction.options.getString('category', true);
  const amount = interaction.options.getInteger('amount', true);
  const partyName = interaction.options.getString('party')?.trim() || null;
  const officeName = interaction.options.getString('office')?.trim() || null;
  const reason = interaction.options.getString('reason') ?? null;

  if (!partyName && !officeName) {
    await interaction.editReply({ embeds: [errorEmbed('Provide either `party` or `office`.')] });
    return;
  }
  if (partyName && officeName) {
    await interaction.editReply({ embeds: [errorEmbed('Provide only one of `party` or `office`, not both.')] });
    return;
  }

  const [staffPlayer] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);
  if (!staffPlayer) {
    await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player.')] });
    return;
  }

  const allCategories = await db
    .select()
    .from(favourCategories)
    .where(eq(favourCategories.isActive, true))
    .orderBy(asc(favourCategories.sortOrder));
  if (allCategories.length === 0) {
    await interaction.editReply({
      embeds: [errorEmbed('No favour categories defined. Staff must run `/favour category-create` first.')],
    });
    return;
  }
  const category = allCategories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase())
    ?? allCategories.find((c) => c.name.toLowerCase().includes(categoryName.toLowerCase()));
  if (!category) {
    await interaction.editReply({ embeds: [errorEmbed(`No favour category matching "${categoryName}".`)] });
    return;
  }

  let targets: { id: string; characterName: string | null }[] = [];
  let groupLabel = '';

  if (partyName) {
    const allParties = await db
      .select({ id: parties.id, name: parties.name })
      .from(parties)
      .where(eq(parties.isActive, true));
    const party = allParties.find((p) => p.name.toLowerCase() === partyName.toLowerCase())
      ?? allParties.find((p) => p.name.toLowerCase().includes(partyName.toLowerCase()));
    if (!party) {
      await interaction.editReply({ embeds: [errorEmbed(`Party "${partyName}" not found.`)] });
      return;
    }
    targets = await db
      .select({ id: players.id, characterName: players.characterName })
      .from(players)
      .where(and(eq(players.partyId, party.id), eq(players.isActive, true), eq(players.isAlive, true)));
    groupLabel = `party **${party.name}**`;
  } else if (officeName) {
    const allOffices = await db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(eq(offices.isActive, true));
    const office = allOffices.find((o) => o.name.toLowerCase() === officeName.toLowerCase())
      ?? allOffices.find((o) => o.name.toLowerCase().includes(officeName.toLowerCase()));
    if (!office) {
      await interaction.editReply({ embeds: [errorEmbed(`Office "${officeName}" not found.`)] });
      return;
    }
    const rows = await db
      .select({ id: players.id, characterName: players.characterName })
      .from(officeHolders)
      .innerJoin(players, eq(officeHolders.playerId, players.id))
      .where(and(eq(officeHolders.officeId, office.id), isNull(officeHolders.endDate)));
    const seen = new Set<string>();
    targets = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    groupLabel = `office **${office.name}**`;
  }

  if (targets.length === 0) {
    await interaction.editReply({ embeds: [errorEmbed(`No active recipients found in ${groupLabel}.`)] });
    return;
  }

  let succeeded = 0;
  const failures: string[] = [];

  try {
    await db.transaction(async (tx) => {
      for (const target of targets) {
        let [balanceRow] = await tx
          .select()
          .from(favourBalances)
          .where(and(eq(favourBalances.playerId, target.id), eq(favourBalances.categoryId, category.id)))
          .limit(1);

        if (!balanceRow) {
          [balanceRow] = await tx.insert(favourBalances).values({
            playerId: target.id,
            categoryId: category.id,
            balance: 0,
          }).returning();
        }

        const newBalance = balanceRow.balance + amount;

        await tx
          .update(favourBalances)
          .set({ balance: newBalance, updatedAt: new Date() })
          .where(eq(favourBalances.id, balanceRow.id));

        await tx.insert(favourTransactions).values({
          playerId: target.id,
          categoryId: category.id,
          amount,
          balanceAfter: newBalance,
          type: FavourTransactionType.GRANT,
          reason: reason ? `[bulk: ${groupLabel.replace(/\*\*/g, '')}] ${reason}` : `[bulk: ${groupLabel.replace(/\*\*/g, '')}]`,
          grantedById: staffPlayer.id,
        });

        succeeded++;
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bulk grant failed';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
    return;
  }

  const emoji = category.emoji ? `${category.emoji} ` : '';
  const totalGranted = succeeded * amount;

  const description = [
    `${emoji}Granted **${amount}** ${category.name} favour${amount === 1 ? '' : 's'} to **${succeeded}** recipient${succeeded === 1 ? '' : 's'} in ${groupLabel}.`,
    `**Total favours distributed:** ${totalGranted}`,
    reason ? `**Reason:** ${reason}` : '',
    failures.length > 0 ? `\n**Failures (${failures.length}):**\n${failures.slice(0, 10).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  await postStaffActionLog(interaction, {
    title: 'Bulk Favours Granted',
    system: 'favours',
    fields: [
      { name: 'Scope', value: groupLabel.replace(/\*\*/g, ''), inline: true },
      { name: 'Category', value: category.name, inline: true },
      { name: 'Recipients', value: `${succeeded}`, inline: true },
      { name: 'Amount Each', value: `+${amount}`, inline: true },
      { name: 'Total Granted', value: `${totalGranted}`, inline: true },
      ...(reason ? [{ name: 'Reason', value: reason }] : []),
    ],
  });
  await interaction.editReply({ embeds: [successEmbed('Bulk Favour Grant', description)] });
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await autocompleteFavourCategory(interaction);
}
