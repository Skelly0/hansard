import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, players } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import { createLegislativeVoteForBill } from './createVoteFlow.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bill-vote')
    .setDescription('Create a legislature vote on a bill (Chancellor/staff only)')
    .addIntegerOption((opt) =>
      opt
        .setName('bill_number')
        .setDescription('The bill number to put to vote')
        .setRequired(true)
        .setMinValue(1),
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

    // Permission check
    const staffCheck = await isStaff(member);
    if (!staffCheck) {
      await interaction.reply({
        embeds: [errorEmbed('Only the Chancellor or staff can put bills to vote.')],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const billNumber = interaction.options.getInteger('bill_number', true);

    // Find the bill
    const [bill] = await db
      .select()
      .from(bills)
      .where(eq(bills.billNumber, billNumber))
      .limit(1);

    if (!bill) {
      await interaction.editReply({
        embeds: [errorEmbed(`Bill #${billNumber} not found.`)],
      });
      return;
    }

    if (bill.status !== 'submitted') {
      await interaction.editReply({
        embeds: [errorEmbed(`Bill #${billNumber} is not in 'submitted' status (current: \`${bill.status}\`). Only submitted bills can be put to vote.`)],
      });
      return;
    }

    // Find the submitter's player record
    const [player] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!player) {
      await interaction.editReply({
        embeds: [errorEmbed('You need to create a character first.')],
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
        createdById: player.id,
        now,
      });

      const embed = successEmbed(
        'Vote Created',
        [
          `**${bill.title}** (Bill #\`${bill.billNumber}\`)`,
          '',
          `A legislative vote has been opened.`,
          `**Method:** Yea / Nay / Abstain (simple majority)`,
          `**Closes:** <t:${Math.floor(election.votingClosesAt.getTime() / 1000)}:F>`,
          '',
          `Use the voting commands to cast ballots.`,
        ].join('\n'),
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to create vote on bill:', error);
      await interaction.editReply({
        embeds: [errorEmbed('Failed to create the vote due to a database error.')],
      });
    }
  },
};

export default command;
