import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import {
  phoneCalls,
  phoneMessages,
  phoneNumbers,
  phoneThreads,
  players,
} from '@hansard/db';

// === Test DB wiring ===
// `runBackfill` imports `../src/db.js`, which constructs a postgres pool from
// `DATABASE_URL` at module load — even when the test only exercises preflight.
// If TEST_DATABASE_URL is set, route the script's pool to it before importing.
// Otherwise stub DATABASE_URL with a known-bad URL so the import succeeds; the
// preflight unit test never reaches DB work, and the integration `describe`
// below is skipped without a real DB.
const REAL_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_REAL_DB = Boolean(REAL_DB_URL);
if (HAS_REAL_DB) {
  process.env.DATABASE_URL = REAL_DB_URL!;
} else {
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/hansard';
}

const { runBackfill } = await import('./backfillPhoneThreads');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetAllMocks();
});

function makeChannel(perms: bigint) {
  return {
    type: 0, // ChannelType.GuildText
    permissionsFor: vi.fn().mockReturnValue({ has: (flag: bigint) => (perms & flag) === flag }),
    threads: { create: vi.fn() },
    send: vi.fn(),
  };
}

function makeClient(channel: ReturnType<typeof makeChannel>) {
  // discord.js Collection extends Map and has `first()` — for the backfill test path the
  // empty-guild case is the default; sub-tests that need a guild can override.
  const emptyGuildCache = new Map() as Map<string, unknown> & { first: () => undefined };
  emptyGuildCache.first = () => undefined;
  return {
    user: { id: 'BOT' },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
    guilds: { cache: emptyGuildCache },
    destroy: vi.fn(),
  } as unknown as import('discord.js').Client;
}

describe('backfillPhoneThreads — preflight', () => {
  it('aborts before any DB writes when CreatePrivateThreads is missing', async () => {
    process.env.PHONE_LOG_CHANNEL_ID = '1504812456042561587';
    const channel = makeChannel(
      PermissionFlagsBits.ViewChannel
      | PermissionFlagsBits.SendMessages
      | PermissionFlagsBits.SendMessagesInThreads,
      // CreatePrivateThreads omitted
    );
    const client = makeClient(channel);

    await expect(runBackfill({
      client,
      dryRun: false,
      limit: undefined,
      verbose: false,
    })).rejects.toThrow(/CreatePrivateThreads/);
  });
});

// === Integration tests against a real Postgres ===
//
// These exercise the full backfill loop against the test database wired through
// the same Drizzle schema the script uses. Each test seeds its own players +
// phone numbers + call rows (with unique number strings to dodge the partial
// `phone_numbers_active_normalized_unique` index) and asserts on the embeds the
// fake thread.send received plus the DB markers set after the call.
//
// Skipped automatically when TEST_DATABASE_URL / DATABASE_URL is not set so this
// test file still runs the preflight unit test in environments without a DB.

// Open the secondary client only when we have a real DB, otherwise we'd error
// at module top-level trying to dial the stub URL.
const sql = HAS_REAL_DB ? postgres(REAL_DB_URL!, { max: 1 }) : null!;
const db = HAS_REAL_DB ? drizzle(sql) : null!;

async function clearPhoneTables() {
  await db.delete(phoneThreads);
  await db.delete(phoneMessages);
  await db.delete(phoneCalls);
  await db.delete(phoneNumbers);
  // Players are seeded by other tests; only delete rows we own.
}

let seedSeq = 0;
function uniqueSnowflake(prefix: string): string {
  seedSeq += 1;
  // Discord snowflakes are 17-20 digit numeric strings; players.discord_id is varchar(20).
  return `${prefix}${Date.now().toString().slice(-10)}${seedSeq.toString().padStart(4, '0')}`.slice(0, 20);
}

let nameSeq = 0;
function uniqueName(base: string): string {
  nameSeq += 1;
  // players.character_name has a UNIQUE constraint. Salt with a per-process suffix so
  // re-running this suite (which deletes phone_* tables but NOT players) doesn't collide.
  return `${base}-${process.pid}-${Date.now().toString(36)}-${nameSeq}`;
}

