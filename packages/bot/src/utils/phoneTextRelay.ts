import {
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  escapeMarkdown,
  type Client,
  type Guild,
  type MessageMentionOptions,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import { db } from '../db.js';
import { PhoneService } from '@hansard/api/services/phoneService';
import {
  PhoneTextService,
  type PhoneTextParticipant,
  type PhoneTextTap,
  type QueuedPhoneTextDelivery,
  type RecordedPhoneText,
} from '@hansard/api/services/phoneTextService';
import {
  PHONE_DM_CHUNK_BUDGET,
  PHONE_TAP_FAILURE_THRESHOLD,
} from '@hansard/shared';
import { resolveStaffRoleIds } from './staffRoles.js';
import { validateTapMirrorChannel } from './tapMirrorChannel.js';

const PHONE_LOG_CHANNEL_ENV = 'PHONE_LOG_CHANNEL_ID';
const PHONE_TAP_CHANNEL_ENV = 'PHONE_TAP_CHANNEL_ID';

const TEXT_COLOR = 0x4f8f88;
const STAFF_COLOR = 0x6d7d9c;
const TAP_COLOR = 0xc25b4e;
const NO_MENTIONS: MessageMentionOptions = { parse: [], users: [], roles: [], repliedUser: false };
const staffRoleMentions = (roles: readonly string[]): MessageMentionOptions => ({
  parse: [],
  users: [],
  roles,
  repliedUser: false,
});
const DM_CONTENT_BUDGET = PHONE_DM_CHUNK_BUDGET;
const EMBED_DESC_BUDGET = 4000;

const staffThreadCreateLocks = new Map<string, Promise<ThreadChannel | null>>();

function isDmClosedError(err: unknown): boolean {
  if (err instanceof DiscordAPIError) {
    return err.code === 50007 || err.code === '50007';
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return code === 50007 || code === '50007';
  }
  return false;
}

function chunkText(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > budget) {
    let cut = remaining.lastIndexOf('\n', budget);
    if (cut < budget * 0.6) cut = remaining.lastIndexOf(' ', budget);
    if (cut < budget * 0.6) cut = budget;
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

function publicNumberLabel(participant: PhoneTextParticipant): string {
  return participant.pseudonym
    ? `${escapeMarkdown(participant.pseudonym)} (${participant.numberRaw})`
    : participant.numberRaw;
}

function staffNumberLabel(participant: PhoneTextParticipant): string {
  const realName = participant.characterName ?? 'Unknown';
  return participant.pseudonym
    ? `${realName} as ${participant.pseudonym} (${participant.numberRaw})`
    : `${realName} (${participant.numberRaw})`;
}

async function fetchPhoneLogChannel(client: Client): Promise<TextChannel | null> {
  const id = process.env[PHONE_LOG_CHANNEL_ENV]?.trim();
  if (!id) return null;
  try {
    const channel = await client.channels.fetch(id);
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    return channel as TextChannel;
  } catch (err) {
    console.error('[phone:text] failed to fetch PHONE_LOG_CHANNEL_ID:', err);
    return null;
  }
}

async function sendStaffJoinPing(
  thread: ThreadChannel,
  guild: Guild,
  firstName: string,
  secondName: string,
): Promise<void> {
  try {
    await thread.send({
      allowedMentions: NO_MENTIONS,
      content: `Phone text conversation opened: **${firstName}** <-> **${secondName}**.`,
    });
  } catch (err) {
    console.error('[phone:text] failed to send text opener message:', err);
  }

  try {
    const staffRoleIds = await resolveStaffRoleIds(guild);
    if (staffRoleIds.length === 0) return;
    const mentions = staffRoleIds.map((id) => `<@&${id}>`).join(' ');
    await thread.send({
      allowedMentions: staffRoleMentions(staffRoleIds),
      content: `${mentions} new phone text log requires oversight.`,
    });
  } catch (err) {
    console.error('[phone:text] failed to ping staff roles:', err);
  }
}

async function ensurePhoneTextStaffThread(
  client: Client,
  recorded: Pick<RecordedPhoneText, 'conversation' | 'sender' | 'recipient'>,
): Promise<ThreadChannel | null> {
  if (recorded.conversation.staffThreadId) {
    try {
      const existing = await client.channels.fetch(recorded.conversation.staffThreadId);
      if (existing && (existing.type === ChannelType.PrivateThread || existing.type === ChannelType.PublicThread)) {
        return existing as ThreadChannel;
      }
    } catch (err) {
      console.error('[phone:text] failed to fetch text staff thread:', err);
    }
  }

  // Current deployment is single-shard; this process-local lock prevents duplicate Discord
  // threads within that runtime. Conversation creation itself is DB-locked cross-process.
  const inflight = staffThreadCreateLocks.get(recorded.conversation.id);
  if (inflight) return inflight;

  const created = (async (): Promise<ThreadChannel | null> => {
    const channel = await fetchPhoneLogChannel(client);
    if (!channel) return null;

    const svc = new PhoneTextService(db);
    const firstName = recorded.sender.characterName ?? 'Unknown';
    const secondName = recorded.recipient.characterName ?? 'Unknown';
    const threadName = `Text ${firstName} <-> ${secondName}`.slice(0, 95);

    try {
      const thread = await channel.threads.create({
        name: threadName,
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: 1440,
        reason: `Phone text log for ${firstName} and ${secondName}`,
      });
      await svc.setStaffThread(recorded.conversation.id, thread.id);
      await sendStaffJoinPing(thread, channel.guild, firstName, secondName);
      return thread;
    } catch (err) {
      console.error('[phone:text] failed to create text staff thread:', err);
      return null;
    }
  })().finally(() => {
    staffThreadCreateLocks.delete(recorded.conversation.id);
  });

  staffThreadCreateLocks.set(recorded.conversation.id, created);
  return created;
}

async function sendToRecipient(
  client: Client,
  recipient: PhoneTextParticipant,
  sender: PhoneTextParticipant,
  content: string,
): Promise<string | null> {
  if (!recipient.discordId) throw new Error('recipient has no Discord id');
  const chunks = chunkText(content, DM_CONTENT_BUDGET);
  let firstId: string | null = null;
  try {
    const user = await client.users.fetch(recipient.discordId);
    for (let i = 0; i < chunks.length; i++) {
      const label = publicNumberLabel(sender);
      const prefix = chunks.length > 1 ? `**${label}** [${i + 1}/${chunks.length}]: ` : `**${label}:** `;
      const sent = await user.send({
        content: `${prefix}${chunks[i]}`,
        allowedMentions: { parse: [] },
      });
      if (i === 0) firstId = sent.id;
    }
    return firstId;
  } catch (err) {
    if (isDmClosedError(err)) {
      throw new Error('recipient DMs are closed');
    }
    throw err;
  }
}

async function postToStaffThread(
  thread: ThreadChannel,
  sender: PhoneTextParticipant,
  recipient: PhoneTextParticipant,
  content: string,
): Promise<string | null> {
  const chunks = chunkText(content, EMBED_DESC_BUDGET);
  let firstId: string | null = null;
  try {
    for (let i = 0; i < chunks.length; i++) {
      const embed = new EmbedBuilder()
        .setColor(STAFF_COLOR)
        .setAuthor({
          name: chunks.length > 1
            ? `${staffNumberLabel(sender)} [${i + 1}/${chunks.length}]`
            : staffNumberLabel(sender),
        })
        .setDescription(chunks[i])
        .setFooter({ text: `text to ${staffNumberLabel(recipient)}` })
        .setTimestamp(new Date());
      const sent = await thread.send({ embeds: [embed], allowedMentions: { parse: [] } });
      if (i === 0) firstId = sent.id;
    }
    return firstId;
  } catch (err) {
    console.error('[phone:text] failed to mirror text to staff thread:', err);
    return null;
  }
}

async function deliverTapCopy(
  client: Client,
  textSvc: PhoneTextService,
  tap: PhoneTextTap,
  deliveryId: string,
  recorded: Pick<RecordedPhoneText, 'conversation' | 'message' | 'sender' | 'recipient'>,
): Promise<void> {
  if (!(await textSvc.isTapActive(tap.id))) {
    await textSvc.completeTapDelivery(deliveryId, { error: 'tap revoked before delivery' });
    return;
  }

  const chunks = chunkText(recorded.message.content, EMBED_DESC_BUDGET);
  const channelId = tap.mirrorChannelId ?? process.env[PHONE_TAP_CHANNEL_ENV]?.trim();
  let mirrorMessageId: string | null = null;
  const errors: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const embed = new EmbedBuilder()
      .setColor(TAP_COLOR)
      .setAuthor({
        name: chunks.length > 1
          ? `Wiretap text - ${staffNumberLabel(recorded.sender)} [${i + 1}/${chunks.length}]`
          : `Wiretap text - ${staffNumberLabel(recorded.sender)}`,
      })
      .setDescription(chunks[i])
      .setFooter({ text: `to ${staffNumberLabel(recorded.recipient)} - conversation ${recorded.conversation.id.slice(0, 8)}` })
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
            allowedMentions: NO_MENTIONS,
          });
          if (i === 0) mirrorMessageId = sent.id;
        } else {
          errors.push('tap channel is not sendable');
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        console.error('[phone:text] tap channel delivery failed:', err);
      }
    }

    if (tap.mirrorDiscordUserId) {
      try {
        const user = await client.users.fetch(tap.mirrorDiscordUserId);
        const dm = await user.send({ embeds: [embed], allowedMentions: NO_MENTIONS });
        if (!mirrorMessageId && i === 0) mirrorMessageId = dm.id;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        console.error('[phone:text] tap user DM failed:', err);
      }
    }
  }

  await textSvc.completeTapDelivery(deliveryId, {
    mirrorMessageId,
    error: errors.length ? errors.join('; ') : mirrorMessageId ? null : 'no tap target configured',
  });
}

