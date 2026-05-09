import type { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

const MOD_LOG_CHANNEL_ENV = 'MOD_LOG_CHANNEL_ID';

type SendableChannel = {
  send: (options: { embeds: EmbedBuilder[] }) => Promise<unknown>;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return !!channel && typeof (channel as { send?: unknown }).send === 'function';
}

export async function postModLog(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  const channelId = process.env[MOD_LOG_CHANNEL_ENV]?.trim();
  if (!channelId) return;

  try {
    const channel = await interaction.client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      console.error(`MOD_LOG_CHANNEL_ID ${channelId} did not resolve to a sendable channel.`);
      return;
    }

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to post moderation log:', err);
  }
}
