/**
 * Best-effort mirror of ticket activity into the linked Discord thread.
 *
 * Posts via the bot REST API using `TICKET_THREAD_MIRROR_BOT_TOKEN`, falling
 * back to `DISCORD_BOT_TOKEN`, so callers do not need a discord.js client.
 * Used by both the API (for web-driven ticket actions) and the bot (for slash
 * commands that bypass `TicketService`).
 *
 * No-op when:
 *  - the ticket has no `discordThreadId`
 *  - no bot token is configured (warns once)
 *  - Discord returns a non-2xx (logged, never thrown — the DB write has
 *    already committed and the thread mirror is non-critical)
 *
 * Long content is split at paragraph/word boundaries to stay under
 * Discord's 2000-char per-message limit.
 */

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const MAX_MESSAGE_LENGTH = 2000;
const TOKEN_ENV_VARS = 'TICKET_THREAD_MIRROR_BOT_TOKEN or DISCORD_BOT_TOKEN';

let warnedMissingToken = false;

export interface ThreadEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface ThreadEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: ThreadEmbedField[];
  footer?: { text: string };
}

export interface PostToTicketThreadOptions {
  threadId: string | null | undefined;
  content?: string;
  embeds?: ThreadEmbed[];
}

export async function postToTicketThread(opts: PostToTicketThreadOptions): Promise<void> {
  if (!opts.threadId) return;
  if (!opts.content && !opts.embeds?.length) return;

  const token = getBotToken();
  if (!token) {
    warnMissingToken();
    return;
  }

  const chunks = opts.content ? splitForDiscord(opts.content) : [];

  if (chunks.length === 0) {
    if (!opts.embeds?.length) return;
    await sendOne(opts.threadId, token, { embeds: opts.embeds });
    return;
  }

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await sendOne(opts.threadId, token, {
      content: chunks[i],
      embeds: isLast ? opts.embeds : undefined,
    });
  }
}

function getBotToken(): string | undefined {
  return process.env.TICKET_THREAD_MIRROR_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || undefined;
}

function warnMissingToken(): void {
  if (warnedMissingToken) return;
  warnedMissingToken = true;
  console.warn(`postToTicketThread skipped: set ${TOKEN_ENV_VARS} to mirror ticket activity.`);
}

async function sendOne(
  channelId: string,
  token: string,
  body: { content?: string; embeds?: ThreadEmbed[] },
): Promise<void> {
  try {
    const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`postToTicketThread failed (${response.status}): ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error('postToTicketThread error:', err);
  }
}

export function splitForDiscord(content: string, max = MAX_MESSAGE_LENGTH): string[] {
  if (content.length <= max) return [content];
  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > max) {
    let splitAt = remaining.lastIndexOf('\n\n', max);
    if (splitAt < max * 0.5) splitAt = remaining.lastIndexOf('\n', max);
    if (splitAt < max * 0.5) splitAt = remaining.lastIndexOf(' ', max);
    if (splitAt <= 0) splitAt = max;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
