import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { eq, asc } from 'drizzle-orm';
import { favourBalances, favourCategories, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('favours')
    .setDescription('View your own favour balances across all categories'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    // Look up the invoker's player record
    const [player] = await db
      .select()
      .from(players)
      .where(eq(players.discordId, interaction.user.id))
      .limit(1);

    if (!player) {
      await interaction.editReply({ embeds: [errorEmbed('You are not registered as a player.')] });
      return;
    }

    // Fetch balances with category info
    const balances = await db
      .select({
        balance: favourBalances.balance,
        categoryName: favourCategories.name,
        categoryEmoji: favourCategories.emoji,
      })
      .from(favourBalances)
      .innerJoin(favourCategories, eq(favourBalances.categoryId, favourCategories.id))
      .where(eq(favourBalances.playerId, player.id))
      .orderBy(asc(favourCategories.sortOrder));

    if (balances.length === 0) {
      const embed = createEmbed({
        title: 'Your Favours',
        description: 'You have no favour balances yet.',
        system: 'favours',
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const lines = balances.map((b) => {
      const emoji = b.categoryEmoji ? `${b.categoryEmoji} ` : '';
      return `${emoji}**${b.categoryName}:** \`${b.balance}\``;
    });

    const total = balances.reduce((sum, b) => sum + b.balance, 0);
    lines.push('', `**Total:** \`${total}\``);

    const embed = createEmbed({
      title: `Favours \u2014 ${player.characterName ?? interaction.user.username}`,
      description: lines.join('\n'),
      system: 'favours',
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
