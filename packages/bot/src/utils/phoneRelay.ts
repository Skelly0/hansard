import {
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  escapeMarkdown,
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
  type PhoneMessageTapDelivery,
  type PhoneNumber,
  type PhoneTap,
} from '@hansard/api/services/phoneService';
import { resolveStaffRoleIds } from './staffRoles.js';
import { validateTapMirrorChannel } from './tapMirrorChannel.js';
import {
  PHONE_FORCE_END_REASON_PREFIX,
  PHONE_TAP_FAILURE_THRESHOLD,
  PHONE_DM_CHUNK_BUDGET,
  formatPhoneEndedReason,
} from '@hansard/shared';

const PHONE_LOG_CHANNEL_ENV = 'PHONE_LOG_CHANNEL_ID';
const PHONE_TAP_CHANNEL_ENV = 'PHONE_TAP_CHANNEL_ID';

const CALL_COLOR = 0x9b7cb8;
const STAFF_PALETTE = 0x788c5d;
const ENDED_PALETTE = 0x9c9890;
const TAP_PALETTE = 0xc25b4e;

/** Discord DM content cap is 2000; budget for the "+number:" prefix leaves us ~1900 safe. */
const DM_CONTENT_BUDGET = PHONE_DM_CHUNK_BUDGET;
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

function publicNumberLabel(number: PhoneNumber): string {
  return number.pseudonym ? `${escapeMarkdown(number.pseudonym)} (${number.numberRaw})` : number.numberRaw;
}

export function formatVoicemailSentDescription(context: Pick<RelayContext, 'callerNumber'>): string {
  return `The caller from ${publicNumberLabel(context.callerNumber)} was sent to voicemail.`;
}

