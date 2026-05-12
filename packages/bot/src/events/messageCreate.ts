import { ChannelType, Events, type Client, type Message } from 'discord.js';
import { eq } from 'drizzle-orm';
import { players } from '@hansard/db';
import { db } from '../db.js';
import {
  PhoneService,
  PhoneServiceError,
  type CallParticipants,
} from '@hansard/api/services/phoneService';
import { relayMessage, hangUpAndNotify, postCallOpenedToStaffThread } from '../utils/phoneRelay.js';

// Players who have been told "you're not in a call" in the last minute. Avoids spamming
// hint replies if they type several lines into the DM while no call is active.
const recentHinted = new Map<string, number>();
const HINT_COOLDOWN_MS = 60 * 1000;

function shouldShowHint(discordId: string): boolean {
  const last = recentHinted.get(discordId) ?? 0;
  if (Date.now() - last < HINT_COOLDOWN_MS) return false;
  recentHinted.set(discordId, Date.now());
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
  // Fully fetch if partial (older messages or first DM after restart arrive partial).
  if (message.partial) {
    try {
      await message.fetch();
    } catch (err) {
      console.error('[phone] failed to hydrate DM:', err);
      return;
    }
  }
  if (message.author.bot) return;
  if (!message.content || message.content.startsWith('/')) return;

  const player = await resolvePlayer(message.author.id);
  if (!player || !player.characterName) {
    // OAuth-only placeholder accounts and non-registered Discord users get no reply —
    // we don't want to leak "this bot exists for X reason" to randos.
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
    console.error('[phone] failed to load participants for active call:', err);
    return;
  }

  const senderIsCaller = participants.callerPlayer.id === player.id;
  // First message of a brand-new call: post the "call opened" header to the staff thread.
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
    console.error('[phone] failed to record message:', err);
    return;
  }

  try {
    if (!hasStaffThread) {
      await postCallOpenedToStaffThread(client, participants);
    }
    await relayMessage(client, participants, persisted, senderIsCaller);
  } catch (err) {
    console.error('[phone] relay error, ending call:', err);
    try {
      await svc.endCall(openCall.id, player.id, 'relay_failed');
      await hangUpAndNotify(client, openCall.id, 'relay_failed');
    } catch (innerErr) {
      console.error('[phone] failed to end call after relay error:', innerErr);
    }
  }
}

export function registerMessageCreateEvent(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.channel.type !== ChannelType.DM) return;
      await handleDmMessage(client, message);
    } catch (err) {
      console.error('Unhandled error in messageCreate handler:', err);
    }
  });
}
