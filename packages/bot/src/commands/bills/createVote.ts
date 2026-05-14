import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import { BillStatus } from '@hansard/shared';
import { createLegislativeVoteForBill } from './createVoteFlow.js';

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

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bill-create-vote')
    .setDescription('Spawn a legislature vote on a bill (Chancellor only)')
    .addStringOption((opt) =>
      opt
        .setName('bill')
        .setDescription('Bill number (e.g. B-001) or title')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.guild?.members.cache.get(interaction.user.id);
    if (!member) {
      await interaction.reply({
        embeds: [errorEmbed('Could not resolve your guild membership.')],
        ephemeral: true,
      });
      return;
    }

    // Permission gate — staff bypass, otherwise legislative leader (mapped to voting.create)
    const allowed = await hasPermission(member, 'voting.create');
    if (!allowed) {
      await interaction.reply({
        embeds: [errorEmbed('Only staff or the chancellor (legislative leader) can call a legislature vote.')],
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

    if (bill.status !== BillStatus.SUBMITTED) {
      await interaction.editReply({
        embeds: [errorEmbed(`Bill #B-${String(bill.billNumber).padStart(3, '0')} is in status \`${bill.status}\` — only \`submitted\` bills can be put to a vote.`)],
      });
      return;
    }

    // Find actor's player record (required as elections.createdById)
    const [actor] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!actor) {
      await interaction.editReply({
        embeds: [errorEmbed('You need a registered character to create a legislature vote. Use `/character create`.')],
      });
      return;
    }

    try {
      const now = new Date();

      const { election } = await createLegislativeVoteForBill(db, {
        billId: bill.id,
        billTitle: bill.title,
        billNumber: bill.billNumber,
        billSummary: bill.summary,
        expectedStatus: bill.status,
        createdById: actor.id,
        now,
      });

      const padded = String(bill.billNumber).padStart(3, '0');

      const embed = createEmbed({
        title: 'Legislature Vote Opened',
        system: 'voting',
        description: [
          `**${bill.title}** (Bill #\`B-${padded}\`)`,
          '',
          `\u{1F5F3}\u{FE0F} A yea / nay / abstain vote has been opened.`,
          '',
          `**Election ID:** \`${election.id}\``,
          `**Opens:** <t:${Math.floor(election.votingOpensAt.getTime() / 1000)}:F>`,
          `**Closes:** <t:${Math.floor(election.votingClosesAt.getTime() / 1000)}:F>`,
          `**Called by:** <@${interaction.user.id}>`,
        ].join('\n'),
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to create legislature vote:', error);
      await interaction.editReply({
        embeds: [errorEmbed('Failed to create the legislature vote due to a database error.')],
      });
    }
  },
};

export default command;
