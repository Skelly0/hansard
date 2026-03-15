import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';
import { formatBillStatus, statusEmoji } from './shared.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bill-view')
    .setDescription('View details of a bill')
    .addIntegerOption((opt) =>
      opt
        .setName('bill_number')
        .setDescription('The bill number to look up')
        .setRequired(true)
        .setMinValue(1),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const billNumber = interaction.options.getInteger('bill_number', true);

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

    // Fetch author info
    let authorName = 'Unknown';
    let authorDiscordId: string | null = null;
    const [author] = await db
      .select({
        characterName: players.characterName,
        discordId: players.discordId,
      })
      .from(players)
      .where(eq(players.id, bill.authorId))
      .limit(1);

    if (author) {
      authorName = author.characterName ?? 'Unknown';
      authorDiscordId = author.discordId;
    }

    const status = formatBillStatus(bill.status);
    const emoji = statusEmoji(bill.status);

    const fields = [
      { name: 'Bill Number', value: `\`#${bill.billNumber}\``, inline: true },
      { name: 'Status', value: `${emoji} ${status}`, inline: true },
      {
        name: 'Author',
        value: authorDiscordId ? `${authorName} (<@${authorDiscordId}>)` : authorName,
        inline: true,
      },
      {
        name: 'Google Doc',
        value: `[View Document](${bill.googleDocUrl})`,
        inline: true,
      },
      {
        name: 'Submitted',
        value: `<t:${Math.floor(bill.submittedAt.getTime() / 1000)}:R>`,
        inline: true,
      },
    ];

    // Add tags if present
    const tags = (bill.tags as string[] | null) ?? [];
    if (tags.length > 0) {
      fields.push({
        name: 'Tags',
        value: tags.map((t) => `\`${t}\``).join(', '),
        inline: true,
      });
    }

    // Add policy areas if present
    const policyAreas = (bill.policyAreas as string[] | null) ?? [];
    if (policyAreas.length > 0) {
      fields.push({
        name: 'Policy Areas',
        value: policyAreas.join(', '),
        inline: true,
      });
    }

    // Add NPC vote result if present
    const npcVote = bill.npcVote as {
      status: string;
      tally?: { yea: number; nay: number; abstain: number };
      notes?: string;
    } | null;

    if (npcVote?.tally) {
      fields.push({
        name: 'NPC House Vote',
        value: `${npcVote.status === 'passed' ? '\u{2705}' : '\u{274C}'} ${npcVote.tally.yea} yea / ${npcVote.tally.nay} nay / ${npcVote.tally.abstain} abstain${npcVote.notes ? `\n*${npcVote.notes}*` : ''}`,
        inline: false,
      });
    }

    // Add enacted/repealed timestamps
    if (bill.enactedAt) {
      fields.push({
        name: 'Enacted',
        value: `<t:${Math.floor(bill.enactedAt.getTime() / 1000)}:D>`,
        inline: true,
      });
    }
    if (bill.repealedAt) {
      fields.push({
        name: 'Repealed',
        value: `<t:${Math.floor(bill.repealedAt.getTime() / 1000)}:D>`,
        inline: true,
      });
    }

    const embed = createEmbed({
      title: bill.title,
      description: bill.summary ? `> ${bill.summary}` : undefined,
      system: 'bills',
      url: bill.googleDocUrl,
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