async function mirrorTextTaps(client: Client, textSvc: PhoneTextService, recorded: RecordedPhoneText): Promise<void> {
  if (recorded.tapDeliveries.length === 0) return;
  const taps = await textSvc.getActiveTapsForNumbers([recorded.sender.numberId, recorded.recipient.numberId]);
  const tapById = new Map(taps.map((tap) => [tap.id, tap]));
  const callSvc = new PhoneService(db);

  for (const delivery of recorded.tapDeliveries) {
    const tap = tapById.get(delivery.tapId);
    if (!tap) {
      await textSvc.completeTapDelivery(delivery.id, { error: 'tap revoked before delivery' });
      continue;
    }
    await deliverTapCopy(client, textSvc, tap, delivery.id, recorded);
    try {
      const failures = await textSvc.countTrailingTapFailures(tap.id, PHONE_TAP_FAILURE_THRESHOLD);
      if (failures >= PHONE_TAP_FAILURE_THRESHOLD) {
        await callSvc.autoRevokeBrokenTap(tap.id, `Auto-revoked after ${failures} consecutive text delivery failures.`);
      }
    } catch (err) {
      console.error('[phone:text] tap circuit-breaker check failed:', err);
    }
  }
}

export async function relayRecordedPhoneText(client: Client, recorded: RecordedPhoneText): Promise<void> {
  const textSvc = new PhoneTextService(db);
  const staffThread = await ensurePhoneTextStaffThread(client, recorded);
  let staffMirrorMessageId: string | null = null;
  if (staffThread) {
    staffMirrorMessageId = await postToStaffThread(staffThread, recorded.sender, recorded.recipient, recorded.message.content);
    await textSvc.updateMessageMirrorIds(recorded.message.id, { staffMirrorMessageId });
  }
  await mirrorTextTaps(client, textSvc, recorded);
  await flushQueuedPhoneTextsForPlayer(client, recorded.recipient.playerId);
}