function staffNumberLabel(name: string | null, number: PhoneNumber): string {
  const realName = name ?? 'Unknown';
  return number.pseudonym
    ? `${realName} as ${number.pseudonym} (${number.numberRaw})`
    : `${realName} (${number.numberRaw})`;
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
    // H3: `slice` operates on UTF-16 code units. A 4-byte emoji (or any astral-plane
    // codepoint) is a surrogate pair; cutting between its halves renders both sides as `?`.
    // Only the hard-split branch (`cut = budget`) can land mid-pair — the `\n`/space branches
    // resolve to a BMP boundary char (U+000A / U+0020), never a surrogate — but guarding
    // unconditionally is harmless and robust if the break heuristic ever changes. If `cut`
    // lands on a low surrogate (0xDC00–0xDFFF), the high surrogate is the unit before it, so
    // back up by one to move the whole pair to the next chunk intact. The `cut >= 1` floor
    // keeps a pathologically small `budget` from producing an empty chunk + infinite loop.
    if (cut > 0 && cut < remaining.length) {
      const code = remaining.charCodeAt(cut);
      if (code >= 0xdc00 && code <= 0xdfff) cut = Math.max(1, cut - 1);
    }
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
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

// Per-pair in-memory mutex — a cheap same-process short-circuit so two concurrent
// first-messages in *this* process don't both enter the create path before the DB advisory
// lock even gets a chance. The real cross-process/cross-shard safety comes from
// `PhoneService.findOrCreateThread`'s `pg_advisory_xact_lock`; this Map is just an
// optimization. Keyed by `${minPlayerId}:${maxPlayerId}`.
const threadCreateLocks = new Map<string, Promise<ThreadChannel | null>>();

/**
 * Builds the `{ createThread, onOrphan }` callback pair for
 * `PhoneService.findOrCreateThread`. Shared between the live relay's
 * `ensurePhoneThread` and the one-shot `backfill:phone-threads` script so a
 * future change to thread-creation semantics applies in both places.
 *
 * Captures the just-created `ThreadChannel` in a closure-local cell so a lost
 * persist race (`onOrphan`) can delete it.
 */
export function createPhoneThreadWithOrphanCleanup(
  client: Client,
  channel: TextChannel,
  threadName: string,
  reason: string,
): {
  callbacks: {
    createThread: () => Promise<string | null>;
    onOrphan: (discordThreadId: string) => Promise<void>;
  };
  getCreatedThread: () => ThreadChannel | null;
} {
  let createdThread: ThreadChannel | null = null;

  return {
    callbacks: {
      createThread: async () => {
        try {
          createdThread = await channel.threads.create({
            name: threadName,
            type: ChannelType.PrivateThread,
            invitable: false,
            autoArchiveDuration: 1440,
            reason,
          });
          return createdThread.id;
        } catch (err) {
          console.error('[phone:relay] failed to create phone thread:', err);
          return null;
        }
      },
      onOrphan: async (discordThreadId) => {
        try {
          const orphan = await client.channels.fetch(discordThreadId);
          if (
            orphan
            && 'delete' in orphan
            && typeof (orphan as { delete?: unknown }).delete === 'function'
          ) {
            await (orphan as ThreadChannel).delete('Orphaned phone thread — lost persist race');
          }
        } catch (err) {
          console.error('[phone:relay] failed to delete orphaned phone thread:', err);
        }
      },
    },
    getCreatedThread: () => createdThread,
  };
}

/**
 * Look up or create the per-pair private thread that staff use to oversee all calls
 * between the same two players. Reused across multiple calls.
 *
 * H5: thread creation goes through `PhoneService.findOrCreateThread`, which wraps
 * find → create → persist in a transaction holding a `pg_advisory_xact_lock` on the sorted
 * pair key. That serializes the create section cluster-wide, so a bot restart or a
 * multi-shard deployment can't have two relays both create a Discord thread. If this relay
 * still loses a persist race (unique violation on the pair or discord_thread_id index), the
 * `onOrphan` hook deletes the Discord thread we just created so it isn't left dangling.
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
  let staleThreadId: string | null = null;

  if (existing) {
    try {
      const fetched = await client.channels.fetch(existing.discordThreadId);
      if (fetched && (fetched.type === ChannelType.PrivateThread || fetched.type === ChannelType.PublicThread)) {
        return fetched as ThreadChannel;
      }
      staleThreadId = existing.discordThreadId;
    } catch (err) {
      console.error('[phone:relay] failed to fetch persisted phone thread, recreating:', err);
      staleThreadId = existing.discordThreadId;
    }
  }

  const lockKey = `${pair[0]}:${pair[1]}`;
  const inflight = threadCreateLocks.get(lockKey);
  if (inflight) return inflight;

  const created = (async (): Promise<ThreadChannel | null> => {
    const channel = await fetchPhoneLogChannel(client);
    if (!channel) {
      console.warn('[phone:relay] PHONE_LOG_CHANNEL_ID not configured — no staff mirror created');
      return null;
    }

    const guild = channel.guild;

    const callerName = participants.callerPlayer.characterName ?? 'Unknown';
    const recipientName = participants.recipientPlayer.characterName ?? 'Unknown';
    const threadName = `\u{260E} ${callerName} \u{2194} ${recipientName}`.slice(0, 95);

    const { callbacks, getCreatedThread } = createPhoneThreadWithOrphanCleanup(
      client,
      channel,
      threadName,
      `Phone log for ${callerName} and ${recipientName}`,
    );

    const { thread: row, created: didCreate } = await svc.findOrCreateThread(
      participants.callerPlayer.id,
      participants.recipientPlayer.id,
      {
        ...callbacks,
        replaceThreadId: staleThreadId ?? undefined,
      },
    );

    if (!row) return null;

    const createdThread = getCreatedThread();

    if (didCreate && createdThread) {
      // We won — finish wiring up the brand-new thread.
      await sendStaffJoinPing(createdThread, guild, callerName, recipientName);
      return createdThread;
    }

    // Either a row already existed, or we lost the race and our thread was orphan-deleted.
    // Resolve the winning row's Discord thread.
    try {
      const fetched = await client.channels.fetch(row.discordThreadId);
      if (fetched && (fetched.type === ChannelType.PrivateThread || fetched.type === ChannelType.PublicThread)) {
        return fetched as ThreadChannel;
      }
    } catch (err) {
      console.error('[phone:relay] failed to fetch winning phone thread after race:', err);
    }
    return null;
  })().finally(() => {
    threadCreateLocks.delete(lockKey);
  });

  threadCreateLocks.set(lockKey, created);
  return created;
}

export async function sendStaffJoinPing(
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
    // Fire-and-forget the staff member auto-add. `Guild.members.fetch()` without args pulls
    // every member (in a 1000+ member guild that's a multi-second blocking RPC), and the
    // first relayed message of a brand-new pair shouldn't pay that cost — the ping above
    // already woke staff up. Subsequent messages reuse the thread.
    void backgroundStaffAdd(thread, guild, staffRoleIds);
  } catch (err) {
    console.error('[phone:relay] failed to ping staff roles:', err);
  }
}

export async function backgroundStaffAdd(
  thread: ThreadChannel,
  guild: Guild,
  staffRoleIds: string[],
): Promise<void> {
  try {
    // Ensure the guild's member cache is reasonably warm. Limited by `GuildMembers` intent.
    // Skip silently if a fetch fails — we'll just miss best-effort auto-add for now and the
    // staff role ping is already in the thread.
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
 * `recorded` is the `RecordedMessage` from `PhoneService.recordMessage` — `recorded.message`
 * is the persisted transcript row, and `recorded.tapDeliveries` are the **placeholder**
 * `phone_message_tap_deliveries` rows the service pre-created inside the message-insert
 * transaction (H1). The relay does NOT discover taps itself anymore; it fills in each
 * pre-created placeholder with the Discord send result via `completeTapDelivery`. This keeps
 * the invariant "every tap delivery for an active tap has a row" true even if the relay
 * crashes between the message commit and the Discord send.
 */
export async function relayMessage(
  client: Client,
  context: RelayContext,
  recorded: { message: PhoneMessage; tapDeliveries: PhoneMessageTapDelivery[] },
  senderIsCaller: boolean,
): Promise<void> {
  const { message, tapDeliveries } = recorded;
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

  if (tapDeliveries.length === 0) {
    if (recipientDeliveryError) throw recipientDeliveryError;
    return;
  }

  // Resolve the tap config for each pre-created placeholder. The placeholders were snapshotted
  // inside `recordMessage`'s transaction; a tap revoked since then is filtered by the
  // `isTapActive` re-check in `deliverTapCopy`.
  const tapRows = await svc.getActiveTapsForNumbers([context.callerNumber.id, context.recipientNumber.id]);
  const tapById = new Map(tapRows.map((t) => [t.id, t]));

  // Sequence tap fanout instead of Promise.all to avoid a Discord global-50-msgs/s spike
  // when a single message routes to many taps. Each tap is independent — at most one tap
  // mirror channel + one tap user DM per tap.
  for (const delivery of tapDeliveries) {
    const tap = tapById.get(delivery.tapId);
    if (!tap) {
      // Tap was revoked between the recordMessage snapshot and now — mark the placeholder
      // resolved with a note rather than leaving it pending forever.
      await svc.completeTapDelivery(delivery.id, { error: 'tap revoked before delivery' });
      continue;
    }
    await deliverTapCopy(client, svc, tap, delivery.id, context, sender, senderNumber, message);
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

export async function sendVoicemailIntro(client: Client, context: RelayContext): Promise<void> {
  const intro = context.call.voicemailIntroMessage?.trim();
  if (!context.call.voicemailEnabled || !intro) return;
  await relayVoicemailPrompt(client, context, intro, 'ringing');
}

export async function sendVoicemailBeep(client: Client, callOrContext: string | RelayContext): Promise<void> {
  const context = typeof callOrContext === 'string'
    ? await new PhoneService(db).getCallParticipants(callOrContext)
    : callOrContext;
  const afterPeep = context.call.voicemailPostBeepMessage?.trim();
  const content = ['<peep>', afterPeep].filter(Boolean).join('\n');
  await relayVoicemailPrompt(client, context, content, 'voicemail');
}

async function relayVoicemailPrompt(
  client: Client,
  context: RelayContext,
  content: string,
  expectedStatus: 'ringing' | 'voicemail',
): Promise<void> {
  const svc = new PhoneService(db);
  const recorded = await svc.recordVoicemailPrompt({
    callId: context.call.id,
    content,
    expectedStatus,
  });
  await relayMessage(client, context, recorded, false);
}

export async function disableRingDmButtons(
  client: Client,
  callId: string,
  description: string,
): Promise<void> {
  const svc = new PhoneService(db);
  const context = await svc.getCallParticipants(callId);
  await disableRingDmButtonsForContext(client, context, description);
}

async function disableRingDmButtonsForContext(
  client: Client,
  context: RelayContext,
  description: string,
): Promise<void> {
  if (!context.call.ringDiscordMessageId) return;
  const resolvedDescription = description === 'The caller was sent to voicemail.'
    ? formatVoicemailSentDescription(context)
    : description;
  const recipientUser = await client.users.fetch(context.recipientPlayer.discordId);
  const dm = await recipientUser.createDM();
  const message = await dm.messages.fetch(context.call.ringDiscordMessageId);
  const disabledEmbed = new EmbedBuilder()
    .setTitle('\u{260E} Call ended')
    .setColor(ENDED_PALETTE)
    .setDescription(resolvedDescription);
  await message.edit({ embeds: [disabledEmbed], components: [] });
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
      const label = publicNumberLabel(senderNumber);
      const prefix = chunks.length > 1 ? `**${label}** [${i + 1}/${chunks.length}]: ` : `**${label}:** `;
      // Suppress mention parsing on user-content forwarding even though DMs cannot notify
      // bystanders — defense in depth, matches the staff thread mirror at postToStaffThread.
      const dm = await user.send({ content: `${prefix}${piece}`, allowedMentions: { parse: [] } });
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
  const recipientNumber = sender.id === context.callerPlayer.id ? context.recipientNumber : context.callerNumber;
  const senderName = staffNumberLabel(sender.characterName, senderNumber);
  const recipientName = staffNumberLabel(recipient.characterName, recipientNumber);
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
              ? `${senderName} [${i + 1}/${chunks.length}]`
              : senderName,
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
  deliveryId: string,
  context: RelayContext,
  sender: { id: string; characterName: string | null },
  senderNumber: PhoneNumber,
  message: PhoneMessage,
): Promise<void> {
  // Re-check that the tap is still active right before posting. The placeholder delivery row
  // was created inside `recordMessage`'s transaction; a concurrent staff revoke or
  // circuit-breaker auto-revoke between then and now should not produce a final mirror copy.
  // Cheap (one indexed point lookup) and the source of truth on the storage side.
  if (!(await svc.isTapActive(tap.id))) {
    await svc.completeTapDelivery(deliveryId, { error: 'tap revoked before delivery' });
    return;
  }
  const recipient = sender.id === context.callerPlayer.id ? context.recipientPlayer : context.callerPlayer;
  const recipientNumber = sender.id === context.callerPlayer.id ? context.recipientNumber : context.callerNumber;
  const senderName = staffNumberLabel(sender.characterName, senderNumber);
  const recipientName = staffNumberLabel(recipient.characterName, recipientNumber);
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
            ? `\u{1F575}\u{FE0F} Wiretap — ${senderName} [${i + 1}/${chunks.length}]`
            : `\u{1F575}\u{FE0F} Wiretap — ${senderName}`,
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
        const dm = await user.send({ embeds: [embed], allowedMentions: { parse: [] } });
        if (!mirrorMessageId && i === 0) mirrorMessageId = dm.id;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        console.error('[phone:relay] tap user DM failed:', err);
      }
    }
  }

  // Fill in the pre-created placeholder row (H1) rather than inserting a fresh delivery row.
  await svc.completeTapDelivery(deliveryId, {
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
    | 'number_deactivated'
    | 'voicemail_left'
    | 'voicemail_abandoned',
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
    voicemail_left: 'A voicemail was left.',
    voicemail_abandoned: 'The voicemail session ended without a message.',
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
      await user.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch {
      /* DMs may be closed; ignore */
    }
  }

  // Disable buttons on the ring DM if persisted. Only relevant when the call terminated
  // while still in `ringing` status — but cheap to check.
  try {
    await disableRingDmButtonsForContext(client, context, reasonText[endedReason]);
  } catch (err) {
    // Recipient may have closed DMs, ring message may have been deleted, or it was
    // never sent in the first place. Best-effort — log and continue.
    console.error('[phone:relay] failed to disable ring DM buttons:', err);
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
      { name: 'Caller', value: staffNumberLabel(context.callerPlayer.characterName, context.callerNumber), inline: true },
      { name: 'Recipient', value: staffNumberLabel(context.recipientPlayer.characterName, context.recipientNumber), inline: true },
    )
    .setTimestamp(new Date());
  try {
    await thread.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[phone:relay] failed to post call-opened event to staff thread:', err);
  }
}

// Internal helpers exposed for testing without spinning up a full Discord client.
export const __internal = {
  chunkText,
  chunkForDm,
  chunkForEmbed,
  isDmClosedError,
  publicNumberLabel,
  formatVoicemailSentDescription,
  staffNumberLabel,
  sendToRecipient,
  validateTapMirrorChannel,
};
