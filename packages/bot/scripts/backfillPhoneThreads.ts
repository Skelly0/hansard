#!/usr/bin/env tsx
/**
 * One-shot replay of historic phone calls into per-pair staff threads under
 * PHONE_LOG_CHANNEL_ID. See
 * docs/superpowers/specs/2026-05-15-phone-log-backfill-design.md.
 *
 *   --dry-run    Print counts without writing Discord or DB.
 *   --limit N    Stop after backfilling N calls (smoke-test mode).
 *   --verbose    Print per-send progress every 50 sends.
 */
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { db, rawSql } from '../src/db.js';
import {
  PhoneService,
  type PhoneViewer,
} from '@hansard/api/services/phoneService';
import { phoneCalls, phoneMessages } from '@hansard/db';
import { formatPhoneEndedReason } from '@hansard/shared';
import {
  backgroundStaffAdd,
  createPhoneThreadWithOrphanCleanup,
  sendStaffJoinPing,
} from '../src/utils/phoneRelay.js';
import { resolveStaffRoleIds } from '../src/utils/staffRoles.js';

const PHONE_LOG_CHANNEL_ENV = 'PHONE_LOG_CHANNEL_ID';

/**
 * Advisory-lock key for cross-process backfill serialization. Picked as a fixed
 * int4 distinct from anything else in the codebase. The same key is used by
 * the dry-run path (with `pg_try_advisory_lock`, warn-but-continue) and the
 * main path (try-acquire, throw if held).
 */
export const BACKFILL_LOCK_KEY = 1504812456;

export interface BackfillOptions {
  client: import('discord.js').Client;
  dryRun: boolean;
  limit: number | undefined;
  verbose: boolean;
}

const REQUIRED_PERMS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['CreatePrivateThreads', PermissionFlagsBits.CreatePrivateThreads],
  ['SendMessagesInThreads', PermissionFlagsBits.SendMessagesInThreads],
] as const;

const STAFF_PALETTE = 0x788c5d;
const CALL_COLOR = 0x9b7cb8;
const ENDED_PALETTE = 0x9c9890;

const SYNTHETIC_BACKFILL_VIEWER: PhoneViewer = {
  userId: '00000000-0000-0000-0000-000000000000',
  isStaff: true,
};

const EMBED_DESC_BUDGET = 4000;

/**
 * Per-thread send pacing. Discord's per-channel rate limit is 5 messages / 5 seconds,
 * so a sustained ~1 send/sec per thread is the actual cap. Pacing at 1100ms gives a
 * little headroom while keeping pair-shared replays from tripping `429`s. The map is
 * keyed by Discord thread id; different threads are paced independently because they
 * have independent rate-limit buckets.
 */
const PER_THREAD_PACE_MS = 1100;
const threadLastSendAt = new Map<string, number>();

async function paceThread(threadId: string): Promise<void> {
  const last = threadLastSendAt.get(threadId);
  if (last !== undefined) {
    const elapsed = Date.now() - last;
    const wait = PER_THREAD_PACE_MS - elapsed;
    if (wait > 0) {
      await new Promise<void>((r) => setTimeout(r, wait));
    }
  }
  threadLastSendAt.set(threadId, Date.now());
}

