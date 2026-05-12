import {
  ChannelType,
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
import { sendTicketStaffPing } from './ticketStaffPing.js';

const PHONE_LOG_CHANNEL_ENV = 'PHONE_LOG_CHANNEL_ID';
const PHONE_TAP_CHANNEL_ENV = 'PHONE_TAP_CHANNEL_ID';
const PHONE_GUILD_ENV = 'PHONE_GUILD_ID';

const CALL_COLOR = 0x9b7cb8;

function truncate(s: string, max = 1800): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function resolveGuild(client: Client): Guild | null {
  const configured = process.env[PHONE_GUILD_ENV]?.trim();
  if (configured) {
    const cached = client.guilds.cache.get(configured);
    if (cached) return cached;
  }
  // Single-guild deployment fallback (mirrors how /ticket create operates from DMs).
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
    console.error('[phone] failed to fetch PHONE_LOG_CHANNEL_ID:', err);
    return null;
  }
}

/**
 * Look up or create the per-pair private thread that staff use to oversee all calls
 * between the same two players. Reused across multiple calls.
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
      console.error('[phone] failed to fetch persisted phone thread, recreating:', err);
    }
  }

  const channel = await fetchPhoneLogChannel(client);
  if (!channel) {
    console.warn('[phone] PHONE_LOG_CHANNEL_ID not configured — no staff mirror created');
    return null;
  }

  const guild = resolveGuild(client);
  if (!guild) {
    console.warn('[phone] no guild available for staff thread creation');
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
    console.error('[phone] failed to create phone thread:', err);
    return null;
  }

  await svc.persistThread(pair, thread.id);

  // Ping staff so the role gets added to the private thread (same pattern as /ticket create).
  await sendStaffJoinPing(thread, guild, callerName, recipientName);

  return thread;
}

async function sendStaffJoinPing(
  thread: ThreadChannel,
  guild: Guild,
  callerName: string,
  recipientName: string,
): Promise<void> {
  // Reuse the existing staff role resolver by adapting the message content. The helper
  // signature takes a "ticketNumber" so we wrap with a custom send.
  try {
    await thread.send({
      allowedMentions: { roles: [] },
      content: `\u{1F4DE} Phone log opened: **${callerName}** \u{2194} **${recipientName}**. Pinging staff to attach the role.`,
    });
  } catch (err) {
    console.error('[phone] failed to send opener message:', err);
  }
  // Delegate to the shared staff ping helper. The "ticketNumber" arg is treated as
  // a string template only, but the helper hardcodes the wording. Build our own ping
  // using the same env-var resolution semantics by calling it with 0 first won't work —
  // so just resolve roles directly here.
  try {
    const staffRoleIds = await resolveStaffRoleIdsForGuild(guild);
    if (staffRoleIds.length === 0) return;
    const mentions = staffRoleIds.map((id) => `<@&${id}>`).join(' ');
    await thread.send({
      allowedMentions: { roles: staffRoleIds },
      content: `${mentions} new phone log requires oversight.`,
    });
  } catch (err) {
    console.error('[phone] failed to ping staff roles:', err);
  }
}

async function resolveStaffRoleIdsForGuild(guild: Guild): Promise<string[]> {
  // Mirror the env+name fallback chain in ticketStaffPing — duplicated here because the
  // public helper is hardcoded to ticket wording. Kept narrow.
  const envIds = parseRoleIds(process.env['STAFF_ROLE_IDS']).concat(parseRoleIds(process.env['STAFF_ROLE_ID']));
  if (envIds.length) return [...new Set(envIds)];

  const cached = guild.roles.cache.find((r) => r.name === 'Staff');
  if (cached) return [cached.id];
  try {
    const fetched = await guild.roles.fetch();
    const found = fetched.find((r) => r.name === 'Staff');
    return found ? [found.id] : [];
  } catch {
    return [];
  }
}

function parseRoleIds(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

interface RelayContext {
  call: PhoneCall;
  callerNumber: PhoneNumber;
  recipientNumber: PhoneNumber;
  callerPlayer: { id: string; characterName: string | null; discordId: string; isAlive: boolean };
  recipientPlayer: { id: string; characterName: string | null; discordId: string; isAlive: boolean };
}

/**
 * Relay a recorded message from `senderPlayerId` to the other party,
 * mirror it to the staff thread, and fan out to any active taps.
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

  const recipientCopyId = await sendToRecipient(client, recipient.discordId, senderNumber, message.content);
  const staffThread = await ensurePhoneThread(client, context);
  let staffMirrorId: string | null = null;
  if (staffThread) {
    staffMirrorId = await postToStaffThread(staffThread, context, sender, senderNumber, message.content);
    if (!context.call.staffThreadId) {
      await svc.setStaffThread(context.call.id, staffThread.id);
    }
  }

  await svc.updateMessageMirrorIds(message.id, {
    recipientDiscordMessageId: recipientCopyId,
    staffMirrorMessageId: staffMirrorId,
  });

  // Fan out to active taps on either number. Taps on *either* line for this call get
  // a copy — staff might tap the caller's burner while the recipient's main line is
  // also tapped.
  const taps = await svc.getActiveTapsForNumbers([context.callerNumber.id, context.recipientNumber.id]);
  if (taps.length === 0) return;

  await Promise.all(
    taps.map((tap) => deliverTapCopy(client, svc, tap, context, sender, senderNumber, message)),
  );
}

async function sendToRecipient(
  client: Client,
  recipientDiscordId: string,
  senderNumber: PhoneNumber,
  content: string,
): Promise<string | null> {
  try {
    const user = await client.users.fetch(recipientDiscordId);
    const dm = await user.send({
      content: `**${senderNumber.numberRaw}:** ${truncate(content)}`,
    });
    return dm.id;
  } catch (err) {
    console.error('[phone] failed to deliver to recipient DM:', err);
    return null;
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
  const embed = new EmbedBuilder()
    .setColor(CALL_COLOR)
    .setAuthor({ name: `${senderName} (${senderNumber.numberRaw})` })
    .setDescription(truncate(content))
    .setFooter({ text: `to ${recipientName}` })
    .setTimestamp(new Date());
  try {
    const sent = await thread.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return sent.id;
  } catch (err) {
    console.error('[phone] failed to mirror to staff thread:', err);
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
  const embed = new EmbedBuilder()
    .setColor(0xc25b4e)
    .setAuthor({ name: `\u{1F575}\u{FE0F} Wiretap — ${senderName} (${senderNumber.numberRaw})` })
    .setDescription(truncate(message.content))
    .setFooter({ text: `to ${recipientName} \u{2022} call ${context.call.id.slice(0, 8)}` })
    .setTimestamp(new Date());

  const channelId = tap.mirrorChannelId ?? process.env[PHONE_TAP_CHANNEL_ENV]?.trim();
  let mirrorMessageId: string | null = null;
  let lastError: string | null = null;

  if (channelId) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && 'send' in channel && typeof (channel as { send?: unknown }).send === 'function') {
        const sent = await (channel as TextChannel | ThreadChannel).send({
          embeds: [embed],
          allowedMentions: { parse: [] },
        });
        mirrorMessageId = sent.id;
      } else {
        lastError = 'tap channel is not sendable';
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error('[phone] tap channel delivery failed:', err);
    }
  }

  if (tap.mirrorUserId) {
    try {
      const user = await client.users.fetch(tap.mirrorUserId);
      const dm = await user.send({ embeds: [embed] });
      if (!mirrorMessageId) mirrorMessageId = dm.id;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error('[phone] tap user DM failed:', err);
    }
  }

  await svc.recordTapDelivery(message.id, tap.id, {
    mirrorMessageId,
    error: mirrorMessageId ? null : lastError ?? 'no tap target configured',
  });
}

/**
 * Best-effort: notify both parties + the staff thread that a call has ended,
 * regardless of which side hung up.
 */
