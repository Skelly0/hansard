import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, ilike, asc } from 'drizzle-orm';
import { db } from '../../db.js';
import { ballots, bills, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

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
    .setName('bill-voters')
    .setDescription("Show who voted yea / nay / abstain on a bill's most recent legislative vote")
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

    const padded = String(bill.billNumber).padStart(3, '0');

    if (!bill.playerVoteId) {
      await interaction.editReply({
        embeds: [errorEmbed(`No legislative vote has been held on Bill #B-${padded} yet.`)],
      });
      return;
    }

    // Pull ballots for the linked election, joining players for character names
    const rows = await db
      .select({
        voterId: ballots.voterId,
        vote: ballots.vote,
        castAt: ballots.castAt,
        characterName: players.characterName,
        discordId: players.discordId,
      })
      .from(ballots)
      .leftJoin(players, eq(ballots.voterId, players.id))
      .where(eq(ballots.electionId, bill.playerVoteId))
      .orderBy(asc(ballots.castAt));

    const yeas: string[] = [];
    const nays: string[] = [];
    const abstains: string[] = [];
    const other: string[] = [];

    for (const row of rows) {
      const vote = row.vote as { type?: string; choice?: string };
      const name = row.characterName ?? 'Unknown';
      const tag = row.discordId ? `${name} (<@${row.discordId}>)` : name;
      const choice = vote?.choice;

      if (choice === 'yea') yeas.push(tag);
      else if (choice === 'nay') nays.push(tag);
      else if (choice === 'abstain') abstains.push(tag);
      else other.push(`${tag} _(${choice ?? vote?.type ?? 'unknown'})_`);
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
        `**Election:** \`${bill.playerVoteId}\``,
      ].join('\n'),
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
