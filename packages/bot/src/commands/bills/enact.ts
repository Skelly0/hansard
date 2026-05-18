import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, players } from '@hansard/db';
import { errorEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { BillStatus } from '@hansard/shared';
import {
  enactAndPostBill,
  LegislationPostError,
  postExistingEnactedBill,
} from './autoEnact.js';

/**
 * Resolve a bill by either bill number (e.g. "B-001", "1") or title.
 */
async function resolveBill(input: string): Promise<
  typeof bills.$inferSelect | null
> {
  const trimmed = input.trim();

  const bMatch = trimmed.match(/^B-?0*(\d+)$/i);
  if (bMatch) {
    const num = Number(bMatch[1]);
    if (Number.isInteger(num) && num > 0) {
      const [bill] = await db
        .select()
        .from(bills)
        .where(eq(bills.billNumber, num))
        .limit(1);
      if (bill) return bill;
    }
  }

  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    const [bill] = await db
      .select()
      .from(bills)
      .where(eq(bills.billNumber, asNumber))
      .limit(1);
    if (bill) return bill;
  }

  const [byTitle] = await db
    .select()
    .from(bills)
    .where(ilike(bills.title, trimmed))
    .limit(1);
  if (byTitle) return byTitle;

  const [byPartial] = await db
    .select()
    .from(bills)
    .where(ilike(bills.title, `%${trimmed}%`))
    .limit(1);
  return byPartial ?? null;
}

/**
 * Statuses from which a bill can be cleanly finalised into law.
 * (Distinct from /bill repeal and /bill npc-vote — this is the
 * Chancellor's stamp, including direct enactment before a house vote.)
 */
const ENACTABLE_STATUSES = new Set<string>([
  BillStatus.SUBMITTED,
  BillStatus.PLAYER_PASSED,
  BillStatus.NPC_PASSED,
]);

function formatEnactFailure(error: unknown, mode: 'enact' | 'repair' = 'enact'): string {
  if (error instanceof LegislationPostError) {
    return mode === 'repair'
      ? 'Failed to post the missing legislation message. The bill is still marked enacted.'
      : 'Failed to post the legislation message, so the bill was not enacted.';
  }

  return mode === 'repair'
    ? 'Failed to repair the legislation message due to a database error.'
    : 'Failed to enact the bill due to a database error.';
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (!member) {
    await interaction.reply({
      embeds: [errorEmbed('Could not resolve your guild membership.')],
      ephemeral: true,
    });
    return;
  }

  // Permission gate — staff bypass, otherwise legislative leader (mapped to bills.edit)
  const allowed = await hasPermission(member, 'bills.edit');
  if (!allowed) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff or the chancellor (legislative leader) can enact bills.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const billArg = interaction.options.getString('bill', true);

  const bill = await resolveBill(billArg);
  if (!bill) {
    await interaction.editReply({
      embeds: [errorEmbed(`Could not find a bill matching \`${billArg}\`. Provide a bill number (e.g. \`B-001\`) or title.`)],
    });
    return;
  }

  if (bill.status === BillStatus.ENACTED || bill.status === BillStatus.ACTIVE) {
    if (!bill.legislationChannelId || !bill.legislationMessageId) {
      const [billAuthor] = await db
        .select({
          characterName: players.characterName,
          discordId: players.discordId,
        })
        .from(players)
        .where(eq(players.id, bill.authorId))
        .limit(1);

      const authorName = billAuthor?.characterName ?? 'Unknown';
      const authorDisplay = billAuthor?.discordId
        ? `${authorName} (<@${billAuthor.discordId}>)`
        : authorName;

      try {
        const { embed } = await postExistingEnactedBill({
          database: db,
          client: interaction.client,
          bill,
          authorDisplay,
          now: bill.enactedAt ?? new Date(),
        });

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Failed to repair enacted bill legislation post:', error);
        await interaction.editReply({
          embeds: [errorEmbed(formatEnactFailure(error, 'repair'))],
        });
      }
      return;
    }

    await interaction.editReply({
      embeds: [errorEmbed('This bill has already been enacted.')],
    });
    return;
  }

  if (!ENACTABLE_STATUSES.has(bill.status)) {
    await interaction.editReply({
      embeds: [errorEmbed(`Bill #B-${String(bill.billNumber).padStart(3, '0')} is in status \`${bill.status}\` and cannot be enacted (must be \`submitted\`, \`player_passed\`, or \`npc_passed\`).`)],
    });
    return;
  }

  // Find actor's player record to attribute the change
  const [actor] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  const changedById = actor?.id ?? bill.authorId;

  // Resolve the bill's author for display attribution
  const [billAuthor] = await db
    .select({
      characterName: players.characterName,
      discordId: players.discordId,
    })
    .from(players)
    .where(eq(players.id, bill.authorId))
    .limit(1);

  const authorName = billAuthor?.characterName ?? 'Unknown';
  const authorDisplay = billAuthor?.discordId
    ? `${authorName} (<@${billAuthor.discordId}>)`
    : authorName;

  try {
    const now = new Date();

    const { embed } = await enactAndPostBill({
      database: db,
      client: interaction.client,
      bill,
      authorDisplay,
      changedById,
      actorDiscordId: interaction.user.id,
      now,
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to enact bill:', error);
    await interaction.editReply({
      embeds: [errorEmbed(formatEnactFailure(error))],
    });
  }
}
