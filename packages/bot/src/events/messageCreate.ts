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

const HINT_COOLDOWN_MS = 60 * 1000;
const HINT_MAP_MAX = 500;

/**
 * Bounded LRU-ish cooldown map for "you're not in a call" hints. Prevents an unbounded
 * memory leak from random DMs at the bot. Eviction is simple: when the map exceeds
 * HINT_MAP_MAX, drop the oldest half. Discord DM volume to the bot is low enough that
 * this is well below O(call rate).
 */
const recentHinted = new Map<string, number>();

function shouldShowHint(discordId: string): boolean {
  const last = recentHinted.get(discordId) ?? 0;
  if (Date.now() - last < HINT_COOLDOWN_MS) return false;
  recentHinted.set(discordId, Date.now());
  if (recentHinted.size > HINT_MAP_MAX) {
    // Drop the earliest-inserted half. Insertion order is preserved by Map iteration.
    const drop = Math.floor(HINT_MAP_MAX / 2);
    let i = 0;
    for (const key of recentHinted.keys()) {
      if (i >= drop) break;
      recentHinted.delete(key);
      i++;
    }
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
