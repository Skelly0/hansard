import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { hasPermission } from '../../utils/permissions.js';
import type { Command } from '../../client.js';
import type { EstimatedEffects } from '@hansard/shared';

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
    .setName('bill-amend-effects')
    .setDescription('Adjust the estimated effects of a passed bill (staff or chancellor only)')
    .addStringOption((opt) =>
      opt
        .setName('bill')
        .setDescription('Bill number (e.g. B-001) or title')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('effects')
        .setDescription('Free-form effect text (multi-line supported)')
        .setRequired(true)
        .setMaxLength(4000),
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
        embeds: [errorEmbed('Only staff or the chancellor (legislative leader) can adjust bill effects.')],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const billArg = interaction.options.getString('bill', true);
    const effectsText = interaction.options.getString('effects', true);

    const bill = await resolveBill(billArg);
    if (!bill) {
      await interaction.editReply({
        embeds: [errorEmbed(`Could not find a bill matching \`${billArg}\`. Provide a bill number (e.g. \`B-001\`) or title.`)],
      });
      return;
    }

    try {
      // Merge with any existing structured effects, replacing the free-form notes.
      const existing = (bill.estimatedEffects as EstimatedEffects | null) ?? null;
      const merged: EstimatedEffects = {
        ...(existing ?? {}),
        notes: effectsText,
      };

      await db
        .update(bills)
        .set({
          estimatedEffects: merged,
          updatedAt: new Date(),
        })
        .where(eq(bills.id, bill.id));

      const padded = String(bill.billNumber).padStart(3, '0');

      // Truncate effects in display if very long
      const displayEffects = effectsText.length > 1500
        ? effectsText.slice(0, 1490) + '\n…'
        : effectsText;

      const embed = createEmbed({
        title: 'Bill Effects Updated',
        system: 'bills',
        description: [
          `**${bill.title}** (Bill #\`B-${padded}\`)`,
          '',
          `\u{1F4DD} Estimated effects updated by <@${interaction.user.id}>.`,
          '',
          '**New effects:**',
          '```',
          displayEffects,
          '```',
        ].join('\n'),
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to update bill effects:', error);
      await interaction.editReply({
        embeds: [errorEmbed('Failed to update bill effects due to a database error.')],
      });
    }
  },
};

export default command;
