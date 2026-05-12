import {
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  type Client,
  type Guild,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import { db } from '../db.js';
import {
  PhoneService,
  type PhoneCall,
  type PhoneMessage,
  type PhoneNumber,
  type PhoneTap,
} from '@hansard/api/services/phoneService';
import { resolveStaffRoleIds } from './staffRoles.js';
import { validateTapMirrorChannel } from './tapMirrorChannel.js';
import {
  PHONE_FORCE_END_REASON_PREFIX,
  PHONE_TAP_FAILURE_THRESHOLD,
  formatPhoneEndedReason,
} from '@hansard/shared';

const PHONE_LOG_CHANNEL_ENV = 'PHONE_LOG_CHANNEL_ID';
const PHONE_TAP_CHANNEL_ENV = 'PHONE_TAP_CHANNEL_ID';
const PHONE_GUILD_ENV = 'PHONE_GUILD_ID';

const CALL_COLOR = 0x9b7cb8;
const STAFF_PALETTE = 0x788c5d;
const ENDED_PALETTE = 0x9c9890;
const TAP_PALETTE = 0xc25b4e;

/** Discord DM content cap is 2000; budget for the "+number:" prefix leaves us ~1900 safe. */
const DM_CONTENT_BUDGET = 1900;
/** Embed description cap is 4096; leave room for the source prefix and footer. */
const EMBED_DESC_BUDGET = 4000;

export class RecipientDmClosedError extends Error {
  constructor(public discordUserId: string, public cause: unknown) {
    super(`Recipient ${discordUserId} has DMs closed`);
    this.name = 'RecipientDmClosedError';
  }
}

function isDmClosedError(err: unknown): boolean {
  if (err instanceof DiscordAPIError) {
    // 50007 = Cannot send messages to this user (DMs disabled / not friends).
    return err.code === 50007 || err.code === '50007';
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return code === 50007 || code === '50007';
  }
  return false;
}

function chunkForDm(text: string): string[] {
  return chunkText(text, DM_CONTENT_BUDGET);
}
function chunkForEmbed(text: string): string[] {
  return chunkText(text, EMBED_DESC_BUDGET);
}
function chunkText(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > budget) {
    // Try to break at a newline or space within the budget.
    let cut = remaining.lastIndexOf('\n', budget);
    if (cut < budget * 0.6) cut = remaining.lastIndexOf(' ', budget);
    if (cut < budget * 0.6) cut = budget;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function resolveGuild(client: Client): Guild | null {
  const configured = process.env[PHONE_GUILD_ENV]?.trim();
  if (configured) {
    const cached = client.guilds.cache.get(configured);
    if (cached) return cached;
  }
  // Single-guild deployment fallback (mirrors how /ticket create operates from DMs).
  if (client.guilds.cache.size > 1 && !configured) {
    console.warn('[phone:relay] Multiple guilds in cache and PHONE_GUILD_ID unset — picking arbitrary guild');
  }
  return client.guilds.cache.first() ?? null;
}

async function fetchPhoneLogChannel(client: Client): Promise<TextChannel | null> {
  const id = process.env[PHONE_LOG_CHANNEL_ENV]?.trim();
  if (!id) return null;
  try {
    const channel = await client.channels.fetch(id);
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    return channel as TextChannel;
  } catch (err) {
    console.error('[phone:relay] failed to fetch PHONE_LOG_CHANNEL_ID:', err);
    return null;
  }
}

// Per-pair mutex preventing two simultaneous first-messages from each creating a Discord thread.
// Keyed by `${minPlayerId}:${maxPlayerId}`. Cleared after the thread is created (success or fail).
const threadCreateLocks = new Map<string, Promise<ThreadChannel | null>>();

/**
 * Look up or create the per-pair private thread that staff use to oversee all calls
 * between the same two players. Reused across multiple calls. Per-pair in-memory mutex
 * prevents concurrent first-message races from orphaning a Discord thread.
 */
export async function ensurePhoneThread(
  client: Client,
  participants: {
    callerPlayer: { id: string; characterName: string | null };
    recipientPlayer: { id: string; characterName: string | null };
  },
): Promise<ThreadChannel | null> {
  const svc = new PhoneService(db);
  const { thread: existing, pair } = await svc.findOrReserveThread(
    participants.callerPlayer.id,
    participants.recipientPlayer.id,
  );

  if (existing) {
    try {
      const fetched = await client.channels.fetch(existing.discordThreadId);
      if (fetched && (fetched.type === ChannelType.PrivateThread || fetched.type === ChannelType.PublicThread)) {
        return fetched as ThreadChannel;
      }
    } catch (err) {
      console.error('[phone:relay] failed to fetch persisted phone thread, recreating:', err);
    }
  }

  const lockKey = `${pair[0]}:${pair[1]}`;
  const inflight = threadCreateLocks.get(lockKey);
  if (inflight) return inflight;

  const created = (async () => {
    const channel = await fetchPhoneLogChannel(client);
    if (!channel) {
      console.warn('[phone:relay] PHONE_LOG_CHANNEL_ID not configured — no staff mirror created');
      return null;
    }

    const guild = resolveGuild(client);
    if (!guild) {
      console.warn('[phone:relay] no guild available for staff thread creation');
      return null;
    }

    const callerName = participants.callerPlayer.characterName ?? 'Unknown';
    const recipientName = participants.recipientPlayer.characterName ?? 'Unknown';
    const threadName = `\u{260E} ${callerName} \u{2194} ${recipientName}`.slice(0, 95);

    let thread: ThreadChannel;
    try {
      thread = await channel.threads.create({
        name: threadName,
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: 1440,
        reason: `Phone log for ${callerName} and ${recipientName}`,
      });
    } catch (err) {
      console.error('[phone:relay] failed to create phone thread:', err);
      return null;
    }

    await svc.persistThread(pair, thread.id);
    await sendStaffJoinPing(thread, guild, callerName, recipientName);
    return thread;
  })().finally(() => {
    threadCreateLocks.delete(lockKey);
  });

  threadCreateLocks.set(lockKey, created);
  return created;
}

async function sendStaffJoinPing(
  thread: ThreadChannel,
  guild: Guild,
  callerName: string,
  recipientName: string,
): Promise<void> {
  try {
    await thread.send({
      allowedMentions: { roles: [] },
      content: `\u{1F4DE} Phone log opened: **${callerName}** \u{2194} **${recipientName}**.`,
    });
  } catch (err) {
    console.error('[phone:relay] failed to send opener message:', err);
  }
  try {
    const staffRoleIds = await resolveStaffRoleIds(guild);
    if (staffRoleIds.length === 0) return;
    const mentions = staffRoleIds.map((id) => `<@&${id}>`).join(' ');
    await thread.send({
      allowedMentions: { roles: staffRoleIds },
      content: `${mentions} new phone log requires oversight.`,
    });
    // Best-effort: actually add the staff role's current members to the thread. A role ping
    // notifies but does NOT auto-add to private threads. Without this, staff need to manually
    // click into the thread before they receive updates.
    try {
      // Ensure the guild's member cache is reasonably warm. `Guild.members.fetch()` without
      // args fetches all members (limited by `GuildMembers` intent — which we have).
      // Skip if a fetch fails; we'll just miss best-effort auto-add.
      await guild.members.fetch().catch(() => undefined);
      const addBatch: Promise<unknown>[] = [];
      const batchSize = 5;
      for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;
        const hasStaffRole = member.roles.cache.some((r) => staffRoleIds.includes(r.id));
        if (!hasStaffRole) continue;
        addBatch.push(thread.members.add(member.id).catch((err: unknown) => {
          console.error(`[phone:relay] failed to add staff member ${member.id} to thread:`, err);
        }));
        if (addBatch.length >= batchSize) {
          await Promise.all(addBatch.splice(0, addBatch.length));
        }
      }
      if (addBatch.length > 0) await Promise.all(addBatch);
    } catch (err) {
      console.error('[phone:relay] failed to auto-add staff to phone thread:', err);
    }
  } catch (err) {
    console.error('[phone:relay] failed to ping staff roles:', err);
  }
}

interface RelayContext {
  call: PhoneCall;
  callerNumber: PhoneNumber;
  recipientNumber: PhoneNumber;
  callerPlayer: { id: string; characterName: string | null; discordId: string; isAlive: boolean };
  recipientPlayer: { id: string; characterName: string | null; discordId: string; isAlive: boolean };
}

/**
 * Relay a recorded message from `senderPlayerId` to the other party, mirror to the staff thread,
 * and fan out to active taps. Throws `RecipientDmClosedError` if the recipient's DM channel is
 * closed (50007) so the caller can end the call and surface the failure.
 *
 * `message` is the already-persisted `phone_messages` row from `recordMessage`.
 */
export async function relayMessage(
  client: Client,
  context: RelayContext,
  message: PhoneMessage,
  senderIsCaller: boolean,
): Promise<void> {
  const svc = new PhoneService(db);
  const sender = senderIsCaller ? context.callerPlayer : context.recipientPlayer;
  const recipient = senderIsCaller ? context.recipientPlayer : context.callerPlayer;
  const senderNumber = senderIsCaller ? context.callerNumber : context.recipientNumber;

  const staffThread = await ensurePhoneThread(client, context);
  let staffMirrorId: string | null = null;
  if (staffThread) {
    staffMirrorId = await postToStaffThread(staffThread, context, sender, senderNumber, message.content);
    if (!context.call.staffThreadId) {
      await svc.setStaffThread(context.call.id, staffThread.id);
    }
  }

  let recipientCopyId: string | null = null;
  let recipientDeliveryError: unknown = null;
  try {
    recipientCopyId = await sendToRecipient(client, recipient.discordId, senderNumber, message.content);
  } catch (err) {
    recipientDeliveryError = err;
  }

  await svc.updateMessageMirrorIds(message.id, {
    recipientDiscordMessageId: recipientCopyId,
    staffMirrorMessageId: staffMirrorId,
  });

  const taps = await svc.getActiveTapsForNumbers([context.callerNumber.id, context.recipientNumber.id]);
  if (taps.length === 0) {
    if (recipientDeliveryError) throw recipientDeliveryError;
    return;
  }

  // Sequence tap fanout instead of Promise.all to avoid a Discord global-50-msgs/s spike
  // when a single message routes to many taps. Each tap is independent — at most one tap
  // mirror channel + one tap user DM per tap.
  for (const tap of taps) {
    await deliverTapCopy(client, svc, tap, context, sender, senderNumber, message);
    // Circuit breaker: if the last N attempts for this tap all errored, auto-revoke it so
    // we stop spamming Discord with re-attempts and surface the failure in the audit log.
    try {
      const fails = await svc.countTrailingTapFailures(tap.id, PHONE_TAP_FAILURE_THRESHOLD);
      if (fails >= PHONE_TAP_FAILURE_THRESHOLD) {
        await svc.autoRevokeBrokenTap(tap.id, `Auto-revoked after ${fails} consecutive delivery failures.`);
        console.warn(`[phone:relay] auto-revoked tap ${tap.id} after ${fails} consecutive failures`);
      }
    } catch (err) {
      console.error('[phone:relay] tap circuit-breaker check failed:', err);
    }
  }

  if (recipientDeliveryError) throw recipientDeliveryError;
}

async function sendToRecipient(
  client: Client,
  recipientDiscordId: string,
  senderNumber: PhoneNumber,
  content: string,
): Promise<string | null> {
  const chunks = chunkForDm(content);
  let firstId: string | null = null;
  try {
    const user = await client.users.fetch(recipientDiscordId);
    for (let i = 0; i < chunks.length; i++) {
      const piece = chunks[i];
      const prefix = chunks.length > 1 ? `**${senderNumber.numberRaw}** [${i + 1}/${chunks.length}]: ` : `**${senderNumber.numberRaw}:** `;
      const dm = await user.send({ content: `${prefix}${piece}` });
      if (i === 0) firstId = dm.id;
    }
    return firstId;
  } catch (err) {
    console.error('[phone:relay] recipient DM failed:', err);
    if (isDmClosedError(err)) {
      throw new RecipientDmClosedError(recipientDiscordId, err);
    }
    throw err;
  }
}

async function postToStaffThread(
  thread: ThreadChannel,
  context: RelayContext,
  sender: { id: string; characterName: string | null },
  senderNumber: PhoneNumber,
  content: string,
): Promise<string | null> {
  const recipient = sender.id === context.callerPlayer.id ? context.recipientPlayer : context.callerPlayer;
  const senderName = sender.characterName ?? 'Unknown';
  const recipientName = recipient.characterName ?? 'Unknown';
  const chunks = chunkForEmbed(content);
  let firstId: string | null = null;
  try {
    for (let i = 0; i < chunks.length; i++) {
      const piece = chunks[i];
      const embed = new EmbedBuilder()
        .setColor(CALL_COLOR)
        .setAuthor({
          name:
            chunks.length > 1
              ? `${senderName} (${senderNumber.numberRaw}) [${i + 1}/${chunks.length}]`
              : `${senderName} (${senderNumber.numberRaw})`,
        })
        .setDescription(piece)
        .setFooter({ text: `to ${recipientName}` })
        .setTimestamp(new Date());
      const sent = await thread.send({ embeds: [embed], allowedMentions: { parse: [] } });
      if (i === 0) firstId = sent.id;
    }
    return firstId;
  } catch (err) {
    console.error('[phone:relay] failed to mirror to staff thread:', err);
    return null;
  }
}

async function deliverTapCopy(
  client: Client,
  svc: PhoneService,
  tap: PhoneTap,
  context: RelayContext,
  sender: { id: string; characterName: string | null },
  senderNumber: PhoneNumber,
  message: PhoneMessage,
): Promise<void> {
  const recipient = sender.id === context.callerPlayer.id ? context.recipientPlayer : context.callerPlayer;
  const senderName = sender.characterName ?? 'Unknown';
  const recipientName = recipient.characterName ?? 'Unknown';
  // Use full content here too — taps are an audit channel, fidelity is the whole point.
  const chunks = chunkForEmbed(message.content);

  const channelId = tap.mirrorChannelId ?? process.env[PHONE_TAP_CHANNEL_ENV]?.trim();
  let mirrorMessageId: string | null = null;
  const errors: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const piece = chunks[i];
    const embed = new EmbedBuilder()
      .setColor(TAP_PALETTE)
      .setAuthor({
        name:
          chunks.length > 1
            ? `\u{1F575}\u{FE0F} Wiretap — ${senderName} (${senderNumber.numberRaw}) [${i + 1}/${chunks.length}]`
            : `\u{1F575}\u{FE0F} Wiretap — ${senderName} (${senderNumber.numberRaw})`,
      })
      .setDescription(piece)
      .setFooter({ text: `to ${recipientName} \u{2022} call ${context.call.id.slice(0, 8)}` })
      .setTimestamp(new Date());

    if (channelId) {
      try {
        const channel = await client.channels.fetch(channelId);
        const channelError = channel ? validateTapMirrorChannel(channel as never) : 'tap channel not found';
        if (channelError) {
          errors.push(channelError);
        } else if (channel && 'send' in channel && typeof (channel as { send?: unknown }).send === 'function') {
          const sent = await (channel as TextChannel | ThreadChannel).send({
            embeds: [embed],
            allowedMentions: { parse: [] },
          });
          if (i === 0) mirrorMessageId = sent.id;
        } else {
          errors.push('tap channel is not sendable');
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        console.error('[phone:relay] tap channel delivery failed:', err);
      }
    }

    if (tap.mirrorDiscordUserId) {
      try {
        const user = await client.users.fetch(tap.mirrorDiscordUserId);
        const dm = await user.send({ embeds: [embed] });
        if (!mirrorMessageId && i === 0) mirrorMessageId = dm.id;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        console.error('[phone:relay] tap user DM failed:', err);
      }
    }
  }

  await svc.recordTapDelivery(message.id, tap.id, {
    mirrorMessageId,
    error: errors.length ? errors.join('; ') : mirrorMessageId ? null : 'no tap target configured',
  });
}

/**
 * Best-effort: notify both parties + the staff thread that a call has ended,
 * regardless of which side hung up. Also disables any persisted ring-DM buttons.
 */
export async function hangUpAndNotify(
  client: Client,
  callId: string,
  endedReason:
    | 'hangup_caller'
    | 'hangup_recipient'
    | 'cancelled_by_caller'
    | 'declined_by_recipient'
    | 'ring_timeout'
    | 'force_ended_by_staff'
    | 'dm_closed'
    | 'relay_failed'
    | 'session_reset'
    | 'number_deactivated',
): Promise<void> {
  const svc = new PhoneService(db);
  let context: RelayContext;
  try {
    context = await svc.getCallParticipants(callId);
  } catch (err) {
    console.error('[phone:relay] hangup notify: could not load call participants:', err);
    return;
  }

  const reasonText: Record<typeof endedReason, string> = {
    hangup_caller: 'The caller hung up.',
    hangup_recipient: 'The recipient hung up.',
    cancelled_by_caller: 'The caller cancelled before you picked up.',
    declined_by_recipient: 'The recipient declined the call.',
    ring_timeout: 'The recipient did not answer in time.',
    force_ended_by_staff: 'A staff member ended this call.',
    dm_closed: 'The other party could not be reached via DM.',
    relay_failed: 'The relay failed; the call was ended automatically.',
    session_reset: 'The call was reset by a bot restart.',
    number_deactivated: 'One of the lines on this call was retired.',
  };

  // If the persisted DB reason carries a staff-end note (e.g. `force_ended_by_staff:<note>`),
  // surface the note in the participant DM so they see the staff explanation.
  let description = reasonText[endedReason];
  if (
    endedReason === 'force_ended_by_staff'
    && context.call.endedReason?.startsWith(PHONE_FORCE_END_REASON_PREFIX)
  ) {
    const note = context.call.endedReason.slice(PHONE_FORCE_END_REASON_PREFIX.length).trim();
    if (note) description = `A staff member ended this call: ${note}`;
  }
  // Use the shared formatter where possible so the text matches /phone history.
  if (!description) description = formatPhoneEndedReason(endedReason);

  const embed = new EmbedBuilder()
    .setTitle('\u{260E} Call ended')
    .setColor(ENDED_PALETTE)
    .setDescription(description);

  for (const player of [context.callerPlayer, context.recipientPlayer]) {
    try {
      const user = await client.users.fetch(player.discordId);
      await user.send({ embeds: [embed] });
    } catch {
      /* DMs may be closed; ignore */
    }
  }

  // Disable buttons on the ring DM if persisted. Only relevant when the call terminated
  // while still in `ringing` status — but cheap to check.
  if (context.call.ringDiscordMessageId) {
    try {
      const recipientUser = await client.users.fetch(context.recipientPlayer.discordId);
      const dm = await recipientUser.createDM();
      const message = await dm.messages.fetch(context.call.ringDiscordMessageId);
      const disabledEmbed = new EmbedBuilder()
        .setTitle('\u{260E} Call ended')
        .setColor(ENDED_PALETTE)
        .setDescription(reasonText[endedReason]);
      await message.edit({ embeds: [disabledEmbed], components: [] });
    } catch (err) {
      // Recipient may have closed DMs, ring message may have been deleted, or it was
      // never sent in the first place. Best-effort — log and continue.
      console.error('[phone:relay] failed to disable ring DM buttons:', err);
    }
  }

  if (context.call.staffThreadId) {
    try {
      const thread = await client.channels.fetch(context.call.staffThreadId);
      if (thread && 'send' in thread && typeof (thread as { send?: unknown }).send === 'function') {
        await (thread as ThreadChannel).send({ embeds: [embed], allowedMentions: { parse: [] } });
      }
    } catch (err) {
      console.error('[phone:relay] hangup notify: failed to update staff thread:', err);
    }
  }
}

export async function postCallOpenedToStaffThread(
  client: Client,
  context: RelayContext,
): Promise<void> {
  const thread = await ensurePhoneThread(client, context);
  if (!thread) return;
  const svc = new PhoneService(db);
  if (!context.call.staffThreadId) {
    await svc.setStaffThread(context.call.id, thread.id);
  }
  const embed = new EmbedBuilder()
    .setTitle('\u{1F4DE} Call connected')
    .setColor(STAFF_PALETTE)
    .addFields(
      { name: 'Caller', value: `${context.callerPlayer.characterName ?? '?'} (${context.callerNumber.numberRaw})`, inline: true },
      { name: 'Recipient', value: `${context.recipientPlayer.characterName ?? '?'} (${context.recipientNumber.numberRaw})`, inline: true },
    )
    .setTimestamp(new Date());
  try {
    await thread.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[phone:relay] failed to post call-opened event to staff thread:', err);
  }
}

// Internal helper exposed for testing the chunker without spinning up a Discord client.
export const __internal = { chunkText, validateTapMirrorChannel };