async function seedCall(opts: {
  callerName: string;
  recipientName: string;
  callerNumberRaw?: string;
  recipientNumberRaw?: string;
  messages?: { senderIsCaller: boolean; content: string }[];
  status?: 'ended' | 'declined' | 'missed' | 'cancelled' | 'active' | 'ringing';
  endedReason?: string;
  backfilledAt?: Date | null;
  staffThreadId?: string | null;
}): Promise<{ callId: string; callerId: string; recipientId: string }> {
  const [caller] = await db.insert(players).values({
    characterName: uniqueName(opts.callerName),
    discordId: uniqueSnowflake('1'),
    discordUsername: opts.callerName,
    isAlive: true,
  }).returning();
  const [recipient] = await db.insert(players).values({
    characterName: uniqueName(opts.recipientName),
    discordId: uniqueSnowflake('2'),
    discordUsername: opts.recipientName,
    isAlive: true,
  }).returning();
  const callerRaw = opts.callerNumberRaw ?? '+15550101';
  const recipientRaw = opts.recipientNumberRaw ?? '+15550102';
  const [callerNum] = await db.insert(phoneNumbers).values({
    playerId: caller.id,
    numberRaw: callerRaw,
    numberNormalized: callerRaw.replace(/[^+0-9]/g, ''),
    isActive: true,
  }).returning();
  const [recipientNum] = await db.insert(phoneNumbers).values({
    playerId: recipient.id,
    numberRaw: recipientRaw,
    numberNormalized: recipientRaw.replace(/[^+0-9]/g, ''),
    isActive: true,
  }).returning();
  const status = opts.status ?? 'ended';
  const [call] = await db.insert(phoneCalls).values({
    callerNumberId: callerNum.id,
    recipientNumberId: recipientNum.id,
    callerPlayerId: caller.id,
    recipientPlayerId: recipient.id,
    status,
    endedReason:
      opts.endedReason
      ?? (status === 'ended'
        ? 'hangup_caller'
        : status === 'declined'
          ? 'declined_by_recipient'
          : null),
    answeredAt: status === 'ended' ? new Date(Date.now() - 60_000) : null,
    endedAt:
      status === 'ended' || status === 'declined' || status === 'missed' || status === 'cancelled'
        ? new Date()
        : null,
    backfilledAt: opts.backfilledAt ?? null,
    staffThreadId: opts.staffThreadId ?? null,
  }).returning();
  for (const m of opts.messages ?? []) {
    await db.insert(phoneMessages).values({
      callId: call.id,
      senderPlayerId: m.senderIsCaller ? caller.id : recipient.id,
      content: m.content,
    });
  }
  return { callId: call.id, callerId: caller.id, recipientId: recipient.id };
}

function makeOkChannel() {
  return makeChannel(
    PermissionFlagsBits.ViewChannel
    | PermissionFlagsBits.SendMessages
    | PermissionFlagsBits.CreatePrivateThreads
    | PermissionFlagsBits.SendMessagesInThreads,
  );
}

function makeThread() {
  return {
    id: '900000000000000001',
    type: 12, // PrivateThread
    send: vi.fn().mockImplementation(async () => ({ id: 'sentMsgId' })),
    members: { add: vi.fn() },
  };
}

function makeClientWithThreadCreation(
  channel: ReturnType<typeof makeOkChannel>,
  thread: ReturnType<typeof makeThread>,
) {
  channel.threads.create = vi.fn().mockResolvedValue(thread);
  return makeClient(channel);
}

const integrationDescribe = HAS_REAL_DB ? describe : describe.skip;

