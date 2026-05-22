import { eq } from 'drizzle-orm';
import { players, type Database } from '@hansard/db';
import { splitForDiscord } from './ticketThreadNotifier.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const TOKEN_ENV_VARS = 'TICKET_THREAD_MIRROR_BOT_TOKEN or DISCORD_BOT_TOKEN';
const SUPPRESSED_ALLOWED_MENTIONS = { parse: [] } as const;

let warnedMissingToken = false;

export interface NotifyTicketOwnerOfReplyOptions {
  db: Database;
  ticket: {
    id: string;
    number: number;
    title: string;
    createdById: string;
  };
  authorId: string;
  content: string;
}

export async function notifyTicketOwnerOfReply(
  opts: NotifyTicketOwnerOfReplyOptions,
): Promise<void> {
  if (opts.ticket.createdById === opts.authorId) return;

  const token = getBotToken();
  if (!token) {
    warnMissingToken();
    return;
  }

  try {
    const [owner] = await opts.db
      .select({ discordId: players.discordId })
      .from(players)
      .where(eq(players.id, opts.ticket.createdById))
      .limit(1);

    if (!owner?.discordId) return;

    const [author] = await opts.db
      .select({
        characterName: players.characterName,
        discordUsername: players.discordUsername,
      })
      .from(players)
      .where(eq(players.id, opts.authorId))
      .limit(1);

    const authorName = author?.characterName || author?.discordUsername || 'Unknown';
    const dmChannelId = await openDmChannel(owner.discordId, token);
    if (!dmChannelId) return;

    const body = [
      `**Ticket #${opts.ticket.number}: New Reply**`,
      `**Ticket:** ${opts.ticket.title}`,
      `**From:** ${authorName}`,
      '',
      opts.content,
    ].join('\n');

    for (const chunk of splitForDiscord(body)) {
      await sendDmMessage(dmChannelId, token, chunk);
    }
  } catch (err) {
    console.error(`Failed to notify owner for ticket #${opts.ticket.number}:`, err);
  }
}

function getBotToken(): string | undefined {
  return process.env.TICKET_THREAD_MIRROR_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || undefined;
}

function warnMissingToken(): void {
  if (warnedMissingToken) return;
  warnedMissingToken = true;
  console.warn(`notifyTicketOwnerOfReply skipped: set ${TOKEN_ENV_VARS} to DM ticket owners.`);
}

async function openDmChannel(discordUserId: string, token: string): Promise<string | null> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: discordUserId }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.warn(`notifyTicketOwnerOfReply DM open failed (${response.status}): ${text.slice(0, 200)}`);
    return null;
  }

  const json = await response.json().catch(() => null) as { id?: string } | null;
  return json?.id ?? null;
}

async function sendDmMessage(channelId: string, token: string, content: string): Promise<void> {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content,
      allowed_mentions: SUPPRESSED_ALLOWED_MENTIONS,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.warn(`notifyTicketOwnerOfReply DM send failed (${response.status}): ${text.slice(0, 200)}`);
  }
}