export async function flushQueuedPhoneTextsForPlayer(
  client: Client,
  playerId: string,
  limit = 25,
): Promise<number> {
  const textSvc = new PhoneTextService(db);
  const callSvc = new PhoneService(db);
  if (await callSvc.findOpenCallForPlayer(playerId)) return 0;

  const deliveries = await textSvc.getQueuedDeliveriesForPlayer(playerId, limit);
  let delivered = 0;
  for (const item of deliveries) {
    if (await callSvc.findOpenCallForPlayer(playerId)) break;
    const claimed = await textSvc.claimDeliveryForSend(item.delivery.id);
    if (!claimed) continue;

    if (await callSvc.findOpenCallForPlayer(playerId)) {
      await textSvc.releaseDeliveryClaim(item.delivery.id);
      break;
    }

    try {
      const messageId = await sendToRecipient(client, item.recipient, item.sender, item.message.content);
      await textSvc.markDeliveryDelivered(item.delivery.id, messageId);
      delivered++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await textSvc.markDeliveryFailed(item.delivery.id, reason);
      console.error('[phone:text] failed to deliver queued text:', err);
    }
  }
  return delivered;
}

export function buildPhoneTextSentEmbed(
  title: string,
  description: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(TEXT_COLOR)
    .setDescription(description);
}

export const __internal = {
  chunkText,
  isDmClosedError,
  publicNumberLabel,
  staffNumberLabel,
  sendToRecipient,
  deliverTapCopy,
};
