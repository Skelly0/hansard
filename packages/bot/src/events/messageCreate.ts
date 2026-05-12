import { ChannelType, Events, type Client, type Message } from 'discord.js';
import { eq } from 'drizzle-orm';
import { players } from '@hansard/db';
import { db } from '../db.js';
import {
  PhoneService,
  PhoneServiceError,
  type CallParticipants,
} from '@hansard/api/services/phoneService';
import {
  relayMessage,
  hangUpAndNotify,
  postCallOpenedToStaffThread,
  RecipientDmClosedError,
} from '../utils/phoneRelay.js';
import { PHONE_HINT_COOLDOWN_MS } from '@hansard/shared';

const HINT_MAP_MAX = 500;
// 1900 is the per-DM chunk budget defined in phoneRelay.ts; mirror it here so the long-
// message acknowledgement reflects whether the recipient actually saw the message split.
const LONG_MESSAGE_THRESHOLD = 1900;

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
  if (!message.content) return;

  // NOTE: do NOT filter on `startsWith('/')`. In DM channels Discord delivers actual slash
  // commands as separate Interaction events, not as messages — so any `/`-prefixed message
  // here is plain text the player typed and should be relayed (and frozen) like any other.

  const player = await resolvePlayer(message.author.id);
  if (!player || !player.characterName) {
    // OAuth-only placeholders and non-registered Discord users get no reply — we don't want
    // to leak the bot's existence/purpose to randos.
    return;
  }

  const svc = new PhoneService(db);
  const openCall = await svc.findOpenCallForPlayer(player.id);
  if (!openCall) {
    if (shouldShowHint(message.author.id)) {
      try {
        await message.reply(
          'You\'re not in a call right now. Use `/phone dial <number>` to start one. (Messages outside a call are not stored or forwarded.)',
        );
      } catch {
        /* DMs may be closed mid-stream; ignore */
      }
    }
    return;
  }

  if (openCall.status === 'ringing') {
    try {
      await message.reply('Your line is still ringing. Wait for the other side to pick up, or `/phone hangup` to cancel.');
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
          await message.reply(err.message + ' The call has been ended.');
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
        await message.reply(err.message);
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
  if (message.content.length > LONG_MESSAGE_THRESHOLD) {
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
        await message.reply('The other party has DMs closed. The call has been ended.');
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
      if (message.channel.type !== ChannelType.DM) return;
      await handleDmMessage(client, message);
    } catch (err) {
      console.error('[phone:event] unhandled error in messageCreate:', err);
    }
  });
}