integrationDescribe('backfillPhoneThreads — core loop', () => {
  beforeEach(async () => {
    process.env.PHONE_LOG_CHANNEL_ID = '1504812456042561587';
    await clearPhoneTables();
  });

  it('test 1 — clean call: 1 connected + 3 messages + 1 ended embeds, both markers set', async () => {
    const { callId } = await seedCall({
      callerName: 'A1',
      recipientName: 'B1',
      callerNumberRaw: '+15550111',
      recipientNumberRaw: '+15550112',
      messages: [
        { senderIsCaller: true, content: 'hi' },
        { senderIsCaller: false, content: 'hey' },
        { senderIsCaller: true, content: 'bye' },
      ],
      status: 'ended',
    });
    const channel = makeOkChannel();
    const thread = makeThread();
    const client = makeClientWithThreadCreation(channel, thread);

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    expect(thread.send).toHaveBeenCalledTimes(5);
    const [row] = await db.select().from(phoneCalls).where(eq(phoneCalls.id, callId));
    expect(row.staffThreadId).toBe(thread.id);
    expect(row.backfilledAt).toBeInstanceOf(Date);
  });

  it('test 2 — zero-message declined call: connected + ended only', async () => {
    const { callId } = await seedCall({
      callerName: 'A2',
      recipientName: 'B2',
      callerNumberRaw: '+15550121',
      recipientNumberRaw: '+15550122',
      status: 'declined',
    });
    const channel = makeOkChannel();
    const thread = makeThread();
    const client = makeClientWithThreadCreation(channel, thread);

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    expect(thread.send).toHaveBeenCalledTimes(2);
    const [row] = await db.select().from(phoneCalls).where(eq(phoneCalls.id, callId));
    expect(row.backfilledAt).toBeInstanceOf(Date);
  });

  it('test 6 — already-backfilled call is skipped', async () => {
    await seedCall({
      callerName: 'A6',
      recipientName: 'B6',
      callerNumberRaw: '+15550161',
      recipientNumberRaw: '+15550162',
      status: 'ended',
      backfilledAt: new Date(),
      staffThreadId: '900000000000000099',
    });
    const channel = makeOkChannel();
    const thread = makeThread();
    const client = makeClientWithThreadCreation(channel, thread);

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    expect(thread.send).not.toHaveBeenCalled();
    expect(channel.threads.create).not.toHaveBeenCalled();
  });

  it('test 7 — second run is a no-op', async () => {
    const { callId } = await seedCall({
      callerName: 'A7',
      recipientName: 'B7',
      callerNumberRaw: '+15550171',
      recipientNumberRaw: '+15550172',
      status: 'ended',
      messages: [{ senderIsCaller: true, content: 'one' }],
    });
    const channel = makeOkChannel();
    const thread = makeThread();
    const client = makeClientWithThreadCreation(channel, thread);

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });
    const sendsAfterFirst = thread.send.mock.calls.length;
    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });
    expect(thread.send.mock.calls.length).toBe(sendsAfterFirst);
    const [row] = await db.select().from(phoneCalls).where(eq(phoneCalls.id, callId));
    expect(row.backfilledAt).toBeInstanceOf(Date);
  });

  it('test 9 — active call is skipped', async () => {
    await seedCall({
      callerName: 'A9',
      recipientName: 'B9',
      callerNumberRaw: '+15550191',
      recipientNumberRaw: '+15550192',
      status: 'active',
    });
    const channel = makeOkChannel();
    const thread = makeThread();
    const client = makeClientWithThreadCreation(channel, thread);

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    expect(thread.send).not.toHaveBeenCalled();
  });

  it('test 3 — two fresh calls between the same pair share one thread, ping once', async () => {
    const [caller] = await db.insert(players).values({
      characterName: uniqueName('P3A'), discordId: uniqueSnowflake('1'), discordUsername: 'P3A', isAlive: true,
    }).returning();
    const [recipient] = await db.insert(players).values({
      characterName: uniqueName('P3B'), discordId: uniqueSnowflake('2'), discordUsername: 'P3B', isAlive: true,
    }).returning();
    const [callerNum] = await db.insert(phoneNumbers).values({
      playerId: caller.id, numberRaw: '+15551001', numberNormalized: '+15551001', isActive: true,
    }).returning();
    const [recipientNum] = await db.insert(phoneNumbers).values({
      playerId: recipient.id, numberRaw: '+15551002', numberNormalized: '+15551002', isActive: true,
    }).returning();
    const t0 = new Date(Date.now() - 120_000);
    const t1 = new Date(Date.now() - 60_000);
    await db.insert(phoneCalls).values([
      {
        callerNumberId: callerNum.id, recipientNumberId: recipientNum.id,
        callerPlayerId: caller.id, recipientPlayerId: recipient.id,
        status: 'ended', endedReason: 'hangup_caller',
        startedAt: t0, answeredAt: t0, endedAt: t1,
      },
      {
        callerNumberId: callerNum.id, recipientNumberId: recipientNum.id,
        callerPlayerId: caller.id, recipientPlayerId: recipient.id,
        status: 'ended', endedReason: 'hangup_caller',
        startedAt: t1, answeredAt: t1, endedAt: new Date(),
      },
    ]);

    const channel = makeOkChannel();
    const thread = makeThread();
    const client = makeClientWithThreadCreation(channel, thread);
    // Second iteration falls back to client.channels.fetch(threadRow.discordThreadId)
    // because findOrCreateThread returns created=false on cache hit. Return the same
    // thread mock so the reused thread has a real id.
    (client.channels.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
      if (id === thread.id) return thread;
      return channel;
    });

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    expect(channel.threads.create).toHaveBeenCalledTimes(1);
    // 2 calls × (1 connected + 1 ended) + initial pair join-ping send = at least 4 send invocations.
    expect(thread.send.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('test 4 — pair with one pre-backfilled call: fresh call reuses the existing thread without re-pinging', async () => {
    const [caller] = await db.insert(players).values({ characterName: uniqueName('P4A'), discordId: uniqueSnowflake('1'), discordUsername: 'P4A', isAlive: true }).returning();
    const [recipient] = await db.insert(players).values({ characterName: uniqueName('P4B'), discordId: uniqueSnowflake('2'), discordUsername: 'P4B', isAlive: true }).returning();
    const [callerNum] = await db.insert(phoneNumbers).values({ playerId: caller.id, numberRaw: '+15552001', numberNormalized: '+15552001', isActive: true }).returning();
    const [recipientNum] = await db.insert(phoneNumbers).values({ playerId: recipient.id, numberRaw: '+15552002', numberNormalized: '+15552002', isActive: true }).returning();
    // Existing thread row from a prior run.
    const existingThreadId = '900000000000000201';
    const [aPlayer, bPlayer] = caller.id < recipient.id ? [caller.id, recipient.id] : [recipient.id, caller.id];
    await db.insert(phoneThreads).values({ playerAId: aPlayer, playerBId: bPlayer, discordThreadId: existingThreadId });
    // Pre-backfilled call: skipped.
    await db.insert(phoneCalls).values({
      callerNumberId: callerNum.id, recipientNumberId: recipientNum.id,
      callerPlayerId: caller.id, recipientPlayerId: recipient.id,
      status: 'ended', endedReason: 'hangup_caller',
      backfilledAt: new Date(), staffThreadId: existingThreadId,
    });
    // Fresh call: must reuse the existing thread.
    const [freshCall] = await db.insert(phoneCalls).values({
      callerNumberId: callerNum.id, recipientNumberId: recipientNum.id,
      callerPlayerId: caller.id, recipientPlayerId: recipient.id,
      status: 'ended', endedReason: 'hangup_caller',
    }).returning();

    const channel = makeOkChannel();
    const existingThread = { id: existingThreadId, type: 12, send: vi.fn().mockResolvedValue({ id: 's' }), members: { add: vi.fn() } };
    const client = makeClient(channel);
    (client.channels.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
      if (id === existingThreadId) return existingThread;
      return channel;
    });

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    expect(channel.threads.create).not.toHaveBeenCalled();
    const [row] = await db.select().from(phoneCalls).where(eq(phoneCalls.id, freshCall.id));
    expect(row.staffThreadId).toBe(existingThreadId);
    expect(row.backfilledAt).toBeInstanceOf(Date);
  });

  it('test 8 — re-replay after crash never overwrites phone_messages.*_mirror_message_id', async () => {
    const { callId } = await seedCall({
      callerName: 'A8',
      recipientName: 'B8',
      callerNumberRaw: '+15554001',
      recipientNumberRaw: '+15554002',
      status: 'ended',
      messages: [{ senderIsCaller: true, content: 'hello' }],
      // Simulate mid-call crash: thread pointer set, backfill not yet complete.
      staffThreadId: '900000000000000401',
    });
    // Seed an original mirror-id on the message (live-relay artifact).
    const ORIGINAL_MIRROR_ID = '700000000000000007';
    await db.update(phoneMessages)
      .set({ staffMirrorMessageId: ORIGINAL_MIRROR_ID })
      .where(eq(phoneMessages.callId, callId));

    const channel = makeOkChannel();
    const thread = {
      id: '900000000000000401',
      type: 12,
      send: vi.fn().mockResolvedValue({ id: 'newMirrorId' }),
      members: { add: vi.fn() },
    };
    const client = makeClient(channel);
    (client.channels.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
      if (id === thread.id) return thread;
      return channel;
    });

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    // After rerun: backfilled_at is now set, BUT the mirror id on phone_messages
    // is the original live-relay value, not the duplicate send's id.
    const [msg] = await db.select().from(phoneMessages).where(eq(phoneMessages.callId, callId));
    expect(msg.staffMirrorMessageId).toBe(ORIGINAL_MIRROR_ID);
    const [row] = await db.select().from(phoneCalls).where(eq(phoneCalls.id, callId));
    expect(row.backfilledAt).toBeInstanceOf(Date);
  });

  it('test 5 — pair with a live call: historic call reuses the live-created thread', async () => {
    const [caller] = await db.insert(players).values({ characterName: uniqueName('P5A'), discordId: uniqueSnowflake('1'), discordUsername: 'P5A', isAlive: true }).returning();
    const [recipient] = await db.insert(players).values({ characterName: uniqueName('P5B'), discordId: uniqueSnowflake('2'), discordUsername: 'P5B', isAlive: true }).returning();
    const [callerNum] = await db.insert(phoneNumbers).values({ playerId: caller.id, numberRaw: '+15553001', numberNormalized: '+15553001', isActive: true }).returning();
    const [recipientNum] = await db.insert(phoneNumbers).values({ playerId: recipient.id, numberRaw: '+15553002', numberNormalized: '+15553002', isActive: true }).returning();
    const liveThreadId = '900000000000000301';
    const [aPlayer, bPlayer] = caller.id < recipient.id ? [caller.id, recipient.id] : [recipient.id, caller.id];
    await db.insert(phoneThreads).values({ playerAId: aPlayer, playerBId: bPlayer, discordThreadId: liveThreadId });
    // Live call: skipped by filter.
    await db.insert(phoneCalls).values({
      callerNumberId: callerNum.id, recipientNumberId: recipientNum.id,
      callerPlayerId: caller.id, recipientPlayerId: recipient.id,
      status: 'active', staffThreadId: liveThreadId, answeredAt: new Date(),
    });
    // Historic ended call on the same pair.
    const [historic] = await db.insert(phoneCalls).values({
      callerNumberId: callerNum.id, recipientNumberId: recipientNum.id,
      callerPlayerId: caller.id, recipientPlayerId: recipient.id,
      status: 'ended', endedReason: 'hangup_caller',
    }).returning();

    const channel = makeOkChannel();
    const liveThread = { id: liveThreadId, type: 12, send: vi.fn().mockResolvedValue({ id: 's' }), members: { add: vi.fn() } };
    const client = makeClient(channel);
    (client.channels.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
      if (id === liveThreadId) return liveThread;
      return channel;
    });

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    expect(channel.threads.create).not.toHaveBeenCalled();
    const [row] = await db.select().from(phoneCalls).where(eq(phoneCalls.id, historic.id));
    expect(row.staffThreadId).toBe(liveThreadId);
  });
});
