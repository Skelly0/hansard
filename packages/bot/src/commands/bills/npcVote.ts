import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, players } from '@hansard/db';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import type { NpcVote } from '@hansard/shared';
import { recordNpcVote } from './npcVoteFlow.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('npc-bill')
    .setDescription('Enter NPC house vote result on a bill (staff only)')
    .addIntegerOption((opt) =>
      opt
        .setName('bill_number')
        .setDescription('The bill number')
        .setRequired(true)
        .setMinValue(1),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('yea')
        .setDescription('Number of yea votes')
        .setRequired(true)
        .setMinValue(0),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('nay')
        .setDescription('Number of nay votes')
        .setRequired(true)
        .setMinValue(0),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('abstain')
        .setDescription('Number of abstentions')
        .setRequired(true)
        .setMinValue(0),
    )
    .addStringOption((opt) =>
      opt
        .setName('notes')
        .setDescription('Optional notes about the NPC vote')
        .setRequired(false)
        .setMaxLength(500),
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

    // Staff only
    const staffCheck = await isStaff(member);
    if (!staffCheck) {
      await interaction.reply({
        embeds: [errorEmbed('Only staff can enter NPC house vote results.')],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const billNumber = interaction.options.getInteger('bill_number', true);
    const yea = interaction.options.getInteger('yea', true);
    const nay = interaction.options.getInteger('nay', true);
    const abstain = interaction.options.getInteger('abstain', true);
    const notes = interaction.options.getString('notes') ?? null;

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

    // Find staff player record
    const [player] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    const enteredById = player?.id ?? bill.authorId; // fallback if staff has no player record

    try {
      const total = yea + nay + abstain;
      const passed = yea > nay;

      const npcVote: NpcVote = {
        status: passed ? 'passed' : 'rejected',
        tally: { yea, nay, abstain, total },
        decidedAt: new Date().toISOString(),
        enteredById,
        notes: notes ?? undefined,
      };

      const oldStatus = bill.status;
      const newStatus = passed ? 'npc_passed' : 'npc_rejected';

      // Wrap the bill status flip + audit log in a transaction with a
      // WHERE status = oldStatus guard so concurrent status drift cannot
      // silently overwrite the bill.
      await recordNpcVote(db, {
        billId: bill.id,
        expectedStatus: oldStatus,
        newStatus,
        npcVote,
        enteredById,
        notes: `NPC house vote: ${yea} yea / ${nay} nay / ${abstain} abstain${notes ? ` \u2014 ${notes}` : ''}`,
      });

      const resultEmoji = passed ? '\u{2705}' : '\u{274C}';
      const resultText = passed ? 'PASSED' : 'REJECTED';

      const embed = createEmbed({
        title: `NPC House Vote: ${resultText}`,
        description: [
          `**${bill.title}** (Bill #\`${bill.billNumber}\`)`,
          '',
          `${resultEmoji} The NPC house has **${resultText.toLowerCase()}** this bill.`,
          '',
          `**Yea:** ${yea}`,
          `**Nay:** ${nay}`,
          `**Abstain:** ${abstain}`,
          `**Total:** ${total}`,
          notes ? `\n**Notes:** ${notes}` : '',
        ].filter(Boolean).join('\n'),
        system: 'bills',
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to enter NPC vote:', error);
      await interaction.editReply({
        embeds: [errorEmbed('Failed to record the NPC vote due to a database error.')],
      });
    }
  },
};

export default command;
