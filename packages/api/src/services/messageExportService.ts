const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DEFAULT_EXPORT_HOURS = 24;
const DEFAULT_MAX_MESSAGES = 1000;

export interface MessageExportAttachment {
  filename: string;
  url: string;
  contentType: string | null;
  size: number;
}

export interface MessageExportEmbed {
  title: string | null;
  url: string | null;
  description: string | null;
}

export interface MessageExportMessage {
  id: string;
  channelId: string;
  channelName: string | null;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  timestamp: string;
  content: string;
  attachments: MessageExportAttachment[];
  embeds: MessageExportEmbed[];
}

export interface MessageExportChannel {
  id: string;
  name: string | null;
  status: 'ok' | 'error';
  messageCount: number;
  error?: string;
}

export interface MessageExportResult {
  window: {
    start: string;
    end: string;
    hours: number;
  };
  messages: MessageExportMessage[];
  channels: MessageExportChannel[];
  truncated: boolean;
}

export interface ExportDiscordMessagesInput {
  token: string;
  allowedChannelIds: string[];
  channelIds?: string[];
  hours?: number;
  maxMessages?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface DiscordChannel {
  id: string;
  guild_id?: string;
  parent_id?: string | null;
  name?: string;
  type?: number;
  thread_metadata?: {
    archive_timestamp?: string;
  };
}

interface DiscordUser {
  id?: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
}

interface DiscordAttachment {
  filename?: string;
  url?: string;
  content_type?: string | null;
  size?: number;
}

interface DiscordEmbed {
  title?: string | null;
  url?: string | null;
  description?: string | null;
}

interface DiscordMessage {
  id: string;
  channel_id?: string;
  author?: DiscordUser;
  timestamp: string;
  content?: string;
  attachments?: DiscordAttachment[];
  embeds?: DiscordEmbed[];
}

interface DiscordThreadsResponse {
  threads?: DiscordChannel[];
  has_more?: boolean;
}

const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);

class DiscordHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Discord returned ${status}: ${message}`);
    this.name = 'DiscordHttpError';
  }
}

export class InvalidMessageExportChannelsError extends Error {
  constructor(readonly invalidChannelIds: string[]) {
    super('Requested channels are not exportable');
    this.name = 'InvalidMessageExportChannelsError';
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function parseMessageExportChannelIds(value: string | undefined): string[] {
  if (!value) return [];
  return unique(value.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean));
}

export function selectMessageExportChannelIds(
  allowedChannelIds: string[],
  requestedChannelIds?: string[],
): string[] {
  const allowedSet = new Set(allowedChannelIds);
  const selected = requestedChannelIds && requestedChannelIds.length > 0
    ? unique(requestedChannelIds)
    : allowedChannelIds;
  const invalid = selected.filter((id) => !allowedSet.has(id));

  if (invalid.length > 0) {
    throw new InvalidMessageExportChannelsError(invalid);
  }

  return selected;
}

async function readDiscordErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown };
    return typeof body.message === 'string' ? body.message : response.statusText || 'Request failed';
  } catch {
    return response.statusText || 'Request failed';
  }
}

async function requestDiscordJson<T>(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  retryRateLimit = true,
): Promise<T> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bot ${token}`,
      'User-Agent': 'DiscordBot (Hansard, 0.1)',
    },
  });

  if (response.status === 429 && retryRateLimit) {
    let retryAfterMs = 1000;
    try {
      const body = await response.json() as { retry_after?: unknown };
      if (typeof body.retry_after === 'number' && Number.isFinite(body.retry_after)) {
        retryAfterMs = Math.max(0, body.retry_after * 1000);
      }
    } catch {
      retryAfterMs = 1000;
    }
    await sleep(retryAfterMs);
    return requestDiscordJson<T>(url, token, fetchImpl, sleep, false);
  }

  if (!response.ok) {
    throw new DiscordHttpError(response.status, await readDiscordErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

async function fetchChannelName(
  channelId: string,
  token: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<DiscordChannel> {
  return requestDiscordJson<DiscordChannel>(
    `${DISCORD_API_BASE}/channels/${channelId}`,
    token,
    fetchImpl,
    sleep,
  );
}

function channelName(channel: Pick<DiscordChannel, 'id' | 'name'>): string | null {
  return typeof channel.name === 'string' && channel.name.trim() ? channel.name : null;
}

function threadExportName(parentName: string | null, thread: DiscordChannel): string | null {
  const threadName = channelName(thread);
  if (!parentName) return threadName;
  return threadName ? `${parentName} / ${threadName}` : parentName;
}

function isThreadChannel(channel: DiscordChannel): boolean {
  return typeof channel.type === 'number' && THREAD_CHANNEL_TYPES.has(channel.type);
}

function threadArchiveTimestamp(thread: DiscordChannel): Date | null {
  const timestamp = thread.thread_metadata?.archive_timestamp;
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchActiveThreadsForParent(params: {
  parent: DiscordChannel;
  token: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}): Promise<DiscordChannel[]> {
  if (!params.parent.guild_id) return [];
  const body = await requestDiscordJson<DiscordThreadsResponse>(
    `${DISCORD_API_BASE}/guilds/${params.parent.guild_id}/threads/active`,
    params.token,
    params.fetchImpl,
    params.sleep,
  );
  return (body.threads ?? []).filter((thread) => thread.parent_id === params.parent.id);
}

async function fetchArchivedThreadsForParent(params: {
  parent: DiscordChannel;
  kind: 'public' | 'private';
  start: Date;
  token: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}): Promise<DiscordChannel[]> {
  const threads: DiscordChannel[] = [];
  let before: string | undefined;

  while (true) {
    const query = new URLSearchParams({ limit: '100' });
    if (before) query.set('before', before);
    const body = await requestDiscordJson<DiscordThreadsResponse>(
      `${DISCORD_API_BASE}/channels/${params.parent.id}/threads/archived/${params.kind}?${query.toString()}`,
      params.token,
      params.fetchImpl,
      params.sleep,
    );
    const page = body.threads ?? [];
    if (page.length === 0) break;

    let reachedWindowStart = false;
    for (const thread of page) {
      const archivedAt = threadArchiveTimestamp(thread);
      if (archivedAt && archivedAt < params.start) {
        reachedWindowStart = true;
        continue;
      }
      if (!thread.parent_id || thread.parent_id === params.parent.id) {
        threads.push(thread);
      }
    }

    const oldestArchive = page.map(threadArchiveTimestamp).filter((value): value is Date => value !== null).at(-1);
    before = oldestArchive?.toISOString();
    if (!body.has_more || !before || reachedWindowStart) break;
  }

  return threads;
}

async function discoverThreadsForParent(params: {
  parent: DiscordChannel;
  start: Date;
  token: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}): Promise<DiscordChannel[]> {
  if (!params.parent.guild_id) return [];
  if (isThreadChannel(params.parent)) return [];

  const discovered = await Promise.all([
    fetchActiveThreadsForParent(params),
    fetchArchivedThreadsForParent({ ...params, kind: 'public' }),
    fetchArchivedThreadsForParent({ ...params, kind: 'private' }),
  ]);
  const byId = new Map<string, DiscordChannel>();
  for (const thread of discovered.flat()) {
    byId.set(thread.id, thread);
  }
  return [...byId.values()];
}

function mapAttachment(attachment: DiscordAttachment): MessageExportAttachment {
  return {
    filename: attachment.filename ?? 'attachment',
    url: attachment.url ?? '',
    contentType: attachment.content_type ?? null,
    size: attachment.size ?? 0,
  };
}

function mapEmbed(embed: DiscordEmbed): MessageExportEmbed {
  return {
    title: embed.title ?? null,
    url: embed.url ?? null,
    description: embed.description ?? null,
  };
}

function mapMessage(message: DiscordMessage, channelId: string, channelName: string | null): MessageExportMessage {
  const author = message.author ?? {};
  const authorName = author.global_name || author.username || 'Unknown';

  return {
    id: message.id,
    channelId: message.channel_id ?? channelId,
    channelName,
    authorId: author.id ?? 'unknown',
    authorName,
    authorIsBot: author.bot ?? false,
    timestamp: new Date(message.timestamp).toISOString(),
    content: message.content ?? '',
    attachments: (message.attachments ?? []).map(mapAttachment),
    embeds: (message.embeds ?? []).map(mapEmbed),
  };
}

async function fetchChannelMessages(params: {
  channelId: string;
  channelName: string | null;
  token: string;
  start: Date;
  end: Date;
  maxMessages: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}): Promise<MessageExportMessage[]> {
  const messages: MessageExportMessage[] = [];
  let before: string | undefined;
  let reachedExportCap = false;

  while (true) {
    const query = new URLSearchParams({ limit: '100' });
    if (before) query.set('before', before);

    const page = await requestDiscordJson<DiscordMessage[]>(
      `${DISCORD_API_BASE}/channels/${params.channelId}/messages?${query.toString()}`,
      params.token,
      params.fetchImpl,
      params.sleep,
    );

    if (page.length === 0) break;

    let reachedWindowStart = false;
    for (const message of page) {
      const sentAt = new Date(message.timestamp);
      if (sentAt < params.start) {
        reachedWindowStart = true;
        continue;
      }
      if (sentAt <= params.end) {
        messages.push(mapMessage(message, params.channelId, params.channelName));
        if (messages.length > params.maxMessages) {
          reachedExportCap = true;
          break;
        }
      }
    }

    before = page[page.length - 1]?.id;
    if (!before || reachedWindowStart || reachedExportCap || page.length < 100) break;
  }

  return messages;
}

export async function exportDiscordMessages(input: ExportDiscordMessagesInput): Promise<MessageExportResult> {
  const hours = input.hours ?? DEFAULT_EXPORT_HOURS;
  const maxMessages = input.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const end = input.now ?? new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? defaultSleep;
  const channelIds = selectMessageExportChannelIds(input.allowedChannelIds, input.channelIds);

  const channels: MessageExportChannel[] = [];
  const messages: MessageExportMessage[] = [];

  for (const channelId of channelIds) {
    try {
      const channel = await fetchChannelName(channelId, input.token, fetchImpl, sleep);
      const rootChannelName = channelName(channel);
      const channelMessages = await fetchChannelMessages({
        channelId,
        channelName: rootChannelName,
        token: input.token,
        start,
        end,
        maxMessages,
        fetchImpl,
        sleep,
      });
      messages.push(...channelMessages);
      channels.push({
        id: channelId,
        name: rootChannelName,
        status: 'ok',
        messageCount: channelMessages.length,
      });

      const threads = await discoverThreadsForParent({
        parent: channel,
        start,
        token: input.token,
        fetchImpl,
        sleep,
      });

      for (const thread of threads) {
        const exportName = threadExportName(rootChannelName, thread);
        try {
          const threadMessages = await fetchChannelMessages({
            channelId: thread.id,
            channelName: exportName,
            token: input.token,
            start,
            end,
            maxMessages,
            fetchImpl,
            sleep,
          });
          messages.push(...threadMessages);
          channels.push({
            id: thread.id,
            name: exportName,
            status: 'ok',
            messageCount: threadMessages.length,
          });
        } catch (err) {
          channels.push({
            id: thread.id,
            name: exportName,
            status: 'error',
            messageCount: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      channels.push({
        id: channelId,
        name: null,
        status: 'error',
        messageCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const truncated = messages.length > maxMessages;
  const cappedMessages = truncated ? messages.slice(messages.length - maxMessages) : messages;

  return {
    window: {
      start: start.toISOString(),
      end: end.toISOString(),
      hours,
    },
    messages: cappedMessages,
    channels,
    truncated,
  };
}

function inlineMarkdownText(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\\n');
}

function channelDisplayLabel(message: Pick<MessageExportMessage, 'channelId' | 'channelName'>): string {
  return message.channelName?.trim() || message.channelId;
}

function channelSectionLabel(message: Pick<MessageExportMessage, 'channelId' | 'channelName'>): string {
  const display = channelDisplayLabel(message);
  return display === message.channelId ? display : `${display} (${message.channelId})`;
}

export function formatMessageExportMarkdown(result: MessageExportResult): string {
  const lines = [
    '# Hansard Message Export',
    '',
    `Window: ${result.window.start} -> ${result.window.end} (${result.window.hours}h)`,
    `Channels: ${result.channels.length}`,
    `Messages: ${result.messages.length}`,
    `Truncated: ${result.truncated ? 'yes' : 'no'}`,
    '',
  ];

  if (result.messages.length === 0) {
    lines.push('_No messages exported._', '');
  }

  const byChannel = new Map<string, MessageExportMessage[]>();
  for (const message of result.messages) {
    const label = channelSectionLabel(message);
    byChannel.set(label, [...(byChannel.get(label) ?? []), message]);
  }

  for (const [label, messages] of byChannel) {
    lines.push(`## #${inlineMarkdownText(label)}`, '');
    for (const message of messages) {
      const displayLabel = inlineMarkdownText(channelDisplayLabel(message));
      const authorName = inlineMarkdownText(message.authorName);
      const content = inlineMarkdownText(message.content.trim() || '(no text content)');
      lines.push(`[${message.timestamp}] #${displayLabel} ${authorName}: ${content}`);
      for (const attachment of message.attachments) {
        lines.push(`- Attachment: ${inlineMarkdownText(attachment.filename)} (${inlineMarkdownText(attachment.url)})`);
      }
      for (const embed of message.embeds) {
        const title = inlineMarkdownText(embed.title ?? 'Untitled embed');
        const parts = [title];
        if (embed.url) parts.push(inlineMarkdownText(embed.url));
        if (embed.description) parts.push(inlineMarkdownText(embed.description));
        lines.push(`- Embed: ${parts.join(' - ')}`);
      }
    }
    lines.push('');
  }

  const errored = result.channels.filter((channel) => channel.status === 'error');
  if (errored.length > 0) {
    lines.push('## Channel Errors', '');
    for (const channel of errored) {
      lines.push(`- ${channel.id}: ${channel.error ?? 'Unknown error'}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
