import type { EmbedBuilder } from 'discord.js';

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

/**
 * Resolve the public game-events channel from `GAME_EVENTS_CHANNEL_ID`
 * (or the legacy `ANNOUNCEMENT_CHANNEL_ID`). Returns `null` when neither is
 * configured so callers report `not_configured` instead of posting somewhere
 * deployment-specific.
 */
export function getGameEventsChannelId(env: NodeJS.ProcessEnv = process.env): string | null {
  return env[GAME_EVENTS_CHANNEL_ENV]?.trim()
    || env[LEGACY_ANNOUNCEMENT_CHANNEL_ENV]?.trim()
    || null;
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
