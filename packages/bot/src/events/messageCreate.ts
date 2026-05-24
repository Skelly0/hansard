import { ChannelType, Events, type Client, type Message } from 'discord.js';
import { eq } from 'drizzle-orm';
import { players, tickets } from '@hansard/db';
import { db } from '../db.js';
import {
  PhoneService,
  PhoneServiceError,
  type CallParticipants,
} from '@hansard/api/services/phoneService';
import { TicketService } from '@hansard/api/services/ticketService';
import { notifyTicketOwnerOfReply } from '@hansard/api/services/ticketOwnerNotifier';
import {
  PhoneTextService,
  PhoneTextServiceError,
  phoneTextReplyHintForResolution,
} from '@hansard/api/services/phoneTextService';
import {
  relayMessage,
  hangUpAndNotify,
  postCallOpenedToStaffThread,
  RecipientDmClosedError,
} from '../utils/phoneRelay.js';
import { flushQueuedPhoneTextsForPlayer, relayRecordedPhoneText } from '../utils/phoneTextRelay.js';
import { isStaff } from '../utils/permissions.js';
import { PHONE_HINT_COOLDOWN_MS, PHONE_DM_CHUNK_BUDGET } from '@hansard/shared';

const HINT_MAP_MAX = 500;

/**
 * Short-TTL negative cache: "this discord user had NO open call as of <ts>". Lets chatty
 * non-call DMs skip the `resolvePlayer` + `findOpenCallForPlayer` round-trips. Kept
 * deliberately conservative — it ONLY caches the *negative* result, and only for a few
 * seconds, so the worst case is a brief window where a call that was just initiated by
 * another code path isn't seen here. A genuine in-call message is never dropped: any
 * cache miss falls through to the real DB lookup. (Positive caching would need the
 * initiate/answer/end paths to invalidate it, and those live in other files.)
 */
const NO_CALL_NEGATIVE_TTL_MS = 8_000;
const NO_CALL_CACHE_MAX = 500;
const noCallCache = new Map<string, number>();

function hasFreshNoCallEntry(discordId: string): boolean {
  const ts = noCallCache.get(discordId);
  if (ts === undefined) return false;
  if (Date.now() - ts >= NO_CALL_NEGATIVE_TTL_MS) {
    noCallCache.delete(discordId);
    return false;
  }
  return true;
}

function rememberNoCall(discordId: string): void {
  // Refresh insertion order for cheap LRU semantics, mirroring `recentHinted` below.
  noCallCache.delete(discordId);
  noCallCache.set(discordId, Date.now());
  if (noCallCache.size > NO_CALL_CACHE_MAX) {
    const oldest = noCallCache.keys().next().value;
    if (oldest !== undefined) noCallCache.delete(oldest);
  }
}

/**
 * Drop a discord user's negative-cache entry. MUST be called whenever a call is opened for
 * that user — the negative cache short-circuits *before* call resolution, so a stale "no
 * call" entry left over from a pre-call DM would otherwise make the first few seconds of an
 * in-call message stream be dropped with a wrong "you're not in a call" reply. `/phone dial`
 * clears it for both participants at call-creation time; after that there is always an open
 * (ringing → active) call for them, so `findOpenCallForPlayer` never re-seeds the entry until
 * the call actually ends.
 */
export function clearNoCallCache(discordId: string): void {
  noCallCache.delete(discordId);
}

/**
 * Bounded LRU-ish cooldown map for "you're not in a call" hints. Prevents an unbounded
 * memory leak from random DMs at the bot. Eviction is simple: when the map exceeds
 * HINT_MAP_MAX, drop the oldest half. Discord DM volume to the bot is low enough that
 * this is well below O(call rate).
 */
const recentHinted = new Map<string, number>();

function shouldShowHint(discordId: string): boolean {
  const last = recentHinted.get(discordId) ?? 0;
  if (Date.now() - last < PHONE_HINT_COOLDOWN_MS) return false;
  // Re-insert to refresh insertion order (cheap LRU semantics on Map).
  recentHinted.delete(discordId);
  recentHinted.set(discordId, Date.now());
  if (recentHinted.size > HINT_MAP_MAX) {
    // Evict the single oldest entry per overflow — bounded O(1) per call instead of the
    // previous O(N/2) bulk eviction every N inserts.
    const oldest = recentHinted.keys().next().value;
    if (oldest !== undefined) recentHinted.delete(oldest);
  }
  return true;
}

