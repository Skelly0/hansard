import type { ChatInputCommandInteraction } from 'discord.js';
import { and, eq, ilike } from 'drizzle-orm';
import { db } from '../../db.js';
import { bills, players } from '@hansard/db';
import { BillStatus } from '@hansard/shared';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { SHORT_BILL_TEXT_MAX_LENGTH } from './display.js';

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

type EditableField = 'title' | 'summary' | 'text' | 'policy_areas' | 'tags';

/**
 * Statuses in which a bill's *author* may still edit it. Once a bill is put
 * to a vote its title/summary/text become part of the legislative record —
 * for short bills `cached_content` *is* the enacted law — so only staff may
 * change them afterwards. Amend via `/bill amend`, not by rewriting history.
 */
const AUTHOR_EDITABLE_STATUSES = new Set<string>([BillStatus.SUBMITTED]);

/** Split a comma-separated value into a clean string array. */
function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  if (!member) {
    await interaction.reply({
      embeds: [errorEmbed('Could not resolve your guild membership.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const billArg = interaction.options.getString('bill', true);
  const field = interaction.options.getString('field', true) as EditableField;
  const value = interaction.options.getString('value', true);

  const bill = await resolveBill(billArg);
  if (!bill) {
    await interaction.editReply({
      embeds: [errorEmbed(`Could not find a bill matching \`${billArg}\`. Provide a bill number (e.g. \`B-001\`) or title.`)],
    });
    return;
  }

  // Permission: bill author or staff
  const [actor] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.discordId, interaction.user.id))
    .limit(1);

  const isAuthor = actor && actor.id === bill.authorId;
  const staff = await isStaff(member);

  if (!staff && !isAuthor) {
    await interaction.editReply({
      embeds: [errorEmbed("Only the bill's author or staff can edit bill metadata.")],
    });
    return;
  }

  if (!staff && !AUTHOR_EDITABLE_STATUSES.has(bill.status)) {
    await interaction.editReply({
      embeds: [errorEmbed(
        `This bill is "${bill.status}"; authors can only edit a bill while it is still submitted. Ask staff, or use /bill amend to propose changes to enacted law.`,
      )],
    });
    return;
  }

  // Build update payload
  const now = new Date();
  const setValues: Record<string, unknown> = { updatedAt: now };
  let displayValue: string;

  switch (field) {
    case 'title': {
      const trimmed = value.trim();
      if (trimmed.length === 0 || trimmed.length > 256) {
        await interaction.editReply({
          embeds: [errorEmbed('Title must be between 1 and 256 characters.')],
        });
        return;
      }
      setValues.title = trimmed;
      displayValue = trimmed;
      break;
    }
    case 'summary': {
      const trimmed = value.trim();
      setValues.summary = trimmed.length > 0 ? trimmed : null;
      displayValue = trimmed.length > 0 ? trimmed : '_(cleared)_';
      break;
    }
    case 'text': {
      if (bill.billType !== 'short') {
        await interaction.editReply({
          embeds: [errorEmbed('Only short text-only bills can have their text edited with `/bill edit`. For Google Doc bills, edit the Google Doc and run `/bill recache`.')],
        });
        return;
      }

      const trimmed = value.trim();
      if (trimmed.length === 0 || trimmed.length > SHORT_BILL_TEXT_MAX_LENGTH) {
        await interaction.editReply({
          embeds: [errorEmbed(`Short bill text must be between 1 and ${SHORT_BILL_TEXT_MAX_LENGTH} characters.`)],
        });
        return;
      }

      setValues.cachedContent = trimmed;
      setValues.cachedAt = now;
      displayValue = trimmed;
      break;
    }
    case 'policy_areas': {
      const list = splitCsv(value);
      setValues.policyAreas = list;
      displayValue = list.length > 0 ? list.map((p) => `\`${p}\``).join(', ') : '_(cleared)_';
      break;
    }
    case 'tags': {
      const list = splitCsv(value);
      setValues.tags = list;
      displayValue = list.length > 0 ? list.map((t) => `\`${t}\``).join(', ') : '_(cleared)_';
      break;
    }
    default: {
      await interaction.editReply({
        embeds: [errorEmbed(`Unknown field: \`${field as string}\`.`)],
      });
      return;
    }
  }

  try {
    await db
      .update(bills)
      .set(setValues)
      // Non-staff edits are pinned to the status that was just checked so a
      // concurrent vote/enactment cannot slip in between the check and write.
      .where(staff
        ? eq(bills.id, bill.id)
        : and(eq(bills.id, bill.id), eq(bills.status, bill.status)));

    const padded = String(bill.billNumber).padStart(3, '0');

    const embed = createEmbed({
      title: 'Bill Updated',
      system: 'bills',
      description: [
        `**${bill.title}** (Bill #\`B-${padded}\`)`,
        '',
        `\u{1F4DD} Field \`${field}\` updated by <@${interaction.user.id}>.`,
        '',
        `**New value:**`,
        displayValue.length > 1500 ? displayValue.slice(0, 1490) + '\n…' : displayValue,
      ].join('\n'),
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to edit bill metadata:', error);
    await interaction.editReply({
      embeds: [errorEmbed('Failed to update bill metadata due to a database error.')],
    });
  }
}
