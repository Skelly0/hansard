import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, ilike, asc } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, billStatusLog, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';
import { formatBillStatus, statusEmoji } from './shared.js';

/**
 * Resolve a bill by either bill number (e.g. "B-001", "1") or by title (case-insensitive).
 */
async function resolveBill(input: string): Promise<
  | { id: string; title: string; billNumber: number; status: string }
  | null
> {
  const trimmed = input.trim();

  // Try as "B-001" format
  const bMatch = trimmed.match(/^B-?0*(\d+)$/i);
  if (bMatch) {
    const num = Number(bMatch[1]);
    if (Number.isInteger(num) && num > 0) {
      const [bill] = await db
        .select({
          id: bills.id,
          title: bills.title,
          billNumber: bills.billNumber,
          status: bills.status,
        })
        .from(bills)
        .where(eq(bills.billNumber, num))
        .limit(1);
      if (bill) return bill;
    }
  }

  // Try as plain integer
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    const [bill] = await db
      .select({
        id: bills.id,
        title: bills.title,
        billNumber: bills.billNumber,
        status: bills.status,
      })
      .from(bills)
      .where(eq(bills.billNumber, asNumber))
      .limit(1);
    if (bill) return bill;
  }

  // Fall back to case-insensitive title match
  const [byTitle] = await db
    .select({
      id: bills.id,
      title: bills.title,
      billNumber: bills.billNumber,
      status: bills.status,
    })
    .from(bills)
    .where(ilike(bills.title, trimmed))
    .limit(1);
  if (byTitle) return byTitle;

  // Last resort: partial title match
  const [byPartial] = await db
    .select({
      id: bills.id,
      title: bills.title,
      billNumber: bills.billNumber,
      status: bills.status,
    })
    .from(bills)
    .where(ilike(bills.title, `%${trimmed}%`))
    .limit(1);
  return byPartial ?? null;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bill-status')
    .setDescription('Show the full status timeline of a bill')
    .addStringOption((opt) =>
      opt
        .setName('bill')
        .setDescription('Bill number (e.g. B-001) or title')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const billArg = interaction.options.getString('bill', true);

    const bill = await resolveBill(billArg);
    if (!bill) {
      await interaction.editReply({
        embeds: [errorEmbed(`Could not find a bill matching \`${billArg}\`. Provide a bill number (e.g. \`B-001\`) or title.`)],
      });
      return;
    }

    // Fetch full status log, oldest first
    const logRows = await db
      .select({
        id: billStatusLog.id,
        fromStatus: billStatusLog.fromStatus,
        toStatus: billStatusLog.toStatus,
        notes: billStatusLog.notes,
        createdAt: billStatusLog.createdAt,
        changedById: billStatusLog.changedById,
        changedByName: players.characterName,
        changedByDiscordId: players.discordId,
      })
      .from(billStatusLog)
      .leftJoin(players, eq(billStatusLog.changedById, players.id))
      .where(eq(billStatusLog.billId, bill.id))
      .orderBy(asc(billStatusLog.createdAt));

    const padded = String(bill.billNumber).padStart(3, '0');
    const currentEmoji = statusEmoji(bill.status);
    const currentStatus = formatBillStatus(bill.status);

    if (logRows.length === 0) {
      const embed = createEmbed({
        title: `Status Timeline — ${bill.title}`,
        system: 'bills',
        description: [
          `**Bill #\`B-${padded}\`** — ${bill.title}`,
          `**Current Status:** ${currentEmoji} ${currentStatus}`,
          '',
          '_No status log entries found for this bill._',
        ].join('\n'),
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Build timeline lines
    const timelineLines = logRows.map((row) => {
      const ts = Math.floor(row.createdAt.getTime() / 1000);
      const toEmoji = statusEmoji(row.toStatus);
      const toLabel = formatBillStatus(row.toStatus);
      const fromLabel = row.fromStatus
        ? `${formatBillStatus(row.fromStatus)} → `
        : '';
      const who = row.changedByDiscordId
        ? `<@${row.changedByDiscordId}>`
        : (row.changedByName ?? 'Unknown');
      const noteLine = row.notes ? `\n   > ${row.notes}` : '';
      return `${toEmoji} **${fromLabel}${toLabel}**\n   <t:${ts}:f> — by ${who}${noteLine}`;
    });

    // Discord embed description max is ~4096 chars; truncate if needed
    let description = [
      `**Bill #\`B-${padded}\`** — ${bill.title}`,
      `**Current Status:** ${currentEmoji} ${currentStatus}`,
      '',
      ...timelineLines,
    ].join('\n');

    if (description.length > 4000) {
      description = description.slice(0, 3990) + '\n…';
    }

    const embed = createEmbed({
      title: `Status Timeline — ${bill.title}`,
      system: 'bills',
      description,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
