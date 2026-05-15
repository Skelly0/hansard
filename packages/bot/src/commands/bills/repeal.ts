import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import {
  editLegislationEmbed,
  postLegislationEmbed,
} from '../../utils/legislationChannel.js';
import { BillStatus } from '@hansard/shared';
import { repealBill } from './repealFlow.js';
import {
  buildRepealEditEmbed,
  buildRepealFallbackEmbed,
  type RepealEmbedInput,
} from './repealEmbeds.js';

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

/** Statuses considered "passed" and therefore repealable. */
const REPEALABLE_STATUSES = new Set<string>([
  BillStatus.ENACTED,
  BillStatus.ACTIVE,
  BillStatus.AMENDED,
  BillStatus.NPC_PASSED,
  BillStatus.PLAYER_PASSED,
]);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (!member) {
    await interaction.reply({
      embeds: [errorEmbed('Could not resolve your guild membership.')],
      ephemeral: true,
    });
    return;
  }

  // Permission gate — staff bypass, otherwise needs legislative_leader-equivalent
  // (mapped to the closest existing Permission key, bills.delete)
  const allowed = await hasPermission(member, 'bills.delete');
  if (!allowed) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff or the chancellor (legislative leader) can repeal bills.')],
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

  if (!REPEALABLE_STATUSES.has(bill.status)) {
    await interaction.editReply({
      embeds: [errorEmbed(`Bill #B-${String(bill.billNumber).padStart(3, '0')} is in status \`${bill.status}\` and cannot be repealed (only passed/enacted/active bills are repealable).`)],
    });
    return;
  }

  if (bill.status === BillStatus.REPEALED) {
    await interaction.editReply({
      embeds: [errorEmbed('This bill has already been repealed.')],
    });
    return;
  }

  // Find the actor's player record to attribute the change
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
    const oldStatus = bill.status;
    const now = new Date();

    // Wrap the status flip + audit log in a transaction with a WHERE
    // status = oldStatus guard so concurrent status drift cannot silently
    // overwrite the bill.
    await repealBill(db, {
      billId: bill.id,
      expectedStatus: oldStatus,
      changedById,
      actorDiscordId: interaction.user.id,
      now,
    });

    const embedInput: RepealEmbedInput = {
      bill,
      authorDisplay,
      previousStatus: oldStatus,
      actorDiscordId: interaction.user.id,
      now,
    };

    // Prefer editing the original /bill enact post in place so the legislation
    // channel reads as a continuous historical record. Fall back to posting a
    // fresh notice when the bill predates message-id capture or when the edit
    // fails (channel deleted, message purged, permissions missing, etc.).
    const editResult = await editLegislationEmbed({
      client: interaction.client,
      embed: buildRepealEditEmbed(embedInput),
      channelId: bill.legislationChannelId,
      messageId: bill.legislationMessageId,
    });

    let postedFresh = false;
    if (editResult.status !== 'edited') {
      await postLegislationEmbed({
        client: interaction.client,
        embed: buildRepealFallbackEmbed(embedInput),
      });
      postedFresh = true;
    }

    const padded = String(bill.billNumber).padStart(3, '0');
    const repealedTimestamp = Math.floor(now.getTime() / 1000);
    const channelOutcome = editResult.status === 'edited'
      ? `Edited the original enactment post in the legislation channel.`
      : postedFresh
        ? `No stored enactment post; posted a fresh repeal notice in the legislation channel.`
        : `Skipped legislation channel update.`;

    const replyEmbed = createEmbed({
      title: 'Bill Repealed',
      system: 'bills',
      description: [
        `**${bill.title}** (Bill #\`B-${padded}\`)`,
        '',
        `\u{1F6AB} This bill has been **repealed**.`,
        '',
        `**Previous status:** ${oldStatus}`,
        `**Repealed by:** <@${interaction.user.id}>`,
        `**Repealed at:** <t:${repealedTimestamp}:F>`,
        '',
        `_${channelOutcome}_`,
      ].join('\n'),
    });

    await interaction.editReply({ embeds: [replyEmbed] });
  } catch (error) {
    console.error('Failed to repeal bill:', error);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to repeal the bill due to a database error.')],
    });
  }
}
