import type { ChatInputCommandInteraction } from 'discord.js';
import { eq, asc } from 'drizzle-orm';
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
    await interaction.editReply({ embeds: [errorEmbed('Only staff can deactivate favour categories.')] });
    return;
  }

  const query = interaction.options.getString('category', true);
  const all = await db
    .select()
    .from(favourCategories)
    .where(eq(favourCategories.isActive, true))
    .orderBy(asc(favourCategories.sortOrder));

  const target =
    all.find((c) => c.name.toLowerCase() === query.toLowerCase()) ??
    all.find((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  if (!target) {
    await interaction.editReply({ embeds: [errorEmbed(`No active favour category matching "${query}" found.`)] });
    return;
  }

  try {
    await db
      .update(favourCategories)
      .set({ isActive: false })
      .where(eq(favourCategories.id, target.id));

    await interaction.editReply({
      embeds: [successEmbed(
        'Favour Category Deactivated',
        `${target.emoji ? `${target.emoji} ` : ''}**${target.name}** is no longer active. Existing balances are preserved; re-activate with \`/favour category-edit category:${target.name} active:true\`.`,
      )],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deactivate category';
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}
