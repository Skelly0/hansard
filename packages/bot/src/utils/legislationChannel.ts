import type { EmbedBuilder } from 'discord.js';

export const DEFAULT_LEGISLATION_CHANNEL_ID = '1499837130254581854';

const LEGISLATION_CHANNEL_ENV = 'LEGISLATION_CHANNEL_ID';

type SendableChannel = {
  send(options: { embeds: EmbedBuilder[] }): Promise<unknown>;
};

type DiscordClient = {
  channels: {
    fetch(channelId: string): Promise<unknown>;
  };
};

export type LegislationPostResult = {
  status: 'sent' | 'not_configured' | 'not_sendable' | 'failed';
  channelId: string | null;
  error?: unknown;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return !!channel && typeof (channel as { send?: unknown }).send === 'function';
}

export function getLegislationChannelId(env: NodeJS.ProcessEnv = process.env): string {
  return env[LEGISLATION_CHANNEL_ENV]?.trim() || DEFAULT_LEGISLATION_CHANNEL_ID;
}

export async function postLegislationEmbed({
  client,
  embed,
  channelId = getLegislationChannelId(),
  logger = console,
}: {
  client: DiscordClient;
  embed: EmbedBuilder;
  channelId?: string | null;
  logger?: Pick<Console, 'error'>;
}): Promise<LegislationPostResult> {
  if (!channelId) {
    return { status: 'not_configured', channelId: null };
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      logger.error(`LEGISLATION_CHANNEL_ID ${channelId} did not resolve to a sendable channel.`);
      return { status: 'not_sendable', channelId };
    }

    await channel.send({ embeds: [embed] });
    return { status: 'sent', channelId };
  } catch (error) {
    logger.error(`Failed to post legislation update to channel ${channelId}:`, error);
    return { status: 'failed', channelId, error };
  }
}
