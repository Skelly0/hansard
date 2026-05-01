import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { eq, asc } from 'drizzle-orm';
import { favourBalances, favourCategories, players } from '@hansard/db';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { db } from '../../db.js';
import { isStaff } from '../../utils/permissions.js';
import type { Command } from '../../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('favour-check')
    .setDescription('View any player\'s favour balances (staff only)')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('The player to inspect').setRequired(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member;
    if (!member || !('roles' in member)) {
      await interaction.editReply({
        embeds: [errorEmbed('This command can only be used in a server.')],
      });
      return;
    }

    if (!(await isStaff(member))) {
      await interaction.editReply({
        embeds: [errorEmbed('Only staff can inspect other players\' favour balances.')],
      });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);

    const [targetPlayer] = await db
      .select()
      .from(players)
      .where(eq(players.discordId, targetUser.id))
      .limit(1);

    if (!targetPlayer) {
      await interaction.editReply({
        embeds: [errorEmbed(`${targetUser.username} is not registered as a player.`)],
      });
      return;
    }

    const balances = await db
      .select({
        balance: favourBalances.balance,
        categoryName: favourCategories.name,
        categoryEmoji: favourCategories.emoji,
      })
      .from(favourBalances)
      .innerJoin(favourCategories, eq(favourBalances.categoryId, favourCategories.id))
      .where(eq(favourBalances.playerId, targetPlayer.id))
      .orderBy(asc(favourCategories.sortOrder));

    const playerName = targetPlayer.characterName ?? targetUser.username;

    if (balances.length === 0) {
      const embed = createEmbed({
        title: `Favours — ${playerName}`,
        description: `<@${targetUser.id}> has no favour balances recorded.`,
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
      title: `Favours — ${playerName}`,
      description: `<@${targetUser.id}>\n\n${lines.join('\n')}`,
      system: 'favours',
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
