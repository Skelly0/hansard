import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

/**
 * /vote cast <election_id> — cast a ballot in an election.
 *
 * For yea/nay votes, shows inline buttons.
 * For secret ballots, DMs the user a ballot form.
 * For ranked/approval, would use select menus or a modal.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-cast')
    .setDescription('Cast your ballot in an election')
    .addStringOption((opt) =>
      opt
        .setName('election_id')
        .setDescription('The election ID')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const electionId = interaction.options.getString('election_id', true);

    // TODO: Fetch election from API to determine method and show appropriate UI.
    // For now, show a yea/nay/abstain ballot as the most common case.

    const embed = createEmbed({
      title: 'Cast Your Vote',
      description: `Election \`${electionId}\`\n\nSelect your vote below. Your vote will be recorded and cannot be changed.`,
      system: 'voting',
    });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`vote-yea:${electionId}`)
        .setLabel('Yea')
        .setStyle(ButtonStyle.Success)
        .setEmoji('\u2705'),
      new ButtonBuilder()
        .setCustomId(`vote-nay:${electionId}`)
        .setLabel('Nay')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('\u274C'),
      new ButtonBuilder()
        .setCustomId(`vote-abstain:${electionId}`)
        .setLabel('Abstain')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('\u2796'),
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  },
};

export default command;
