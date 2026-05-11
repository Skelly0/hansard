import type { EmbedBuilder } from 'discord.js';

export const DEFAULT_GAME_EVENTS_CHANNEL_ID = '1503483556914266254';

const GAME_EVENTS_CHANNEL_ENV = 'GAME_EVENTS_CHANNEL_ID';
const LEGACY_ANNOUNCEMENT_CHANNEL_ENV = 'ANNOUNCEMENT_CHANNEL_ID';

type SendableChannel = {
  send(options: { embeds: EmbedBuilder[] }): Promise<unknown>;
};

type DiscordClient = {
  channels: {
    fetch(channelId: string): Promise<unknown>;
  };
};

export type GameEventsPostResult = {
  status: 'sent' | 'not_configured' | 'not_sendable' | 'failed';
  channelId: string | null;
  error?: unknown;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return !!channel && typeof (channel as { send?: unknown }).send === 'function';
}

export function getGameEventsChannelId(env: NodeJS.ProcessEnv = process.env): string {
  return env[GAME_EVENTS_CHANNEL_ENV]?.trim()
    || env[LEGACY_ANNOUNCEMENT_CHANNEL_ENV]?.trim()
    || DEFAULT_GAME_EVENTS_CHANNEL_ID;
}

export async function postGameEventsEmbed({
  client,
  embed,
  channelId = getGameEventsChannelId(),
  logger = console,
}: {
  client: DiscordClient;
  embed: EmbedBuilder;
  channelId?: string | null;
  logger?: Pick<Console, 'error'>;
}): Promise<GameEventsPostResult> {
  if (!channelId) {
    return { status: 'not_configured', channelId: null };
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      logger.error(`GAME_EVENTS_CHANNEL_ID ${channelId} did not resolve to a sendable channel.`);
      return { status: 'not_sendable', channelId };
    }

    await channel.send({ embeds: [embed] });
    return { status: 'sent', channelId };
  } catch (error) {
    logger.error(`Failed to post game event update to channel ${channelId}:`, error);
    return { status: 'failed', channelId, error };
  }
}
