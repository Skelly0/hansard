import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';

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

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (!member) {
    await interaction.reply({
      embeds: [errorEmbed('Could not resolve your guild membership.')],
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

  // Permission gate: must be the bill's author or staff
  const [actor] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  const isAuthor = actor && actor.id === bill.authorId;
  const staff = await isStaff(member);

  if (!staff && !isAuthor) {
    await interaction.editReply({
      embeds: [errorEmbed("Only the bill's author or staff can request a re-cache.")],
    });
    return;
  }

  if (!bill.googleDocId) {
    await interaction.editReply({
      embeds: [errorEmbed('This bill has no Google Doc ID — nothing to re-cache.')],
    });
    return;
  }

  // The bot package does NOT import @hansard/api or googleDocService —
  // the live fetch path lives in the API service. As a fallback we clear
  // the existing cache timestamp so a worker / API-side job can re-pull.
  // TODO: When googleDocService (or an equivalent worker) is available
  // from the bot, call it directly instead of just flagging.
  try {
    const now = new Date();
    await db
      .update(bills)
      .set({
        cachedContent: null,
        cachedAt: null,
        updatedAt: now,
      })
      .where(eq(bills.id, bill.id));

    const padded = String(bill.billNumber).padStart(3, '0');

    const embed = createEmbed({
      title: 'Re-cache Requested',
      system: 'bills',
      description: [
        `**${bill.title}** (Bill #\`B-${padded}\`)`,
        '',
        `\u{1F501} Cached content cleared. The next run of the doc-cache worker (or the API \`POST /api/bills/${bill.slug}/cache\` route) will re-pull from the Google Doc.`,
        '',
        `**Google Doc:** [View Document](${bill.googleDocUrl})`,
        `**Requested by:** <@${interaction.user.id}>`,
      ].join('\n'),
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to flag bill for re-cache:', error);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to flag the bill for re-cache due to a database error.')],
    });
  }
}