export async function hangUpAndNotify(
  client: Client,
  callId: string,
  endedReason: 'hangup_caller' | 'hangup_recipient' | 'ring_timeout' | 'force_ended_by_staff' | 'dm_closed' | 'relay_failed',
): Promise<void> {
  const svc = new PhoneService(db);
  let context: RelayContext;
  try {
    context = await svc.getCallParticipants(callId);
  } catch (err) {
    console.error('[phone] hangup notify: could not load call participants:', err);
    return;
  }

  const reasonText: Record<typeof endedReason, string> = {
    hangup_caller: 'The caller hung up.',
    hangup_recipient: 'The recipient hung up.',
    ring_timeout: 'The recipient did not answer in time.',
    force_ended_by_staff: 'A staff member ended this call.',
    dm_closed: 'The other party could not be reached via DM.',
    relay_failed: 'The relay failed; the call was ended automatically.',
  };

  const embed = new EmbedBuilder()
    .setTitle('\u{260E} Call ended')
    .setColor(0x9c9890)
    .setDescription(reasonText[endedReason]);

  for (const player of [context.callerPlayer, context.recipientPlayer]) {
    try {
      const user = await client.users.fetch(player.discordId);
      await user.send({ embeds: [embed] });
    } catch {
      /* DMs may be closed; ignore */
    }
  }

  if (context.call.staffThreadId) {
    try {
      const thread = await client.channels.fetch(context.call.staffThreadId);
      if (thread && 'send' in thread && typeof (thread as { send?: unknown }).send === 'function') {
        await (thread as ThreadChannel).send({ embeds: [embed], allowedMentions: { parse: [] } });
      }
    } catch (err) {
      console.error('[phone] hangup notify: failed to update staff thread:', err);
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
    .setColor(0x788c5d)
    .addFields(
      { name: 'Caller', value: `${context.callerPlayer.characterName ?? '?'} (${context.callerNumber.numberRaw})`, inline: true },
      { name: 'Recipient', value: `${context.recipientPlayer.characterName ?? '?'} (${context.recipientNumber.numberRaw})`, inline: true },
    )
    .setTimestamp(new Date());
  try {
    await thread.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[phone] failed to post call-opened event to staff thread:', err);
  }
}
