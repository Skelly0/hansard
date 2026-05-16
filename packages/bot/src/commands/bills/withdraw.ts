import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { formatBillStatus } from './shared.js';
import { withdrawSubmittedBill } from './withdrawFlow.js';

interface BillReference {
  id: string;
  title: string;
  billNumber: number;
}

function formatBillNumber(billNumber: number): string {
  return `B-${String(billNumber).padStart(3, '0')}`;
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
    const result = await withdrawSubmittedBill(db, {
      billId: bill.id,
      actorDiscordId: interaction.user.id,
      reason,
    });

    const embed = createEmbed({
      title: 'Bill Withdrawn',
      system: 'bills',
      colour: 0x8A6F5A,
      description: [
        `**${result.bill.title}** (Bill #\`${formatBillNumber(result.bill.billNumber)}\`)`,
        '',
        'This bill has been withdrawn and will no longer be eligible for a legislature vote.',
        '',
        `**Previous status:** ${formatBillStatus(result.previousStatus)}`,
        `**Current status:** ${formatBillStatus(result.bill.status)}`,
        `**Withdrawn by:** <@${interaction.user.id}>`,
        reason?.trim() ? `**Reason:** ${reason.trim()}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Failed to withdraw the bill due to a database error.';
    await interaction.editReply({
      embeds: [errorEmbed(message)],
    });
  }
}
