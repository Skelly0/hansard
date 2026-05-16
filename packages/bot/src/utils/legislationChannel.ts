import type { EmbedBuilder } from 'discord.js';

export const DEFAULT_LEGISLATION_CHANNEL_ID = '1499837130254581854';

const LEGISLATION_CHANNEL_ENV = 'LEGISLATION_CHANNEL_ID';

type SentMessage = { id: string };

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
  messageId?: string | null;
  error?: unknown;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return !!channel && typeof (channel as { send?: unknown }).send === 'function';
}

function extractMessageId(sent: unknown): string | null {
  if (sent && typeof sent === 'object') {
    const id = (sent as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
  }
  return null;
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

    const sent = (await channel.send({ embeds: [embed] })) as SentMessage | unknown;
    return { status: 'sent', channelId, messageId: extractMessageId(sent) };
  } catch (error) {
    logger.error(`Failed to post legislation update to channel ${channelId}:`, error);
    return { status: 'failed', channelId, error };
  }
}

export type LegislationEditResult =
  | { status: 'edited'; channelId: string; messageId: string }
  | { status: 'no_message'; channelId: string | null; messageId: string | null }
  | { status: 'not_configured'; channelId: null; messageId: null }
  | { status: 'not_sendable' | 'message_missing' | 'failed'; channelId: string; messageId: string; error?: unknown };

type FetchableChannel = SendableChannel & {
  messages: {
    fetch(messageId: string): Promise<unknown>;
  };
};

type EditableMessage = {
  edit(options: { embeds: EmbedBuilder[] }): Promise<unknown>;
};

function hasMessageFetch(channel: unknown): channel is FetchableChannel {
  if (!isSendableChannel(channel)) return false;
  const messages = (channel as unknown as { messages?: { fetch?: unknown } }).messages;
  return !!messages && typeof messages.fetch === 'function';
}

function isEditableMessage(message: unknown): message is EditableMessage {
  return !!message && typeof (message as { edit?: unknown }).edit === 'function';
}

/**
 * Edit a previously-posted legislation embed in place. Used by `/bill repeal`
 * to mark the original `/bill enact` message as repealed without spamming the
 * channel with a new post. Returns `no_message` when the bill has no stored
 * legislation_message_id (legacy bills before the column existed) so callers
 * can fall back to posting a fresh notice.
 */
export async function editLegislationEmbed({
  client,
  embed,
  channelId,
  messageId,
  logger = console,
}: {
  client: DiscordClient;
  embed: EmbedBuilder;
  channelId: string | null | undefined;
  messageId: string | null | undefined;
  logger?: Pick<Console, 'error'>;
}): Promise<LegislationEditResult> {
  if (!channelId || !messageId) {
    return { status: 'no_message', channelId: channelId ?? null, messageId: messageId ?? null };
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!hasMessageFetch(channel)) {
      logger.error(`Legislation channel ${channelId} did not resolve to a fetchable channel.`);
      return { status: 'not_sendable', channelId, messageId };
    }

    const message = await channel.messages.fetch(messageId);
    if (!isEditableMessage(message)) {
      logger.error(`Legislation message ${messageId} in ${channelId} is not editable.`);
      return { status: 'message_missing', channelId, messageId };
    }

    await message.edit({ embeds: [embed] });
    return { status: 'edited', channelId, messageId };
  } catch (error) {
    logger.error(`Failed to edit legislation message ${messageId} in ${channelId}:`, error);
    return { status: 'failed', channelId, messageId, error };
  }
}
