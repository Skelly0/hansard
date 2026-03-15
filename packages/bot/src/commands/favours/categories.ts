import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq, asc } from 'drizzle-orm';
import { favourCategories } from '@hansard/db';
import { createEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('favour-categories')
    .setDescription('List all favour categories with descriptions'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const categories = await db
      .select()
      .from(favourCategories)
      .where(eq(favourCategories.isActive, true))
      .orderBy(asc(favourCategories.sortOrder), asc(favourCategories.name));

    if (categories.length === 0) {
      const embed = createEmbed({
        title: 'Favour Categories',
        description: 'No favour categories have been created yet.',
        system: 'favours',
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const fields = categories.map((cat) => {
      const emoji = cat.emoji ? `${cat.emoji} ` : '';
      const desc = cat.description ?? 'No description';
      const spendable = cat.spendableOn as string[] | null;
      const spendableText = spendable && spendable.length > 0
        ? `\n*Spendable on:* ${spendable.join(', ')}`
        : '';

      return {
        name: `${emoji}${cat.name}${cat.shortName ? ` (${cat.shortName})` : ''}`,
        value: `${desc}${spendableText}`,
      };
    });

    const embed = createEmbed({
      title: 'Favour Categories',
      description: `${categories.length} active categor${categories.length === 1 ? 'y' : 'ies'}.`,
      system: 'favours',
      fields,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
