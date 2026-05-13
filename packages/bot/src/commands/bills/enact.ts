import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, billStatusLog, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import { postLegislationEmbed } from '../../utils/legislationChannel.js';
import type { Command } from '../../client.js';
import { BillStatus } from '@hansard/shared';

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

/**
 * Statuses from which a bill can be cleanly finalised into law.
 * (Distinct from /bill-repeal and /bills npc-vote — this is the
 * Chancellor's stamp on a bill that has already passed.)
 */
const ENACTABLE_STATUSES = new Set<string>([
  BillStatus.PLAYER_PASSED,
  BillStatus.NPC_PASSED,
]);

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('bill-enact')
    .setDescription('Finalise a passed bill into law (staff or chancellor only)')
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

    // Permission gate — staff bypass, otherwise legislative leader (mapped to bills.edit)
    const allowed = await hasPermission(member, 'bills.edit');
    if (!allowed) {
      await interaction.reply({
        embeds: [errorEmbed('Only staff or the chancellor (legislative leader) can enact bills.')],
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

    if (bill.status === BillStatus.ENACTED || bill.status === BillStatus.ACTIVE) {
      await interaction.editReply({
        embeds: [errorEmbed('This bill has already been enacted.')],
      });
      return;
    }

    if (!ENACTABLE_STATUSES.has(bill.status)) {
      await interaction.editReply({
        embeds: [errorEmbed(`Bill #B-${String(bill.billNumber).padStart(3, '0')} is in status \`${bill.status}\` and cannot be enacted (must be \`player_passed\` or \`npc_passed\`).`)],
      });
      return;
    }

    // Find actor's player record to attribute the change
    const [actor] = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    const changedById = actor?.id ?? bill.authorId;

    try {
      const oldStatus = bill.status;
      const now = new Date();

      await db
        .update(bills)
        .set({
          status: BillStatus.ENACTED,
          enactedAt: now,
          effectiveAt: now,
          updatedAt: now,
        })
        .where(eq(bills.id, bill.id));

      await db.insert(billStatusLog).values({
        billId: bill.id,
        fromStatus: oldStatus,
        toStatus: BillStatus.ENACTED,
        changedById,
        notes: `Enacted by <@${interaction.user.id}>`,
      });

      const padded = String(bill.billNumber).padStart(3, '0');
      const enactedTimestamp = Math.floor(now.getTime() / 1000);
      const sourceLink = bill.googleDocUrl
        ? `\n\n[\u{1F4D6} Read the full text](${bill.googleDocUrl})`
        : '';

      const embed = createEmbed({
        title: bill.title,
        url: bill.googleDocUrl ?? undefined,
        system: 'bills',
        description: [
          `**Bill #B-${padded}** has been enacted and is now law.${sourceLink}`,
          '',
          `*Enacted by <@${interaction.user.id}> · <t:${enactedTimestamp}:F>*`,
        ].join('\n'),
      });

      await postLegislationEmbed({ client: interaction.client, embed });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to enact bill:', error);
      await interaction.editReply({
        embeds: [errorEmbed('Failed to enact the bill due to a database error.')],
      });
    }
  },
};

export default command;
