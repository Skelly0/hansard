import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { bills } from '@hansard/db';
import { db } from '../../db.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { formatBillStatus } from './shared.js';
import { reraiseBillForVote } from './reraiseFlow.js';

interface BillReference {
  id: string;
  title: string;
  billNumber: number;
}

async function resolveBill(input: string): Promise<BillReference | null> {
  const trimmed = input.trim();

  const bMatch = trimmed.match(/^B-?0*(\d+)$/i);
  if (bMatch) {
    const num = Number(bMatch[1]);
    if (Number.isInteger(num) && num > 0) {
      const [bill] = await db
        .select({
          id: bills.id,
          title: bills.title,
          billNumber: bills.billNumber,
        })
        .from(bills)
        .where(eq(bills.billNumber, num))
        .limit(1);
      if (bill) return bill;
    }
  }

  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    const [bill] = await db
      .select({
        id: bills.id,
        title: bills.title,
        billNumber: bills.billNumber,
      })
      .from(bills)
      .where(eq(bills.billNumber, asNumber))
      .limit(1);
    if (bill) return bill;
  }

  const [byTitle] = await db
    .select({
      id: bills.id,
      title: bills.title,
      billNumber: bills.billNumber,
    })
    .from(bills)
    .where(ilike(bills.title, trimmed))
    .limit(1);
  if (byTitle) return byTitle;

  const [byPartial] = await db
    .select({
      id: bills.id,
      title: bills.title,
      billNumber: bills.billNumber,
    })
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

  const allowed = await hasPermission(member, 'voting.create');
  if (!allowed) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff or the chancellor (legislative leader) can re-raise bills.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const billArg = interaction.options.getString('bill', true);
  const reason = interaction.options.getString('reason', false);

  const bill = await resolveBill(billArg);
  if (!bill) {
    await interaction.editReply({
      embeds: [errorEmbed(`Could not find a bill matching \`${billArg}\`. Provide a bill number (e.g. \`B-001\`) or title.`)],
    });
    return;
  }

  try {
    const result = await reraiseBillForVote(db, {
      billId: bill.id,
      actorDiscordId: interaction.user.id,
      reason,
    });

    const padded = String(result.bill.billNumber).padStart(3, '0');
    const embed = createEmbed({
      title: 'Bill Re-raised',
      system: 'bills',
      description: [
        `**${result.bill.title}** (Bill #\`B-${padded}\`)`,
        '',
        'The mistaken linked legislative vote has been cancelled and this bill is back in the submitted queue.',
        '',
        `**Previous bill status:** ${formatBillStatus(result.previousBillStatus)}`,
        `**Current bill status:** ${formatBillStatus(result.bill.status)}`,
        `**Cancelled vote:** \`${result.election.id}\` (${result.previousElectionStatus})`,
        `**Re-raised by:** <@${interaction.user.id}>`,
        reason ? `**Reason:** ${reason}` : null,
      ]
        .filter((line): line is string => line != null)
        .join('\n'),
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to re-raise bill:', error);
    const message = error instanceof Error
      ? error.message
      : 'Failed to re-raise the bill due to a database error.';
    await interaction.editReply({
      embeds: [errorEmbed(message)],
    });
  }
}