function chunkForEmbed(text: string): string[] {
  if (text.length <= EMBED_DESC_BUDGET) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > EMBED_DESC_BUDGET) {
    let cut = remaining.lastIndexOf('\n', EMBED_DESC_BUDGET);
    if (cut < EMBED_DESC_BUDGET * 0.6) cut = remaining.lastIndexOf(' ', EMBED_DESC_BUDGET);
    if (cut < EMBED_DESC_BUDGET * 0.6) cut = EMBED_DESC_BUDGET;
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

export async function preflight(client: import('discord.js').Client): Promise<TextChannel> {
  const channelId = process.env[PHONE_LOG_CHANNEL_ENV]?.trim();
  if (!channelId) {
    throw new Error(`${PHONE_LOG_CHANNEL_ENV} is not set`);
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== 0) {
    throw new Error(`${PHONE_LOG_CHANNEL_ENV} (${channelId}) is not a guild text channel`);
  }
  const text = channel as TextChannel;
  const me = client.user;
  if (!me) throw new Error('client.user is null — bot not logged in');
  const perms = text.permissionsFor(me);
  if (!perms) throw new Error(`Could not resolve bot permissions in <#${channelId}>`);
  const missing = REQUIRED_PERMS.filter(([, flag]) => !perms.has(flag));
  if (missing.length > 0) {
    throw new Error(
      `Bot is missing ${missing.map((m) => m[0]).join(', ')} in <#${channelId}>`,
    );
  }
  return text;
}

async function tryAcquireLock(): Promise<boolean> {
  const [row] = await rawSql<{ pg_try_advisory_lock: boolean }[]>`
    SELECT pg_try_advisory_lock(${BACKFILL_LOCK_KEY}) AS pg_try_advisory_lock
  `;
  return row.pg_try_advisory_lock;
}

async function releaseLock(): Promise<void> {
  await rawSql`SELECT pg_advisory_unlock(${BACKFILL_LOCK_KEY})`;
}

async function loadEligibleCalls() {
  return db
    .select({
      id: phoneCalls.id,
      callerPlayerId: phoneCalls.callerPlayerId,
      recipientPlayerId: phoneCalls.recipientPlayerId,
      startedAt: phoneCalls.startedAt,
      endedAt: phoneCalls.endedAt,
      endedReason: phoneCalls.endedReason,
      status: phoneCalls.status,
      backfilledAt: phoneCalls.backfilledAt,
    })
    .from(phoneCalls)
    .where(and(
      isNull(phoneCalls.backfilledAt),
      notInArray(phoneCalls.status, ['ringing', 'active']),
    ))
    .orderBy(asc(phoneCalls.startedAt));
}

async function countMessages(callIds: string[]): Promise<number> {
  if (callIds.length === 0) return 0;
  const rows = await db
    .select({ id: phoneMessages.id })
    .from(phoneMessages)
    .where(inArray(phoneMessages.callId, callIds));
  return rows.length;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

async function reportDryRunCounts(opts: BackfillOptions): Promise<void> {
  const rows = await loadEligibleCalls();
  const calls = opts.limit ? rows.slice(0, opts.limit) : rows;
  const msgCount = await countMessages(calls.map((c) => c.id));
  const pairs = new Set(calls.map((c) => pairKey(c.callerPlayerId, c.recipientPlayerId)));
  const sends = calls.length * 2 + msgCount;
  const estimatedMinutes = Math.max(1, Math.ceil((sends * 1.1) / 60));
  console.log(`Found ${calls.length} calls needing backfill across ${pairs.size} pairs.`);
  console.log(`Would post ${sends} embeds (${calls.length} connected + ${msgCount} messages + ${calls.length} ended across ${pairs.size} threads).`);
  console.log(`Estimated runtime: ~${estimatedMinutes} minute${estimatedMinutes === 1 ? '' : 's'}.`);
}

export async function runBackfill(opts: BackfillOptions): Promise<void> {
  const channel = await preflight(opts.client);

  if (opts.dryRun) {
    // Non-blocking try-acquire. If held by a real backfill, warn-but-continue —
    // the counts can be inaccurate but the user still gets a directional answer.
    const acquired = await tryAcquireLock();
    if (!acquired) {
      console.warn('[backfill] real backfill in progress; counts may shift mid-query.');
    }
    try {
      await reportDryRunCounts(opts);
    } finally {
      if (acquired) await releaseLock();
    }
    return;
  }

  const acquired = await tryAcquireLock();
  if (!acquired) {
    throw new Error('Another backfill is in progress. Aborting.');
  }
  try {
    await runMainLoop(opts, channel);
  } finally {
    await releaseLock();
  }
}

async function runMainLoop(opts: BackfillOptions, channel: TextChannel): Promise<void> {
  const svc = new PhoneService(db);
  const rows = await loadEligibleCalls();
  const calls = opts.limit ? rows.slice(0, opts.limit) : rows;
  if (opts.verbose) console.log(`[backfill] processing ${calls.length} calls`);

  // Guild discovery — used by sendStaffJoinPing/backgroundStaffAdd.
  const guild = opts.client.guilds.cache.first() ?? null;

  for (const call of calls) {
    const participants = await svc.getCallParticipants(call.id);

    // Resolve or create the per-pair thread via PhoneService.
    const callerName = participants.callerPlayer.characterName ?? 'Unknown';
    const recipientName = participants.recipientPlayer.characterName ?? 'Unknown';
    const threadName = `\u{260E} ${callerName} \u{2194} ${recipientName}`.slice(0, 95);
    const { callbacks, getCreatedThread } = createPhoneThreadWithOrphanCleanup(
      opts.client,
      channel,
      threadName,
      `Phone log backfill for ${callerName} and ${recipientName}`,
    );
    const { thread: threadRow, created: didCreateThread } = await svc.findOrCreateThread(
      participants.callerPlayer.id,
      participants.recipientPlayer.id,
      {
        ...callbacks,
        // The backfill never replaces a "stale" persisted thread; this is a fresh creation path.
        replaceThreadId: undefined,
      },
    );
    if (!threadRow) continue;
    const fetchedThread = getCreatedThread()
      ?? (await opts.client.channels.fetch(threadRow.discordThreadId)) as ThreadChannel | null;
    if (!fetchedThread) continue;
    const threadChannel = fetchedThread as ThreadChannel;

    // First-call-per-pair gate: both ping AND background-add only when a brand-new
    // thread row was created in this iteration. Subsequent calls for the same pair
    // (discovered later or persisted from a prior live call) reuse the thread without
    // re-pinging.
    if (didCreateThread && guild) {
      await sendStaffJoinPing(threadChannel, guild, callerName, recipientName);
      try {
        const staffRoleIds = await resolveStaffRoleIds(guild);
        if (staffRoleIds.length > 0) {
          void backgroundStaffAdd(threadChannel, guild, staffRoleIds);
        }
      } catch (err) {
        console.error('[backfill] staff role resolution failed:', err);
      }
    }

    await svc.setStaffThread(call.id, threadChannel.id);

    // Connected embed.
    await paceThread(threadChannel.id);
    await threadChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('\u{1F4DE} Call connected')
          .setColor(STAFF_PALETTE)
          .addFields(
            { name: 'Caller', value: `${callerName} (${participants.callerNumber.numberRaw})`, inline: true },
            { name: 'Recipient', value: `${recipientName} (${participants.recipientNumber.numberRaw})`, inline: true },
          )
          .setFooter({ text: `backfilled • ${call.startedAt.toISOString()}` })
          .setTimestamp(call.startedAt),
      ],
      allowedMentions: { parse: [] },
    });

    // Message embeds.
    const transcript = await svc.getCallTranscript(call.id, SYNTHETIC_BACKFILL_VIEWER);
    if (transcript) {
        // INVARIANT: this loop must NEVER write to
        // phone_messages.recipient_discord_message_id / staff_mirror_message_id /
        // sender_discord_message_id. Those columns reflect the live relay's send
        // results; a backfill rerun-after-crash that overwrote them would destroy
        // the original audit pointer. See spec 2026-05-15-phone-log-backfill-design.md
        // (Non-goals + Idempotency contract).
      for (const message of transcript.messages) {
        const senderIsCaller = message.senderPlayerId === participants.callerPlayer.id;
        const senderName = senderIsCaller ? callerName : recipientName;
        const recipientLabel = senderIsCaller ? recipientName : callerName;
        const senderNumber = senderIsCaller ? participants.callerNumber : participants.recipientNumber;
        const chunks = chunkForEmbed(message.content);
        for (let i = 0; i < chunks.length; i++) {
          const piece = chunks[i];
          await paceThread(threadChannel.id);
          await threadChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(CALL_COLOR)
                .setAuthor({
                  name: chunks.length > 1
                    ? `${senderName} (${senderNumber.numberRaw}) [${i + 1}/${chunks.length}]`
                    : `${senderName} (${senderNumber.numberRaw})`,
                })
                .setDescription(piece)
                .setFooter({ text: `to ${recipientLabel} • backfilled • ${message.createdAt.toISOString()}` })
                .setTimestamp(message.createdAt),
            ],
            allowedMentions: { parse: [] },
          });
        }
      }
    }

    // Ended embed.
    await paceThread(threadChannel.id);
    await threadChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('\u{260E} Call ended')
          .setColor(ENDED_PALETTE)
          .setDescription(formatPhoneEndedReason(call.endedReason ?? 'hangup_caller'))
          .setFooter({ text: `backfilled • ${(call.endedAt ?? call.startedAt).toISOString()}` })
          .setTimestamp(call.endedAt ?? call.startedAt),
      ],
      allowedMentions: { parse: [] },
    });

    await db.update(phoneCalls)
      .set({ backfilledAt: new Date() })
      .where(eq(phoneCalls.id, call.id));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : undefined;
  if (limitIdx >= 0 && (!Number.isInteger(limit) || (limit as number) <= 0)) {
    console.error('--limit requires a positive integer');
    process.exit(2);
  }

  if (!process.env.DISCORD_BOT_TOKEN && !dryRun) {
    console.error('DISCORD_BOT_TOKEN is not set');
    process.exit(2);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  try {
    if (!dryRun) {
      await client.login(process.env.DISCORD_BOT_TOKEN);
    }
    await runBackfill({ client, dryRun, limit, verbose });
  } finally {
    await client.destroy();
  }
}

// Only auto-run when invoked directly (allow imports from tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
