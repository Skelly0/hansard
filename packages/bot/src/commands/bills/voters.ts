import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills } from '@hansard/db';
import { getVoters as getBillVoters } from '@hansard/api/services/billService';
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
  await interaction.deferReply({ ephemeral: true });

  const billArg = interaction.options.getString('bill', true);
  const actorIsStaff = !!interaction.member && (await isStaff(interaction.member as any));

  const bill = await resolveBill(billArg);
  if (!bill) {
    await interaction.editReply({
      embeds: [errorEmbed(`Could not find a bill matching \`${billArg}\`. Provide a bill number (e.g. \`B-001\`) or title.`)],
    });
    return;
  }

  const padded = String(bill.billNumber).padStart(3, '0');

  if (!bill.playerVoteId) {
    await interaction.editReply({
      embeds: [errorEmbed(`No legislative vote has been held on Bill #B-${padded} yet.`)],
    });
    return;
  }

  const voters = await getBillVoters(db, bill.slug, {
    userId: interaction.user.id,
    isStaff: actorIsStaff,
  });
  if (!voters) {
    await interaction.editReply({
      embeds: [errorEmbed(`Could not load voters for Bill #B-${padded}.`)],
    });
    return;
  }

  const yeas: string[] = [];
  const nays: string[] = [];
  const abstains: string[] = [];
  const other: string[] = [];

  for (const row of voters.playerVotes) {
    const tag = row.characterName ?? 'Unknown';
    const choice = row.choice;

    if (choice === 'yea') yeas.push(tag);
    else if (choice === 'nay') nays.push(tag);
    else if (choice === 'abstain') abstains.push(tag);
    else other.push(`${tag} _(${choice ?? 'unknown'})_`);
  }

  const formatList = (list: string[]): string =>
    list.length === 0 ? '_none_' : list.map((n) => `• ${n}`).join('\n');

  const fields = [
    {
      name: `✅ Yea (${yeas.length})`,
      value: formatList(yeas).slice(0, 1024),
      inline: false,
    },
    {
      name: `❌ Nay (${nays.length})`,
      value: formatList(nays).slice(0, 1024),
      inline: false,
    },
    {
      name: `⚪ Abstain (${abstains.length})`,
      value: formatList(abstains).slice(0, 1024),
      inline: false,
    },
  ];

  if (other.length > 0) {
    fields.push({
      name: `Other (${other.length})`,
      value: formatList(other).slice(0, 1024),
      inline: false,
    });
  }

  const total = yeas.length + nays.length + abstains.length + other.length;

  const embed = createEmbed({
    title: `Voters — Bill #B-${padded}`,
    system: 'voting',
    description: [
      `**${bill.title}**`,
      `**Total ballots cast:** ${total}`,
      voters.playerVotes.length === 0 && !actorIsStaff
        ? '_Named ballots are hidden until the linked vote is public._'
        : null,
      actorIsStaff ? `**Election:** \`${bill.playerVoteId}\`` : null,
    ].join('\n'),
    fields,
  });

  await interaction.editReply({ embeds: [embed] });
}