async function resolvePlayer(discordId: string): Promise<{ id: string; isAlive: boolean; characterName: string | null } | null> {
  const [row] = await db
    .select({ id: players.id, isAlive: players.isAlive, characterName: players.characterName })
    .from(players)
    .where(eq(players.discordId, discordId))
    .limit(1);
  return row ?? null;
}

function isThreadChannelType(type: ChannelType): boolean {
  return (
    type === ChannelType.PrivateThread ||
    type === ChannelType.PublicThread ||
    type === ChannelType.AnnouncementThread
  );
}

async function handleTicketThreadMessage(message: Message): Promise<void> {
  if (!isThreadChannelType(message.channel.type)) return;

  if (message.partial) {
    try {
      await message.fetch();
    } catch (err) {
      console.error(`[ticket:event] failed to hydrate thread message ${message.id}:`, err);
      return;
    }
  }
  if (message.author.bot) return;
  const content = formatTicketThreadMessageContent(message);
  if (!content) return;

  const [ticket] = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      title: tickets.title,
      createdById: tickets.createdById,
      assignedToId: tickets.assignedToId,
      discordThreadId: tickets.discordThreadId,
    })
    .from(tickets)
    .where(eq(tickets.discordThreadId, message.channel.id))
    .limit(1);

  if (!ticket) return;

  const [author] = await db
    .select({ id: players.id, isStaff: players.isStaff })
    .from(players)
    .where(eq(players.discordId, message.author.id))
    .limit(1);

  if (!author) return;

  const actorIsStaff = (message.member ? await isStaff(message.member) : false) || author.isStaff;
  const saved = await new TicketService(db).addMessage(
    ticket.id,
    content,
    author.id,
    false,
    message.id,
    actorIsStaff,
    false,
  );

  if (!saved) return;

  await notifyTicketOwnerOfReply({
    db,
    ticket,
    authorId: author.id,
    content,
  });
}

