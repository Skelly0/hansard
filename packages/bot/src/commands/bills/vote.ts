import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, billStatusLog, elections, players } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

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
      // Create a yea/nay/abstain election linked to this bill
      const now = new Date();
      const votingCloses = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const [election] = await db
        .insert(elections)
        .values({
          title: `Vote on: ${bill.title}`,
          description: bill.summary ?? `Legislative vote on Bill #${bill.billNumber}: ${bill.title}`,
          type: 'legislative_vote',
          method: 'yea_nay_abstain',
          requiredPermission: 'legislative_leader',
          config: {
            majorityType: 'simple',
            passThreshold: 0.5,
            anonymousBallots: false,
            sealedResults: false,
          },
          relatedBillId: bill.id,
          createdById: player.id,
          status: 'voting_open',
          votingOpensAt: now,
          votingClosesAt: votingCloses,
        })
        .returning();

      // Update bill status
      await db
        .update(bills)
        .set({
          status: 'voting',
          playerVoteId: election.id,
          updatedAt: now,
        })
        .where(eq(bills.id, bill.id));

      // Log status change
      await db.insert(billStatusLog).values({
        billId: bill.id,
        fromStatus: 'submitted',
        toStatus: 'voting',
        changedById: player.id,
        notes: `Legislature vote created (election ${election.id})`,
      });

      const embed = successEmbed(
        'Vote Created',
        [
          `**${bill.title}** (Bill #\`${bill.billNumber}\`)`,
          '',
          `A legislative vote has been opened.`,
          `**Method:** Yea / Nay / Abstain (simple majority)`,
          `**Closes:** <t:${Math.floor(votingCloses.getTime() / 1000)}:F>`,
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
