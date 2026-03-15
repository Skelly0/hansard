import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import type { Command } from '../client.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is alive'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sent = await interaction.deferReply({ fetchReply: true });

    const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
    const wsHeartbeat = Math.round(interaction.client.ws.ping);

    const embed = createEmbed({
      title: 'Pong!',
      description: [
        `**Roundtrip:** ${roundtrip}ms`,
        `**WebSocket:** ${wsHeartbeat}ms`,
      ].join('\n'),
      system: 'simulation',
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
