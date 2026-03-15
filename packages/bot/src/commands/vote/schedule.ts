import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import type { Command } from '../../client.js';

/**
 * /vote schedule — show upcoming votes and elections.
 *
 * Lists elections with status draft, nominations_open, or voting_open,
 * sorted by voting start time.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('vote-schedule')
    .setDescription('Show upcoming votes and elections') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    // TODO: Fetch from API — GET /api/elections?status=voting_open
    // and GET /api/elections?status=draft etc.

    const embed = createEmbed({
      title: 'Upcoming Votes & Elections',
      description: 'No upcoming votes at this time.',
      system: 'voting',
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