function formatTicketThreadMessageContent(message: Message): string {
  const body = message.content.trim();
  const attachmentLines = [...message.attachments.values()]
    .map((attachment) => {
      const url = attachment.url?.trim();
      if (!url) return null;
      const name = attachment.name?.trim() || 'attachment';
      return `- ${name}: ${url}`;
    })
    .filter((line): line is string => Boolean(line));
  const stickerLines = [...message.stickers.values()]
    .map((sticker) => sticker.name?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => `- ${name}`);

  if (attachmentLines.length === 0 && stickerLines.length === 0) return body;

  return [
    body,
    attachmentLines.length > 0 ? `**Attachments:**\n${attachmentLines.join('\n')}` : '',
    stickerLines.length > 0 ? `**Stickers:**\n${stickerLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

async function routePhoneTextReply(
  client: Client,
  message: Message,
  player: { id: string },
  isEmptyContent: boolean,
): Promise<boolean> {
  const textSvc = new PhoneTextService(db);
  const resolution = await textSvc.resolveReplyConversation(player.id);
  const hint = phoneTextReplyHintForResolution(resolution);
  if (hint) {
    if (!isEmptyContent && shouldShowHint(message.author.id)) {
      try {
        await message.reply({ content: hint, allowedMentions: { repliedUser: false, parse: [] } });
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  if (resolution.status !== 'selected' && resolution.status !== 'sole') return false;

  if (isEmptyContent) {
    try {
      await message.reply({
        content: "Stickers, attachments, and embeds aren't relayed by phone text — please type your message as text.",
        allowedMentions: { repliedUser: false, parse: [] },
      });
    } catch {
      /* ignore */
    }
    return true;
  }

  try {
    const recorded = await textSvc.recordReply({
      senderPlayerId: player.id,
      conversationId: resolution.context.conversation.id,
      content: message.content,
      senderDiscordMessageId: message.id,
    });
    await relayRecordedPhoneText(client, recorded);
    if (message.content.length > PHONE_DM_CHUNK_BUDGET) {
      try {
        await message.react('\u{1F4E8}');
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    if (err instanceof PhoneTextServiceError) {
      try {
        await message.reply({ content: err.message, allowedMentions: { repliedUser: false, parse: [] } });
      } catch {
        /* ignore */
      }
      return true;
    }
    console.error('[phone:event] failed to route text reply:', err);
  }
  return true;
}

async function handleDmMessage(client: Client, message: Message): Promise<void> {
  if (message.partial) {
    try {
      await message.fetch();
    } catch (err) {
      console.error(`[phone:event] failed to hydrate DM ${message.id} from ${message.author?.id ?? '?'}:`, err);
      return;
    }
  }
  if (message.author.bot) return;

  // NOTE: do NOT filter on `startsWith('/')`. In DM channels Discord delivers actual slash
  // commands as separate Interaction events, not as messages — so any `/`-prefixed message
  // here is plain text the player typed and should be relayed (and frozen) like any other.

  // Empty `content` can mean a sticker/attachment/embed-only DM. We still need to resolve
  // the call below to give in-call senders feedback (M10), but for non-call DMs there is
  // nothing to do — and the negative cache (below) lets us skip the DB hit entirely.
  const isEmptyContent = message.content.trim() === '';

  const hadFreshNoCallEntry = hasFreshNoCallEntry(message.author.id);
  const player = await resolvePlayer(message.author.id);
  if (!player || !player.characterName) {
    // OAuth-only placeholders and non-registered Discord users get no reply — we don't want
    // to leak the bot's existence/purpose to randos.
    return;
  }

  const svc = new PhoneService(db);
  const openCall = hadFreshNoCallEntry ? null : await svc.findOpenCallForPlayer(player.id);
  if (!openCall) {
    // Record the negative result so chatty non-call DMs can skip the call lookup for a few
    // seconds, but still run text-conversation routing. With texting, "no call" no longer
    // means "nothing routable."
    rememberNoCall(message.author.id);
    await routePhoneTextReply(client, message, player, isEmptyContent);
    return;
  }

  if (openCall.status === 'ringing') {
    try {
      await message.reply({
        content: 'Your line is still ringing. Wait for the other side to pick up, or `/phone hangup` to cancel.',
        allowedMentions: { repliedUser: false, parse: [] },
      });
    } catch {
      /* ignore */
    }
    return;
  }

  // M10: sticker/attachment/embed-only DMs arrive with empty `content` and cannot be
  // relayed as text. During an active call, tell the sender instead of silently dropping it.
  if (isEmptyContent) {
    try {
      await message.reply({
        content: "Stickers, attachments, and embeds aren't relayed on a call — please type your message as text.",
        allowedMentions: { repliedUser: false, parse: [] },
      });
    } catch {
      /* ignore */
    }
    return;
  }

  let participants: CallParticipants;
  try {
    participants = await svc.getCallParticipants(openCall.id);
  } catch (err) {
    console.error('[phone:event] failed to load participants for active call:', err);
    return;
  }

  const senderIsCaller = participants.callerPlayer.id === player.id;
  if (openCall.status === 'voicemail') {
    if (!senderIsCaller) {
      try {
        await message.reply({
          content: 'That voicemail box is waiting for the caller, not the mailbox owner.',
          allowedMentions: { repliedUser: false, parse: [] },
        });
      } catch {
        /* ignore */
      }
      return;
    }

    if (!participants.call.voicemailBeepedAt) {
      try {
        await message.reply({
          content: 'Your line is still ringing. Please wait.',
          allowedMentions: { repliedUser: false, parse: [] },
        });
      } catch {
        /* ignore */
      }
      return;
    }

    let persisted;
    try {
      persisted = await svc.recordMessage({
        callId: openCall.id,
        senderPlayerId: player.id,
        content: message.content,
        senderDiscordMessageId: message.id,
      });
    } catch (err) {
      if (err instanceof PhoneServiceError) {
        try {
          await message.reply({ content: err.message, allowedMentions: { repliedUser: false, parse: [] } });
        } catch {
          /* ignore */
        }
        return;
      }
      console.error('[phone:event] failed to record voicemail:', err);
      return;
    }

    if (message.content.length > PHONE_DM_CHUNK_BUDGET) {
      try {
        await message.react('\u{1F4E8}'); // 📨
      } catch {
        /* ignore */
      }
    }

    let delivered = true;
    try {
      await relayMessage(client, participants, persisted, true);
    } catch (err) {
      delivered = false;
      if (err instanceof RecipientDmClosedError) {
        console.error(`[phone:event] voicemail recipient ${err.discordUserId} has DMs closed`);
      } else {
        console.error('[phone:event] voicemail relay error:', err);
      }
    }

    try {
      await svc.systemEndCall(openCall.id, 'voicemail_left');
      await flushQueuedPhoneTextsForPlayer(client, player.id);
    } catch (err) {
      console.error('[phone:event] failed to end voicemail after message:', err);
    }

    try {
      await message.reply({
        content: delivered
          ? 'Voicemail delivered.'
          : 'Voicemail recorded, but I could not DM it to the recipient.',
        allowedMentions: { repliedUser: false, parse: [] },
      });
    } catch {
      /* ignore */
    }
    return;
  }

  const hasStaffThread = Boolean(openCall.staffThreadId);

  let persisted;
  try {
    persisted = await svc.recordMessage({
      callId: openCall.id,
      senderPlayerId: player.id,
      content: message.content,
      senderDiscordMessageId: message.id,
    });
  } catch (err) {
    if (err instanceof PhoneServiceError) {
      // Mid-call death of the sender: refuse the message AND end the call so the
      // counterparty isn't left typing into a one-way pipe. Mirrors the answer/decline
      // alive-check, applied to in-call writes.
      if (err.code === 'dead') {
        try {
          await message.reply({
            content: err.message + ' The call has been ended.',
            allowedMentions: { repliedUser: false, parse: [] },
          });
        } catch {
          /* ignore */
        }
        try {
          await svc.systemEndCall(openCall.id, 'session_reset');
          await hangUpAndNotify(client, openCall.id, 'session_reset');
        } catch (innerErr) {
          console.error('[phone:event] failed to end call after sender death:', innerErr);
        }
        return;
      }
      try {
        await message.reply({
          content: err.message,
          allowedMentions: { repliedUser: false, parse: [] },
        });
      } catch {
        /* ignore */
      }
      return;
    }
    console.error('[phone:event] failed to record message:', err);
    return;
  }

  // Long-message acknowledgement: when the sender's content exceeded the per-DM budget,
  // their chunked output may look fragmented to the recipient. React on the source DM so
  // the sender can tell their message was split.
  if (message.content.length > PHONE_DM_CHUNK_BUDGET) {
    try {
      await message.react('\u{1F4E8}'); // 📨
    } catch {
      /* reaction is purely informational; ignore failure */
    }
  }

  try {
    if (!hasStaffThread) {
      await postCallOpenedToStaffThread(client, participants);
    }
    await relayMessage(client, participants, persisted, senderIsCaller);
  } catch (err) {
    if (err instanceof RecipientDmClosedError) {
      console.error(`[phone:event] recipient ${err.discordUserId} has DMs closed; ending call`);
      try {
        // Let the sender know what happened, since their line goes silent otherwise.
        await message.reply({
          content: 'The other party has DMs closed. The call has been ended.',
          allowedMentions: { repliedUser: false, parse: [] },
        });
      } catch {
        /* ignore */
      }
      try {
        await svc.systemEndCall(openCall.id, 'dm_closed');
        await hangUpAndNotify(client, openCall.id, 'dm_closed');
      } catch (innerErr) {
        console.error('[phone:event] failed to end call after recipient DM closed:', innerErr);
      }
      return;
    }
    console.error('[phone:event] relay error, ending call:', err);
    try {
      await svc.systemEndCall(openCall.id, 'relay_failed');
      await hangUpAndNotify(client, openCall.id, 'relay_failed');
    } catch (innerErr) {
      console.error('[phone:event] failed to end call after relay error:', innerErr);
    }
  }
}

export function registerMessageCreateEvent(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.channel.type === ChannelType.DM) {
        await handleDmMessage(client, message);
        return;
      }
      await handleTicketThreadMessage(message);
    } catch (err) {
      console.error('[messageCreate:event] unhandled error:', err);
    }
  });
}
