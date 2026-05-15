# Phone log channel rollout + backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Designate Discord channel `1504812456042561587` as `PHONE_LOG_CHANNEL_ID` and backfill every historic phone call's transcript into per-pair staff threads under that channel.

**Architecture:** A new `backfilled_at` column on `phone_calls` is the completion idempotency marker (separate from `staff_thread_id`, which becomes the thread-exists pointer). A one-shot bot script `backfillPhoneThreads.ts` iterates calls in `started_at` order, reuses `PhoneService.findOrCreateThread` + a `createThread/onOrphan` helper shared with the live relay, and posts ordered "Call connected → messages → Call ended" embed blocks while honoring Discord's 5/5s per-channel rate limit. A `pg_advisory_lock` enforces single-operator execution.

**Tech Stack:** TypeScript, pnpm workspaces, tsx, Drizzle ORM, postgres-js, discord.js v14, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-15-phone-log-backfill-design.md`

---

## Task 1: Add `backfilled_at` column to Drizzle schema

**Files:**
- Modify: `packages/db/src/schema/phones.ts` (the `phoneCalls` table at lines ~46–96)

- [ ] **Step 1: Edit the schema to add the new column**

In `packages/db/src/schema/phones.ts`, inside `phoneCalls`'s field block, add after the existing `endedAt` field (around line 68):

```ts
  // Backfill completion marker. NULL means "not yet backfilled" or "backfill
  // crashed mid-call"; set to NOW() by the one-shot
  // `backfill:phone-threads` script only after the call's full historic
  // transcript has been replayed into the staff thread. Distinct from
  // `staffThreadId` (which marks "a thread exists for this pair"). See spec
  // 2026-05-15-phone-log-backfill-design.md.
  backfilledAt: timestamp('backfilled_at', { withTimezone: true, mode: 'date' }),
```

- [ ] **Step 2: Run db package tests to ensure no schema regression**

Run: `pnpm --filter @hansard/db test:run`
Expected: PASS (schema edits typically don't break db tests; this is a sanity check).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/phones.ts
git commit -m "feat(db): add phone_calls.backfilled_at column to drizzle schema"
```

---

## Task 2: Write the migration script + its test

**Files:**
- Create: `packages/db/scripts/migrate-phone-backfill-marker.ts`
- Create: `packages/db/scripts/migrate-phone-backfill-marker.test.ts`
- Modify: `packages/db/package.json` (add `migrate:phone-backfill-marker` script entry)

- [ ] **Step 1: Write the failing test**

Create `packages/db/scripts/migrate-phone-backfill-marker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('migrate-phone-backfill-marker', () => {
  const source = readFileSync(
    path.join(__dirname, 'migrate-phone-backfill-marker.ts'),
    'utf-8',
  );

  it('wraps the migration in sql.begin', () => {
    expect(source).toMatch(/sql\.begin\(/);
  });

  it('uses ADD COLUMN IF NOT EXISTS for backfilled_at', () => {
    expect(source).toMatch(/ADD COLUMN IF NOT EXISTS\s+backfilled_at/i);
  });

  it('declares the column as TIMESTAMPTZ', () => {
    expect(source).toMatch(/backfilled_at\s+TIMESTAMPTZ/i);
  });

  it('does not mark the column NOT NULL', () => {
    // Match the ALTER line and ensure it has no NOT NULL clause.
    const alterLine = source.match(/ADD COLUMN IF NOT EXISTS\s+backfilled_at[^;]*/i);
    expect(alterLine).toBeTruthy();
    expect(alterLine![0]).not.toMatch(/NOT\s+NULL/i);
  });

  it('supports a --dry-run flag', () => {
    expect(source).toMatch(/--dry-run/);
  });

  it('supports a --validate flag', () => {
    expect(source).toMatch(/--validate/);
  });

  it('queries information_schema.columns during --validate', () => {
    expect(source).toMatch(/information_schema\.columns/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hansard/db test:run scripts/migrate-phone-backfill-marker.test.ts`
Expected: FAIL — file does not exist yet (`ENOENT`).

- [ ] **Step 3: Write the migration script**

Create `packages/db/scripts/migrate-phone-backfill-marker.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Adds the `phone_calls.backfilled_at` column used as the completion-idempotency
 * marker by `pnpm --filter @hansard/bot backfill:phone-threads`.
 *
 *   --dry-run   Print the SQL without executing.
 *   --validate  After applying (or as a standalone check), assert the column exists.
 *
 * Spec: docs/superpowers/specs/2026-05-15-phone-log-backfill-design.md
 */
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const isValidate = process.argv.includes('--validate');

const ALTER_SQL = `
  ALTER TABLE phone_calls
    ADD COLUMN IF NOT EXISTS backfilled_at TIMESTAMPTZ NULL;
