import type { ChatInputCommandInteraction } from 'discord.js';
import { favourCategories } from '@hansard/db';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const member = interaction.member;
  if (!member || !('roles' in member)) {
    await interaction.editReply({ embeds: [errorEmbed('This command can only be used in a server.')] });
    return;
  }
  if (!(await isStaff(member))) {
    await interaction.editReply({ embeds: [errorEmbed('Only staff can create favour categories.')] });
    return;
  }

  const name = interaction.options.getString('name', true).trim();
  const shortName = interaction.options.getString('short-name')?.trim() || null;
  const description = interaction.options.getString('description')?.trim() || null;
  const emoji = interaction.options.getString('emoji')?.trim() || null;
  const colour = interaction.options.getString('colour')?.trim() || null;
  const spendableRaw = interaction.options.getString('spendable-on')?.trim() || null;
  const sortOrder = interaction.options.getInteger('sort-order') ?? 0;

  if (colour && !/^#[0-9a-fA-F]{6}$/.test(colour)) {
    await interaction.editReply({ embeds: [errorEmbed('Colour must be a 6-digit hex code like `#b94a48`.')] });
    return;
  }

  const spendableOn = spendableRaw
    ? spendableRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  try {
    const [category] = await db
      .insert(favourCategories)
      .values({
        name,
        shortName,
        description,
        emoji,
        colour,
        spendableOn,
        sortOrder,
        isActive: true,
      })
      .returning();

    const lines = [
      `${category.emoji ? `${category.emoji} ` : ''}**${category.name}**${category.shortName ? ` (${category.shortName})` : ''}`,
      category.description ? `*${category.description}*` : '',
      spendableOn && spendableOn.length > 0 ? `**Spendable on:** ${spendableOn.join(', ')}` : '',
      `**Sort order:** ${sortOrder}`,
      `\nID: \`${category.id}\``,
    ].filter(Boolean).join('\n');

    await interaction.editReply({ embeds: [successEmbed('Favour Category Created', lines)] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create category';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}