`;

const VALIDATE_SQL = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'phone_calls' AND column_name = 'backfilled_at';
`;

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    if (isDryRun) {
      console.log('[dry-run] would execute:');
      console.log(ALTER_SQL.trim());
      return;
    }

    if (!isValidate) {
      console.log('Applying migration: phone_calls.backfilled_at');
      await sql.begin(async (tx) => {
        await tx.unsafe(ALTER_SQL);
      });
      console.log('Done.');
    }

    if (isValidate || !isDryRun) {
      const rows = await sql.unsafe<{ column_name: string; data_type: string; is_nullable: string }[]>(
        VALIDATE_SQL,
      );
      if (rows.length === 0) {
        console.error('Validation FAILED: backfilled_at column not found on phone_calls.');
        process.exit(2);
      }
      const row = rows[0];
      const ok = row.data_type === 'timestamp with time zone' && row.is_nullable === 'YES';
      if (!ok) {
        console.error(
          `Validation FAILED: column exists but shape is unexpected: data_type=${row.data_type}, is_nullable=${row.is_nullable}`,
        );
        process.exit(3);
      }
      console.log('Validation OK: phone_calls.backfilled_at TIMESTAMPTZ NULL exists.');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Wire pnpm script**

Open `packages/db/package.json`, locate the `scripts` object, and add an entry alongside the existing migration scripts (e.g. near `migrate:phones`):

```json
"migrate:phone-backfill-marker": "tsx scripts/migrate-phone-backfill-marker.ts"
```

(Insert with a trailing comma if it isn't the last entry, matching the existing JSON formatting.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @hansard/db test:run scripts/migrate-phone-backfill-marker.test.ts`
Expected: PASS — all 7 assertions green.

- [ ] **Step 6: Run the migration locally to apply the column**

Run: `pnpm --filter @hansard/db migrate:phone-backfill-marker --dry-run`
Expected: prints the `ALTER TABLE` SQL without contacting the DB.

Run: `pnpm --filter @hansard/db migrate:phone-backfill-marker`
Expected: prints `Applying migration...` then `Done.` then `Validation OK: ...`.

Run: `pnpm --filter @hansard/db migrate:phone-backfill-marker --validate`
Expected: prints `Validation OK: phone_calls.backfilled_at TIMESTAMPTZ NULL exists.`

- [ ] **Step 7: Commit**

```bash
git add packages/db/scripts/migrate-phone-backfill-marker.ts packages/db/scripts/migrate-phone-backfill-marker.test.ts packages/db/package.json
git commit -m "feat(db): add migrate:phone-backfill-marker script with --dry-run + --validate"
```

---

## Task 3: Export `sendStaffJoinPing` + `backgroundStaffAdd` + extract `createPhoneThreadWithOrphanCleanup` helper from `phoneRelay`

**Files:**
- Modify: `packages/bot/src/utils/phoneRelay.ts`

This is a refactor-only change. We mark two helpers `export` and factor the `createThread + onOrphan` callback pair into a small reusable helper so the live relay and the backfill script can share it.

- [ ] **Step 1: Run the existing relay test suite to capture a green baseline**

Run: `pnpm --filter @hansard/bot test:run src/utils/phoneRelay.test.ts`
Expected: PASS. Save this output mentally — we'll compare against it after the refactor.

- [ ] **Step 2: Mark the two helpers `export`**

In `packages/bot/src/utils/phoneRelay.ts`:

Change `async function sendStaffJoinPing(` (around line 249) to:
```ts
export async function sendStaffJoinPing(
```

Change `async function backgroundStaffAdd(` (around line 281) to:
```ts
export async function backgroundStaffAdd(
```

- [ ] **Step 3: Add the shared `createPhoneThreadWithOrphanCleanup` helper**

Add this exported helper near the existing `ensurePhoneThread` function (around line 137). It encapsulates the `createThread + onOrphan` callback pair used by `findOrCreateThread`:

```ts
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
```

- [ ] **Step 4: Refactor `ensurePhoneThread` to use the new helper**

Replace the inline `createThread + onOrphan` block inside `ensurePhoneThread` (the block currently at lines ~186–219) with:

```ts
    const { callbacks, getCreatedThread } = createPhoneThreadWithOrphanCleanup(
      client,
      channel,
      threadName,
      `Phone log for ${callerName} and ${recipientName}`,
    );

    const { thread: row, created: didCreate } = await svc.findOrCreateThread(
      participants.callerPlayer.id,
      participants.recipientPlayer.id,
      callbacks,
    );

    if (!row) return null;

    const createdThread = getCreatedThread();

    if (didCreate && createdThread) {
      await sendStaffJoinPing(createdThread, guild, callerName, recipientName);
      return createdThread;
    }
```

The remaining code after this block (the "Either a row already existed..." branch fetching the winning row's thread) stays unchanged.

- [ ] **Step 5: Run the relay test suite — assert no regression**

Run: `pnpm --filter @hansard/bot test:run src/utils/phoneRelay.test.ts`
Expected: PASS, same as baseline.

- [ ] **Step 6: Commit**

```bash
git add packages/bot/src/utils/phoneRelay.ts
git commit -m "refactor(phone): export staff-thread helpers and factor create+onOrphan callback pair"
```

---

## Task 4: Scaffold the backfill script + preflight permission check (TDD: test 15)

**Files:**
- Create: `packages/bot/scripts/backfillPhoneThreads.ts`
- Create: `packages/bot/scripts/backfillPhoneThreads.test.ts`
- Modify: `packages/bot/package.json` (add `backfill:phone-threads` script)

- [ ] **Step 1: Write the failing preflight test**

Create `packages/bot/scripts/backfillPhoneThreads.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { runBackfill } from './backfillPhoneThreads';

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
  return {
    user: { id: 'BOT' },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
    guilds: { cache: new Map() },
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts`
Expected: FAIL — file does not exist yet.

- [ ] **Step 3: Write the script skeleton + preflight**

Create `packages/bot/scripts/backfillPhoneThreads.ts`:

```ts
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
import { Client, GatewayIntentBits, PermissionFlagsBits, type TextChannel } from 'discord.js';

const PHONE_LOG_CHANNEL_ENV = 'PHONE_LOG_CHANNEL_ID';

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

export async function runBackfill(opts: BackfillOptions): Promise<void> {
  const channel = await preflight(opts.client);
  // The full pipeline is implemented in later tasks. For now, this scaffold
  // ensures the preflight gate trips before any DB or Discord writes.
  void channel;
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
```

- [ ] **Step 4: Wire the pnpm script**

In `packages/bot/package.json`, add to the `scripts` object (alongside e.g. `close:due-votes`):

```json
"backfill:phone-threads": "tsx scripts/backfillPhoneThreads.ts"
```

- [ ] **Step 5: Run the preflight test — verify it passes**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts`
Expected: PASS — the preflight throws `... CreatePrivateThreads ... in <#1504812456042561587>`.

- [ ] **Step 6: Commit**

```bash
git add packages/bot/scripts/backfillPhoneThreads.ts packages/bot/scripts/backfillPhoneThreads.test.ts packages/bot/package.json
git commit -m "feat(bot): scaffold backfill:phone-threads script with preflight permission gate"
```

---

## Task 5: Implement the core call loop — clean call, zero-message, already-backfilled, live-call-skipped (TDD: tests 1, 2, 6, 7, 9)

**Files:**
- Modify: `packages/bot/scripts/backfillPhoneThreads.ts`
- Modify: `packages/bot/scripts/backfillPhoneThreads.test.ts`

This is the largest task. It implements the main loop (load → ensure thread → post embeds → mark backfilled) and proves the basic idempotency contract.

- [ ] **Step 1: Extend the test setup with a seeded DB helper**

Append to `packages/bot/scripts/backfillPhoneThreads.test.ts`. The helper seeds two players + two phone numbers + a call, returns IDs. Use the same DB-test wiring as `packages/bot/src/utils/phoneRelay.test.ts` (postgres-js client against `TEST_DATABASE_URL`):

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import {
  phoneCalls,
  phoneMessages,
  phoneNumbers,
  phoneThreads,
} from '@hansard/db/schema/phones';
import { players } from '@hansard/db/schema/players';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL or DATABASE_URL must be set for tests');

const sql = postgres(TEST_DATABASE_URL, { max: 1 });
const db = drizzle(sql);

async function clearPhoneTables() {
  await db.delete(phoneThreads);
  await db.delete(phoneMessages);
  await db.delete(phoneCalls);
  await db.delete(phoneNumbers);
  // Players are seeded by other tests; only delete rows we own.
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
    characterName: opts.callerName,
    discordId: `discord-${opts.callerName}`,
    isAlive: true,
  }).returning();
  const [recipient] = await db.insert(players).values({
    characterName: opts.recipientName,
    discordId: `discord-${opts.recipientName}`,
    isAlive: true,
  }).returning();
  const [callerNum] = await db.insert(phoneNumbers).values({
    playerId: caller.id,
    numberRaw: opts.callerNumberRaw ?? '+15550101',
    numberNormalized: (opts.callerNumberRaw ?? '+15550101').replace(/[^+0-9]/g, ''),
    isActive: true,
  }).returning();
  const [recipientNum] = await db.insert(phoneNumbers).values({
    playerId: recipient.id,
    numberRaw: opts.recipientNumberRaw ?? '+15550102',
    numberNormalized: (opts.recipientNumberRaw ?? '+15550102').replace(/[^+0-9]/g, ''),
    isActive: true,
  }).returning();
  const status = opts.status ?? 'ended';
  const [call] = await db.insert(phoneCalls).values({
    callerNumberId: callerNum.id,
    recipientNumberId: recipientNum.id,
    callerPlayerId: caller.id,
    recipientPlayerId: recipient.id,
    status,
    endedReason: opts.endedReason ?? (status === 'ended' ? 'hangup_caller' : status === 'declined' ? 'declined_by_recipient' : null),
    answeredAt: status === 'ended' ? new Date(Date.now() - 60_000) : null,
    endedAt: status === 'ended' || status === 'declined' || status === 'missed' || status === 'cancelled' ? new Date() : null,
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
```

- [ ] **Step 2: Write tests 1, 2, 6, 7, 9 (clean call, zero-message, already-backfilled, idempotency, live-call-skipped)**

Append to the test file:

```ts
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

function makeClientWithThreadCreation(channel: ReturnType<typeof makeOkChannel>, thread: ReturnType<typeof makeThread>) {
  channel.threads.create = vi.fn().mockResolvedValue(thread);
  return makeClient(channel);
}

describe('backfillPhoneThreads — core loop', () => {
  beforeEach(async () => {
    process.env.PHONE_LOG_CHANNEL_ID = '1504812456042561587';
    await clearPhoneTables();
  });

  it('test 1 — clean call: 1 connected + 3 messages + 1 ended embeds, both markers set', async () => {
    const { callId } = await seedCall({
      callerName: 'A1', recipientName: 'B1',
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
      callerName: 'A2', recipientName: 'B2', status: 'declined',
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
      callerName: 'A6', recipientName: 'B6', status: 'ended',
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
      callerName: 'A7', recipientName: 'B7', status: 'ended',
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
    await seedCall({ callerName: 'A9', recipientName: 'B9', status: 'active' });
    const channel = makeOkChannel();
    const thread = makeThread();
    const client = makeClientWithThreadCreation(channel, thread);

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    expect(thread.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts`
Expected: FAIL — `runBackfill` does not yet implement the loop.

- [ ] **Step 4: Implement the core loop**

Edit `packages/bot/scripts/backfillPhoneThreads.ts`. Add these imports at the top:

```ts
import { and, eq, inArray, isNull, notInArray, asc } from 'drizzle-orm';
import { EmbedBuilder } from 'discord.js';
import { db } from '../src/db.js';
import {
  PhoneService,
  type PhoneViewer,
} from '@hansard/api/services/phoneService';
import {
  phoneCalls,
  phoneNumbers,
  phoneMessages,
} from '@hansard/db/schema/phones';
import { players } from '@hansard/db/schema/players';
import { formatPhoneEndedReason } from '@hansard/shared';
import {
  createPhoneThreadWithOrphanCleanup,
  sendStaffJoinPing,
  backgroundStaffAdd,
} from '../src/utils/phoneRelay.js';
import { resolveStaffRoleIds } from '../src/utils/staffRoles.js';
```

Add the embed constants (mirroring `phoneRelay.ts`):

```ts
const STAFF_PALETTE = 0x788c5d;
const CALL_COLOR = 0x9b7cb8;
const ENDED_PALETTE = 0x9c9890;

const SYNTHETIC_BACKFILL_VIEWER: PhoneViewer = {
  userId: '00000000-0000-0000-0000-000000000000',
  isStaff: true,
};

const EMBED_DESC_BUDGET = 4000;

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
```

Replace the placeholder body of `runBackfill` with the full pipeline:

```ts
export async function runBackfill(opts: BackfillOptions): Promise<void> {
  const channel = await preflight(opts.client);
  const svc = new PhoneService(db);

  const rows = await db
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
      callbacks,
    );
    if (!threadRow) continue;
    const threadChannel = getCreatedThread()
      ?? (await opts.client.channels.fetch(threadRow.discordThreadId)) as import('discord.js').ThreadChannel | null;
    if (!threadChannel) continue;

    // First-call-per-pair gate: both ping AND background-add.
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
      for (const message of transcript.messages) {
        const senderIsCaller = message.senderPlayerId === participants.callerPlayer.id;
        const senderName = senderIsCaller ? callerName : recipientName;
        const recipientLabel = senderIsCaller ? recipientName : callerName;
        const senderNumber = senderIsCaller ? participants.callerNumber : participants.recipientNumber;
        const chunks = chunkForEmbed(message.content);
        for (let i = 0; i < chunks.length; i++) {
          const piece = chunks[i];
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts`
Expected: all 5 new tests + the preflight test PASS (6 total).

- [ ] **Step 6: Commit**

```bash
git add packages/bot/scripts/backfillPhoneThreads.ts packages/bot/scripts/backfillPhoneThreads.test.ts
git commit -m "feat(bot): implement core backfill loop (clean call, zero-message, idempotency, live-skip)"
```

---

## Task 6: Pair-sharing tests + DB cache (TDD: tests 3, 4, 5)

**Files:**
- Modify: `packages/bot/scripts/backfillPhoneThreads.test.ts`

The pipeline already correctly reuses `findOrCreateThread`'s DB lookup, so these tests should largely pass against the Task-5 implementation. The point is to *prove it*.

- [ ] **Step 1: Write the three pair-sharing tests**

Append:

```ts
describe('backfillPhoneThreads — pair sharing', () => {
  beforeEach(async () => {
    process.env.PHONE_LOG_CHANNEL_ID = '1504812456042561587';
    await clearPhoneTables();
  });

  it('test 3 — two fresh calls between the same pair share one thread, ping once', async () => {
    const [caller] = await db.insert(players).values({
      characterName: 'P3A', discordId: 'd3a', isAlive: true,
    }).returning();
    const [recipient] = await db.insert(players).values({
      characterName: 'P3B', discordId: 'd3b', isAlive: true,
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

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    expect(channel.threads.create).toHaveBeenCalledTimes(1);
    // 2 calls × (1 connected + 1 ended) + initial pair join-ping send = at least 4 send invocations.
    expect(thread.send.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('test 4 — pair with one pre-backfilled call: fresh call reuses the existing thread without re-pinging', async () => {
    const [caller] = await db.insert(players).values({ characterName: 'P4A', discordId: 'd4a', isAlive: true }).returning();
    const [recipient] = await db.insert(players).values({ characterName: 'P4B', discordId: 'd4b', isAlive: true }).returning();
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

  it('test 5 — pair with a live call: historic call reuses the live-created thread', async () => {
    const [caller] = await db.insert(players).values({ characterName: 'P5A', discordId: 'd5a', isAlive: true }).returning();
    const [recipient] = await db.insert(players).values({ characterName: 'P5B', discordId: 'd5b', isAlive: true }).returning();
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
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts`
Expected: all 9 tests (Task-4 preflight + Task-5 five + these three) PASS.

If pair-cache assertions fail, add an in-memory `Map<pairKey, ThreadChannel>` to `runBackfill` keyed by sorted `${minId}:${maxId}` and consulted before `findOrCreateThread`. The DB query in `findOrCreateThread` already returns the existing row, so this cache is purely a fetch-cost optimization for the same run — not required for correctness.

- [ ] **Step 3: Commit**

```bash
git add packages/bot/scripts/backfillPhoneThreads.test.ts
git commit -m "test(bot): pair-sharing cases for backfill (fresh, pre-backfilled, live-call)"
```

---

## Task 7: Crash recovery — mirror-id immutability (TDD: test 8)

**Files:**
- Modify: `packages/bot/scripts/backfillPhoneThreads.test.ts`

- [ ] **Step 1: Write the crash-recovery test**

Append:

```ts
describe('backfillPhoneThreads — crash recovery', () => {
  beforeEach(async () => {
    process.env.PHONE_LOG_CHANNEL_ID = '1504812456042561587';
    await clearPhoneTables();
  });

  it('test 8 — re-replay after crash never overwrites phone_messages.*_mirror_message_id', async () => {
    const { callId } = await seedCall({
      callerName: 'A8', recipientName: 'B8', status: 'ended',
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
    const thread = { id: '900000000000000401', type: 12, send: vi.fn().mockResolvedValue({ id: 'newMirrorId' }), members: { add: vi.fn() } };
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
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts -t "test 8"`
Expected: PASS — the implementation in Task 5 never writes to `phone_messages.*_mirror_message_id`, so the original ID is preserved by default.

- [ ] **Step 3: Add a guard comment in the implementation**

In `packages/bot/scripts/backfillPhoneThreads.ts`, just above the `for (const message of transcript.messages)` loop, add:

```ts
        // INVARIANT: this loop must NEVER write to
        // phone_messages.recipient_discord_message_id / staff_mirror_message_id /
        // sender_discord_message_id. Those columns reflect the live relay's send
        // results; a backfill rerun-after-crash that overwrote them would destroy
        // the original audit pointer. See spec 2026-05-15-phone-log-backfill-design.md
        // (Non-goals + Idempotency contract).
```

- [ ] **Step 4: Commit**

```bash
git add packages/bot/scripts/backfillPhoneThreads.test.ts packages/bot/scripts/backfillPhoneThreads.ts
git commit -m "test(bot): assert mirror-id immutability on backfill crash-rerun"
```

---

## Task 8: Flags — `--limit`, `--dry-run`, `pg_advisory_lock`, dry-run-with-lock-held (TDD: tests 10, 11, 12)

**Files:**
- Modify: `packages/bot/scripts/backfillPhoneThreads.ts`
- Modify: `packages/bot/scripts/backfillPhoneThreads.test.ts`

- [ ] **Step 1: Write tests 10, 11, 12**

Append:

```ts
describe('backfillPhoneThreads — flags', () => {
  beforeEach(async () => {
    process.env.PHONE_LOG_CHANNEL_ID = '1504812456042561587';
    await clearPhoneTables();
  });

  it('test 10 — --limit 2 backfills the first 2 only; remaining 3 untouched', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { callId } = await seedCall({
        callerName: `A10_${i}`, recipientName: `B10_${i}`, status: 'ended',
      });
      ids.push(callId);
    }
    const channel = makeOkChannel();
    const thread = makeThread();
    const client = makeClientWithThreadCreation(channel, thread);

    await runBackfill({ client, dryRun: false, limit: 2, verbose: false });

    const rows = await db.select().from(phoneCalls).where(inArray(phoneCalls.id, ids));
    const backfilled = rows.filter((r) => r.backfilledAt !== null);
    expect(backfilled.length).toBe(2);
  });

  it('test 11 — --dry-run writes no DB and emits "Would post"', async () => {
    await seedCall({
      callerName: 'A11', recipientName: 'B11', status: 'ended',
      messages: [{ senderIsCaller: true, content: 'x' }],
    });
    const channel = makeOkChannel();
    const thread = makeThread();
    const client = makeClientWithThreadCreation(channel, thread);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runBackfill({ client, dryRun: true, limit: undefined, verbose: false });

    expect(thread.send).not.toHaveBeenCalled();
    const allRows = await db.select().from(phoneCalls);
    expect(allRows.every((r) => r.backfilledAt === null)).toBe(true);
    expect(spy.mock.calls.some((c) => String(c[0]).includes('Would post'))).toBe(true);
    spy.mockRestore();
  });

  it('test 12 — --dry-run when another lock is held prints a warning but still emits counts', async () => {
    await seedCall({ callerName: 'A12', recipientName: 'B12', status: 'ended' });

    // Hold the lock from a parallel connection.
    const holder = postgres(TEST_DATABASE_URL, { max: 1 });
    await holder.unsafe('SELECT pg_advisory_lock($1)', [BACKFILL_LOCK_KEY]);
    try {
      const channel = makeOkChannel();
      const thread = makeThread();
      const client = makeClientWithThreadCreation(channel, thread);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await runBackfill({ client, dryRun: true, limit: undefined, verbose: false });

      expect(warnSpy.mock.calls.some((c) => String(c[0]).toLowerCase().includes('counts may shift'))).toBe(true);
      expect(spy.mock.calls.some((c) => String(c[0]).includes('Would post'))).toBe(true);
      spy.mockRestore();
      warnSpy.mockRestore();
    } finally {
      await holder.unsafe('SELECT pg_advisory_unlock($1)', [BACKFILL_LOCK_KEY]);
      await holder.end({ timeout: 5 });
    }
  });
});
```

Add the import at the top of the test file:

```ts
import { BACKFILL_LOCK_KEY } from './backfillPhoneThreads';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts -t "flags"`
Expected: FAIL — flag handling not yet implemented.

- [ ] **Step 3: Implement the flag handling**

Edit `packages/bot/scripts/backfillPhoneThreads.ts`. Add the lock-key export near the top:

```ts
/**
 * Fixed advisory-lock key for the backfill script. Any int4 is fine; pick a
 * value distinct from anything else in the codebase.
 */
export const BACKFILL_LOCK_KEY = 1504812456;
```

Replace `runBackfill`'s body so it now wraps the pipeline in the lock + dry-run handling. The structure becomes:

```ts
export async function runBackfill(opts: BackfillOptions): Promise<void> {
  const channel = await preflight(opts.client);
  const svc = new PhoneService(db);
  const dbSql = (db as unknown as { _: { session: { client: postgres.Sql } } })._.session.client;
  // ^ drizzle-postgres-js exposes the underlying postgres-js client this way.
  //   If the accessor path is fragile, refactor packages/bot/src/db.ts to also export
  //   the raw client.

  if (opts.dryRun) {
    // Non-blocking try-acquire. If held, warn-but-continue per spec.
    const [{ pg_try_advisory_lock: acquired }] = await dbSql
      .unsafe<{ pg_try_advisory_lock: boolean }[]>('SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock', [BACKFILL_LOCK_KEY]);
    if (!acquired) {
      console.warn('[backfill] real backfill in progress; counts may shift mid-query.');
    }
    try {
      await reportDryRunCounts(opts, channel);
    } finally {
      if (acquired) {
        await dbSql.unsafe('SELECT pg_advisory_unlock($1)', [BACKFILL_LOCK_KEY]);
      }
    }
    return;
  }

  const [{ pg_try_advisory_lock: acquired }] = await dbSql
    .unsafe<{ pg_try_advisory_lock: boolean }[]>('SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock', [BACKFILL_LOCK_KEY]);
  if (!acquired) {
    throw new Error('Another backfill is in progress. Aborting.');
  }
  try {
    await runMainLoop(opts, channel, svc);
  } finally {
    await dbSql.unsafe('SELECT pg_advisory_unlock($1)', [BACKFILL_LOCK_KEY]);
  }
}

async function reportDryRunCounts(opts: BackfillOptions, _channel: TextChannel): Promise<void> {
  const calls = await loadEligibleCalls();
  const limited = opts.limit ? calls.slice(0, opts.limit) : calls;
  const msgCount = await countMessages(limited.map((c) => c.id));
  const pairs = new Set(limited.map((c) => pairKey(c.callerPlayerId, c.recipientPlayerId)));
  const sends = limited.length * 2 + msgCount;
  console.log(`Found ${limited.length} calls needing backfill across ${pairs.size} pairs.`);
  console.log(`Would post ${sends} embeds (${limited.length} connected + ${msgCount} messages + ${limited.length} ended across ${pairs.size} threads).`);
  console.log(`Estimated runtime: ~${Math.ceil(sends * 1.1 / 60)} minutes.`);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
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
```

Extract the body of the existing for-loop from Task 5 into a new helper `runMainLoop(opts, channel, svc)` and replace the previous straight-line implementation. Call `loadEligibleCalls()` at the top; otherwise the body is unchanged.

Add a `postgres` type import at the top:

```ts
import type postgres from 'postgres';
```

- [ ] **Step 4: Run the flag tests**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts -t "flags"`
Expected: all 3 tests PASS.

- [ ] **Step 5: Re-run the whole script suite to confirm no regression**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts`
Expected: all 13 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bot/scripts/backfillPhoneThreads.ts packages/bot/scripts/backfillPhoneThreads.test.ts
git commit -m "feat(bot): backfill flags — --limit, --dry-run, pg_advisory_lock"
```

---

## Task 9: Per-thread pacing + tap-field ignored (TDD: tests 13, 14)

**Files:**
- Modify: `packages/bot/scripts/backfillPhoneThreads.ts`
- Modify: `packages/bot/scripts/backfillPhoneThreads.test.ts`

- [ ] **Step 1: Write tests 13 and 14**

Append:

```ts
describe('backfillPhoneThreads — pacing and tap ignore', () => {
  beforeEach(async () => {
    process.env.PHONE_LOG_CHANNEL_ID = '1504812456042561587';
    await clearPhoneTables();
  });

  it('test 13 — getCallTranscript taps field is ignored; embed sends match messages.length', async () => {
    const { callId } = await seedCall({
      callerName: 'A13', recipientName: 'B13', status: 'ended',
      messages: [
        { senderIsCaller: true, content: 'one' },
        { senderIsCaller: false, content: 'two' },
      ],
    });
    void callId;
    const channel = makeOkChannel();
    const thread = makeThread();
    const client = makeClientWithThreadCreation(channel, thread);

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    // 1 connected + 2 messages + 1 ended = 4 sends. Tap deliveries (if any) MUST NOT add sends.
    expect(thread.send).toHaveBeenCalledTimes(4);
  });

  it('test 14 — two messages in the same thread are paced ≥1100ms apart', async () => {
    const { callId } = await seedCall({
      callerName: 'A14', recipientName: 'B14', status: 'ended',
      messages: [
        { senderIsCaller: true, content: 'm1' },
        { senderIsCaller: true, content: 'm2' },
      ],
    });
    void callId;
    const channel = makeOkChannel();
    const sends: number[] = [];
    const thread = {
      id: '900000000000000601', type: 12,
      send: vi.fn().mockImplementation(async () => { sends.push(Date.now()); return { id: 's' }; }),
      members: { add: vi.fn() },
    };
    const client = makeClientWithThreadCreation(channel, thread);

    await runBackfill({ client, dryRun: false, limit: undefined, verbose: false });

    // Find consecutive same-thread sends and assert pacing.
    const gaps: number[] = [];
    for (let i = 1; i < sends.length; i++) gaps.push(sends[i] - sends[i - 1]);
    // At minimum, the two message sends must be ≥1100ms apart.
    const maxGap = Math.max(...gaps);
    expect(maxGap).toBeGreaterThanOrEqual(1100);
  }, 30_000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts -t "pacing"`
Expected: test 14 FAILS (pacing not yet implemented); test 13 PASSES (script already reads only `transcript.messages`).

- [ ] **Step 3: Implement per-thread pacing**

In `packages/bot/scripts/backfillPhoneThreads.ts`, add at the top of the file:

```ts
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
```

Inside `runMainLoop`'s `for (const message of transcript.messages)` loop, add `await paceThread(threadChannel.id);` immediately before each `threadChannel.send(...)` call (for connected, message, and ended embeds).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts -t "pacing"`
Expected: both PASS.

- [ ] **Step 5: Final regression sweep**

Run: `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts`
Expected: all 15 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bot/scripts/backfillPhoneThreads.ts packages/bot/scripts/backfillPhoneThreads.test.ts
git commit -m "feat(bot): per-thread 1100ms pacing for backfill sends; assert tap field ignored"
```

---

## Task 10: Roll out the env var to local `.env` and Railway

**Files:**
- Modify: `.env` (local, gitignored)
- External: Railway `bot` service env

- [ ] **Step 1: PowerShell upsert into local `.env`**

Run from the project root:

```powershell
$envPath = ".env"
$key = "PHONE_LOG_CHANNEL_ID"
$value = "1504812456042561587"
$line = "$key=$value"

if (Test-Path $envPath) {
  $hasKey = Select-String -Path $envPath -Pattern "^$key=" -Quiet
  if ($hasKey) {
    (Get-Content $envPath) -replace "^$key=.*", $line | Set-Content $envPath
  } else {
    Add-Content $envPath $line
  }
} else {
  Set-Content $envPath $line
}

Write-Host "Local .env now contains $key."
```

- [ ] **Step 2: Confirm the local bot can read it**

Restart any running local bot (`Ctrl-C` then `pnpm dev:bot`). The bot must be restarted because `tsx watch` does not re-read `.env` on change.

- [ ] **Step 3: Confirm the Railway service name**

Run: `railway service list`
Expected: a list of services for the linked project. Note the bot service name (likely `bot`; confirm).

- [ ] **Step 4: Set the env var on Railway**

Run: `railway variables --service bot --set PHONE_LOG_CHANNEL_ID=1504812456042561587`
Expected: confirmation message; auto-deploy redeploys the bot service.

- [ ] **Step 5: Verify on Railway**

Run: `railway variables --service bot --kv | Select-String PHONE_LOG_CHANNEL_ID`
Expected: a line `PHONE_LOG_CHANNEL_ID=1504812456042561587`.

- [ ] **Step 6: No commit**

Local `.env` is gitignored; Railway state is external. No code commit for this task.

---

## Task 11: Apply the migration to production + run the backfill

**Files:** none (operational).

- [ ] **Step 1: Apply the migration on prod**

Use Railway's "Run command" or the `railway run` invocation against the `bot` (or whichever has DATABASE_URL) service:

```
railway run --service bot pnpm --filter @hansard/db migrate:phone-backfill-marker --dry-run
railway run --service bot pnpm --filter @hansard/db migrate:phone-backfill-marker
railway run --service bot pnpm --filter @hansard/db migrate:phone-backfill-marker --validate
```

Expected: dry-run prints the ALTER, apply prints `Done.` + `Validation OK: ...`, standalone validate prints `Validation OK: phone_calls.backfilled_at TIMESTAMPTZ NULL exists.`.

- [ ] **Step 2: Dry-run the backfill against prod**

```
railway run --service bot pnpm --filter @hansard/bot backfill:phone-threads --dry-run
```

Expected: counts and runtime estimate.

- [ ] **Step 3: Pilot with `--limit 1`**

```
railway run --service bot pnpm --filter @hansard/bot backfill:phone-threads --limit 1
```

Expected: one call backfilled. Open the resulting thread under `#1504812456042561587` in Discord and inspect:
- "Call connected (backfilled)" header with caller/recipient.
- Transcript embeds in chronological order with `backfilled • <ISO>` footers.
- "Call ended" footer.
- Staff role pinged once.

- [ ] **Step 4: Full sweep**

```
railway run --service bot pnpm --filter @hansard/bot backfill:phone-threads --verbose
```

Run during low phone-traffic hours per the spec's live-interleave guidance. Tail the logs.

- [ ] **Step 5: Spot-check completeness**

In Postgres (or via `psql`):

```sql
SELECT count(*) FROM phone_calls
WHERE backfilled_at IS NULL
  AND status NOT IN ('ringing', 'active');
```

Expected: 0 (modulo calls that flipped to live during the run).

- [ ] **Step 6: No commit**

Operational only.

---

## Task 12: Update `CLAUDE.md` to document the new column, script, and env behavior

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "Phone log backfill" entry to the long phone-PR section**

In `CLAUDE.md`, near the existing `**Phone PR #9 second-review hardening.**` block, append a new bullet:

```markdown
- **Phone log backfill is staff-tool, not infrastructure.** `phone_calls.backfilled_at` is the completion idempotency marker for the one-shot `pnpm --filter @hansard/bot backfill:phone-threads` script (added 2026-05-15 for the initial PHONE_LOG_CHANNEL_ID rollout). The script reuses the live relay's `findOrCreateThread` + `sendStaffJoinPing` + `backgroundStaffAdd` primitives (the latter two are exported from `phoneRelay.ts` for this use), inherits the same `createThread + onOrphan` cleanup hook via a shared helper `createPhoneThreadWithOrphanCleanup`, and never writes to `phone_messages.{recipient,staff_mirror,sender}_discord_message_id` — those columns belong to the live relay only. Run the migration `pnpm --filter @hansard/db migrate:phone-backfill-marker` (supports `--dry-run` and `--validate`) before deploying code that reads `backfilled_at`. The script supports `--dry-run`, `--limit N`, `--verbose`, and serializes on a `pg_advisory_lock(1504812456)`; dry-run does a non-blocking `pg_try_advisory_lock` and warns if another run holds it. Per-thread pacing is 1100ms to respect Discord's 5/5s per-channel rate limit; the outer loop is serial. Live calls (`status IN ('ringing','active')`) are skipped by filter; pair-shared threads created by the live relay are reused without re-pinging staff.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): document phone-log backfill column, script, and operational invariants"
```

---

## Task 13: Open the PR

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin claude/telephone-registry-system-ysOn8
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "Phone log channel rollout + transcript backfill" --body "$(cat <<'EOF'
## Summary
- Designate Discord channel `1504812456042561587` as `PHONE_LOG_CHANNEL_ID` for staff phone-call oversight.
- Add `phone_calls.backfilled_at TIMESTAMPTZ NULL` column + idempotent migration (`migrate:phone-backfill-marker`) with `--dry-run` and `--validate`.
- New one-shot bot script `pnpm --filter @hansard/bot backfill:phone-threads` replays every historic call's transcript into the appropriate per-pair private staff thread under the new channel.
- Refactor `phoneRelay.ts` to export `sendStaffJoinPing` + `backgroundStaffAdd` and factor a shared `createPhoneThreadWithOrphanCleanup` helper (used by both the live relay and the backfill script).
- Documented invariants in `CLAUDE.md`.

Spec: `docs/superpowers/specs/2026-05-15-phone-log-backfill-design.md`
Plan: `docs/superpowers/plans/2026-05-15-phone-log-backfill.md`

## Test plan
- [ ] `pnpm --filter @hansard/db test:run scripts/migrate-phone-backfill-marker.test.ts` — green
- [ ] `pnpm --filter @hansard/bot test:run scripts/backfillPhoneThreads.test.ts` — all 15 cases green
- [ ] `pnpm --filter @hansard/bot test:run src/utils/phoneRelay.test.ts` — no regression
- [ ] Local `.env` upsert verified; bot restarted
- [ ] Railway `PHONE_LOG_CHANNEL_ID` set on `bot` service
- [ ] Migration applied on prod via `railway run`, validated
- [ ] Backfill dry-run + `--limit 1` pilot inspected in Discord; full sweep clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Self-review

**Spec coverage check:**

- ✅ Schema column + Drizzle delta → Task 1.
- ✅ Migration with `--dry-run`/`--validate` + string-grep test → Task 2.
- ✅ Export `sendStaffJoinPing` + `backgroundStaffAdd` + shared `createPhoneThreadWithOrphanCleanup` → Task 3.
- ✅ Preflight permission check (all 4 perms) → Task 4 (test 15).
- ✅ Synthetic staff viewer with nil UUID → Task 5 (imports + constant).
- ✅ Core loop + connected/message/ended embeds with ISO footer + `setTimestamp` → Task 5.
- ✅ `staff_thread_id` immediate write + `backfilled_at` only on completion → Task 5.
- ✅ Live-call filter (`status NOT IN ('ringing','active')`) → Task 5.
- ✅ Pair-sharing semantics (fresh / pre-backfilled / live-call) → Task 6 (tests 3, 4, 5).
- ✅ Mirror-id immutability + invariant comment → Task 7 (test 8).
- ✅ `--limit`, `--dry-run`, `pg_advisory_lock`, dry-run-with-lock-held → Task 8 (tests 10, 11, 12).
- ✅ Tap field ignored + per-thread 1100ms pacing → Task 9 (tests 13, 14).
- ✅ Env var local + Railway rollout → Task 10.
- ✅ Migration apply + dry-run + pilot + full sweep → Task 11.
- ✅ CLAUDE.md update → Task 12.
- ✅ PR open → Task 13.

**Placeholder scan:**
- No `TBD` / `TODO` / "implement later".
- Every code step shows code.
- Every command shows the exact invocation + expected output.

**Type consistency:**
- `runBackfill` signature stable across tasks: `BackfillOptions` interface declared in Task 4 and used everywhere.
- `SYNTHETIC_BACKFILL_VIEWER` defined once in Task 5, used in `getCallTranscript` only.
- `BACKFILL_LOCK_KEY` defined in Task 8, imported in Task 8's test.
- Helper names: `createPhoneThreadWithOrphanCleanup` (Task 3) → consumed in `runMainLoop` (Task 5).

No issues found.
