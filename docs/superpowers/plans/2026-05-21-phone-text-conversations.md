# Phone Text Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent one-to-one phone text conversations so players can maintain multiple asynchronous conversations over days while live phone calls keep exclusive control of freeform DMs.

**Architecture:** Keep the existing `phone_calls` live-call model intact. Add a parallel `phone_text_*` model for durable text conversations keyed by phone-number pairs, with per-recipient delivery rows so "recipient is on a call" becomes queued delivery rather than lost delivery. Discord DMs remain the main player surface: slash commands start/switch/list text conversations, freeform DMs reply to the selected thread only when the player is not in a live call or caller-side voicemail session.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres, discord.js v14, Vitest, pnpm workspace.

---

## Required Behavior

- Players can run `/phone text number:<number> message:<message>` to start or continue a one-to-one text conversation.
- Text conversations are tied to the two phone numbers, not just the two players. A burner-to-main thread and main-to-main thread are separate.
- A player may have many active text conversations at the same time.
- Freeform DM messages route to a text conversation only when the sender has no open call from `PhoneService.findOpenCallForPlayer`.
- Freeform DM routing resolution is:
  - use the player's selected thread when it is active;
  - if no selected thread exists and the player has exactly one active text conversation, route to that sole thread;
  - if the player has zero active text conversations, send the no-thread hint and do not store the message;
  - if the player has multiple active text conversations, send the multiple-threads hint and do not store the message.
- Existing call behavior wins over texting:
  - `ringing`: freeform DMs get the existing "line is still ringing" reply.
  - `active`: freeform DMs are relayed as call speech.
  - `voicemail`: caller freeform DMs are voicemail content until the voicemail session ends.
- Incoming texts are persisted immediately but not delivered to a recipient whose `findOpenCallForPlayer` returns an open call. Those deliveries stay `queued`.
- Text delivery uses a claim step before Discord DM sends so concurrent flushes cannot double-DM the same queued message.
- When a call or caller-side voicemail session ends, queued text deliveries for that player are flushed.
- `/phone conversations` lists active text conversations.
- `/phone switch thread:<conversation-id>` sets the default freeform-DM reply target.
- `/phone close-conversation thread:<conversation-id>` archives the number-pair text conversation and clears reply targets pointing at it.
- Wiretaps apply to text messages as well as calls. A tap on either number receives a mirror of each text message.
- Staff audit mirrors text conversations under `PHONE_LOG_CHANNEL_ID`, separate from player-facing DMs.
- Conference/group conversations are not implemented in this pass, but the delivery model uses per-recipient rows so group fan-out is not boxed out later.

## File Structure

- Modify `packages/db/src/schema/phones.ts`
  - Add `phoneTextConversations`, `phoneTextMessages`, `phoneTextMessageDeliveries`, `phoneTextReplyStates`, and `phoneTextMessageTapDeliveries`.
- Modify `packages/db/scripts/migrate-phones.ts`
  - Add idempotent DDL for the new text tables, indexes, status checks, and rollback.
- Modify `packages/db/scripts/migrate-phones.test.ts`
  - Assert migration coverage for the new tables and constraints.
- Create `packages/api/src/services/phoneTextService.ts`
  - Own all text-thread lifecycle, message persistence, delivery status, reply target, transcript, and queued-delivery queries.
- Create `packages/api/src/services/phoneTextService.test.ts`
  - Unit tests for text-thread behavior using the existing fake DB style.
- Modify `packages/shared/src/constants/phones.ts`
  - Add text-specific constants and formatters.
- Create `packages/bot/src/utils/phoneTextRelay.ts`
  - Own Discord DM delivery, staff mirroring, tap fan-out, and queued delivery flushing.
- Create `packages/bot/src/utils/phoneTextRelay.test.ts`
  - Unit tests for busy-recipient queueing, delivery updates, staff mirroring, and tap fan-out.
- Modify `packages/bot/src/events/messageCreate.ts`
  - After the existing call/voicemail path finds no open call, route freeform DMs through selected or sole text conversations; the negative no-call cache must not bypass text routing.
- Modify `packages/bot/src/events/messageCreate.test.ts`
  - Add tests for text routing and the call-first rule.
- Modify `packages/bot/src/commands/phone/phone.ts`
  - Add `/phone text`, `/phone conversations`, `/phone switch`, and `/phone close-conversation`.
- Modify `packages/bot/src/commands/phone/phone.test.ts`
  - Assert command metadata and helper behavior.
- Modify `packages/bot/src/utils/phoneRelay.ts`
  - After call-end notifications, flush queued text deliveries for participants.
- Modify `packages/bot/src/services/phoneRingTimeout.ts`
  - Ensure timeout and abandoned-voicemail paths that do not naturally pass through `hangUpAndNotify` flush queued texts, recover stale text-delivery claims, and sweep stale text tap-delivery placeholders.
- Modify `packages/mcp/src/tools/phones.ts`
  - Add read-only text-thread list/transcript tools.
- Modify `CLAUDE.md`
  - Add a short project-memory note before any commit/push: text conversations are separate from live calls, and live calls own freeform DMs.

## Data Model

Add these Drizzle tables in `packages/db/src/schema/phones.ts`.

```ts
export const phoneTextConversations = pgTable('phone_text_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  numberAId: uuid('number_a_id').references(() => phoneNumbers.id, { onDelete: 'restrict' }).notNull(),
  numberBId: uuid('number_b_id').references(() => phoneNumbers.id, { onDelete: 'restrict' }).notNull(),
  playerAId: uuid('player_a_id').references(() => players.id).notNull(),
  playerBId: uuid('player_b_id').references(() => players.id).notNull(),
  status: varchar('status', { length: 16 }).default('active').notNull(),
  staffThreadId: varchar('staff_conversation_id', { length: 20 }),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
}, (table) => ({
  activePairUnique: uniqueIndex('phone_text_conversations_active_pair_unique')
    .on(table.numberAId, table.numberBId)
    .where(sql`status = 'active'`),
  orderedNumbers: check('phone_text_conversations_ordered_numbers', sql`number_a_id < number_b_id`),
  statusCheck: check('phone_text_conversations_status_check', sql`status IN ('active','archived')`),
  playerAIdx: index('phone_text_conversations_player_a_idx').on(table.playerAId, table.lastMessageAt.desc()),
  playerBIdx: index('phone_text_conversations_player_b_idx').on(table.playerBId, table.lastMessageAt.desc()),
}));

export const phoneTextMessages = pgTable('phone_text_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => phoneTextConversations.id, { onDelete: 'cascade' }).notNull(),
  senderPlayerId: uuid('sender_player_id').references(() => players.id).notNull(),
  senderNumberId: uuid('sender_number_id').references(() => phoneNumbers.id, { onDelete: 'restrict' }).notNull(),
  content: text('content').notNull(),
  senderDiscordMessageId: varchar('sender_discord_message_id', { length: 20 }),
  staffMirrorMessageId: varchar('staff_mirror_message_id', { length: 20 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  sequenceNo: bigserial('sequence_no', { mode: 'number' }).notNull(),
}, (table) => ({
  conversationIdx: index('phone_text_messages_conversation_idx').on(table.conversationId, table.createdAt, table.sequenceNo),
}));

export const phoneTextMessageDeliveries = pgTable('phone_text_message_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').references(() => phoneTextMessages.id, { onDelete: 'cascade' }).notNull(),
  recipientPlayerId: uuid('recipient_player_id').references(() => players.id).notNull(),
  recipientNumberId: uuid('recipient_number_id').references(() => phoneNumbers.id, { onDelete: 'restrict' }).notNull(),
  recipientDiscordMessageId: varchar('recipient_discord_message_id', { length: 20 }),
  status: varchar('status', { length: 16 }).default('queued').notNull(),
  failureReason: varchar('failure_reason', { length: 500 }),
  claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
  recipientQueueIdx: index('phone_text_message_deliveries_recipient_queue_idx')
    .on(table.recipientPlayerId, table.createdAt)
    .where(sql`status = 'queued'`),
  deliveringClaimIdx: index('phone_text_message_deliveries_delivering_claim_idx')
    .on(table.claimedAt)
    .where(sql`status = 'delivering'`),
  messageIdx: index('phone_text_message_deliveries_message_idx').on(table.messageId),
  statusCheck: check('phone_text_message_deliveries_status_check', sql`status IN ('queued','delivering','delivered','failed')`),
}));

export const phoneTextReplyStates = pgTable('phone_text_reply_states', {
  playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }).primaryKey(),
  conversationId: uuid('conversation_id').references(() => phoneTextConversations.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const phoneTextMessageTapDeliveries = pgTable('phone_text_message_tap_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').references(() => phoneTextMessages.id, { onDelete: 'cascade' }).notNull(),
  tapId: uuid('tap_id').references(() => phoneTaps.id, { onDelete: 'restrict' }).notNull(),
  mirrorMessageId: varchar('mirror_message_id', { length: 20 }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
  error: varchar('error', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
  tapCreatedIdx: index('phone_text_message_tap_deliveries_tap_created_idx').on(table.tapId, table.createdAt.desc()),
  pendingIdx: index('phone_text_message_tap_deliveries_pending_idx')
    .on(table.createdAt)
    .where(sql`delivered_at IS NULL AND error IS NULL`),
}));
```

Canonical number ordering:

```ts
function sortNumberPair(
  first: { id: string; playerId: string },
  second: { id: string; playerId: string },
): {
  numberAId: string;
  numberBId: string;
  playerAId: string;
  playerBId: string;
} {
  // Drizzle/Postgres UUIDs are canonical lowercase strings; JS lexical ordering matches
  // Postgres uuid ordering for that canonical representation.
  return first.id < second.id
    ? { numberAId: first.id, numberBId: second.id, playerAId: first.playerId, playerBId: second.playerId }
    : { numberAId: second.id, numberBId: first.id, playerAId: second.playerId, playerBId: first.playerId };
}
```

## Task 1: Schema And Migration

**Files:**
- Modify: `packages/db/src/schema/phones.ts`
- Modify: `packages/db/scripts/migrate-phones.ts`
- Modify: `packages/db/scripts/migrate-phones.test.ts`
- Test: `packages/db/scripts/migrate-phones.test.ts`

- [ ] **Step 1: Write failing migration tests**

Add tests to `packages/db/scripts/migrate-phones.test.ts`:

```ts
it('creates phone text conversation tables', () => {
  expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_text_conversations"');
  expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_text_messages"');
  expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_text_message_deliveries"');
  expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_text_reply_states"');
  expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_text_message_tap_deliveries"');
});

it('enforces one active text conversation per phone-number pair', () => {
  expect(script).toContain('phone_text_conversations_active_pair_unique');
  expect(script).toMatch(/ON "phone_text_conversations" \("number_a_id", "number_b_id"\)\s*WHERE status = 'active'/);
  expect(script).toContain('phone_text_conversations_ordered_numbers');
  expect(script).toContain('CHECK (number_a_id < number_b_id)');
});

it('queues text deliveries per recipient while calls own DMs', () => {
  expect(script).toContain('phone_text_message_deliveries_recipient_queue_idx');
  expect(script).toMatch(/WHERE status = 'queued'/);
  expect(script).toContain('"claimed_at" timestamptz');
  expect(script).toContain('phone_text_message_deliveries_delivering_claim_idx');
  expect(script).toContain("status IN ('queued','delivering','delivered','failed')");
});

it('orders phone text transcripts by created_at and sequence_no', () => {
  expect(script).toContain('CREATE INDEX IF NOT EXISTS "phone_text_messages_conversation_idx"');
  expect(script).toMatch(/ON "phone_text_messages" \("conversation_id", "created_at", "sequence_no"\)/);
});

it('stores player reply targets for freeform DM text routing', () => {
  expect(script).toMatch(/"player_id" uuid PRIMARY KEY REFERENCES "players"\("id"\) ON DELETE CASCADE/);
  expect(script).toMatch(/"conversation_id" uuid REFERENCES "phone_text_conversations"\("id"\) ON DELETE SET NULL/);
});

it('creates text-message tap delivery audit rows', () => {
  expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_text_message_tap_deliveries"');
  expect(script).toContain('phone_text_message_tap_deliveries_pending_idx');
  expect(script).toMatch(/"tap_id" uuid NOT NULL REFERENCES "phone_taps"\("id"\) ON DELETE RESTRICT/);
});

it('runs phone text DDL inside the existing transaction wrapper', () => {
  expect(script).toContain('await sql.begin(async (tx)');
  expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_text_conversations"');
  expect(script).toContain('await tx.unsafe(stmt)');
});
```

- [ ] **Step 2: Run migration tests and verify RED**

Run:

```bash
pnpm --filter @hansard/db test:run -- scripts/migrate-phones.test.ts
```

Expected: FAIL because the migration does not yet mention `phone_text_conversations`.

- [ ] **Step 3: Add Drizzle schema tables**

Add the tables from **Data Model** to `packages/db/src/schema/phones.ts` after `phoneMessageTapDeliveries`, preserving the existing phone-call tables.

- [ ] **Step 4: Add migration DDL**

Add the five `CREATE TABLE IF NOT EXISTS` blocks, indexes, checks, and rollback drops to `packages/db/scripts/migrate-phones.ts`.
Add the DDL to the existing `statements` array so it is executed inside the script's existing `sql.begin(...)` transaction.
Inline `CHECK` constraints are acceptable here because these are new tables; unlike adding checks to legacy populated tables, there is no pre-existing row scan to avoid.

The rollback order must be:

```ts
`DROP TABLE IF EXISTS "phone_text_message_tap_deliveries" CASCADE;`,
`DROP TABLE IF EXISTS "phone_text_message_deliveries" CASCADE;`,
`DROP TABLE IF EXISTS "phone_text_reply_states" CASCADE;`,
`DROP TABLE IF EXISTS "phone_text_messages" CASCADE;`,
`DROP TABLE IF EXISTS "phone_text_conversations" CASCADE;`,
```

- [ ] **Step 5: Run migration tests and verify GREEN**

Run:

```bash
pnpm --filter @hansard/db test:run -- scripts/migrate-phones.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run DB build**

Run:

```bash
pnpm --filter @hansard/db build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/phones.ts packages/db/scripts/migrate-phones.ts packages/db/scripts/migrate-phones.test.ts
git commit -m "feat(db): add phone text conversation schema"
```

## Task 2: Shared Constants

**Files:**
- Modify: `packages/shared/src/constants/phones.ts`
- Test: `packages/shared/src/constants/phones.test.ts` if present; otherwise cover via API tests in Task 3.

- [ ] **Step 1: Add shared constants**

Add:

```ts
export const PHONE_TEXT_MESSAGE_MAX_LENGTH = 1900;
export const PHONE_TEXT_THREAD_PAGE_SIZE = 10;
export const PHONE_TEXT_DELIVERY_BATCH_LIMIT = 20;
export const PHONE_TEXT_DELIVERY_CLAIM_STALE_MS = 10 * 60 * 1000;

export const PHONE_TEXT_NO_THREAD =
  'You do not have a selected text conversation. Use `/phone conversations` and `/phone switch` first.';
export const PHONE_TEXT_MULTIPLE_THREADS =
  'You have multiple active text conversations. Use `/phone conversations` and `/phone switch` before replying in DM.';
export const PHONE_TEXT_THREAD_ARCHIVED =
  'That text conversation is archived. Start a new one with `/phone text`.';
```

Add:

```ts
export function formatPhoneTextDeliveryStatus(status: string): string {
  switch (status) {
    case 'queued': return 'Queued';
    case 'delivering': return 'Delivering';
    case 'delivered': return 'Delivered';
    case 'failed': return 'Failed';
    default: return status;
  }
}
```

- [ ] **Step 2: Run shared tests**

Run:

```bash
pnpm --filter @hansard/shared test:run
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/constants/phones.ts
git commit -m "feat(shared): add phone text constants"
```

## Task 3: PhoneTextService Core

**Files:**
- Create: `packages/api/src/services/phoneTextService.ts`
- Create: `packages/api/src/services/phoneTextService.test.ts`
- Test: `packages/api/src/services/phoneTextService.test.ts`

Service public types:

```ts
export type PhoneTextConversation = typeof phoneTextConversations.$inferSelect;
export type PhoneTextMessage = typeof phoneTextMessages.$inferSelect;
export type PhoneTextMessageDelivery = typeof phoneTextMessageDeliveries.$inferSelect;
export type PhoneTextMessageTapDelivery = typeof phoneTextMessageTapDeliveries.$inferSelect;

export interface PhoneTextParticipant {
  playerId: string;
  discordId: string;
  characterName: string | null;
  numberId: string;
  numberRaw: string;
  pseudonym: string | null;
}

export interface PhoneTextContext {
  thread: PhoneTextConversation;
  sender: PhoneTextParticipant;
  recipient: PhoneTextParticipant;
}

export interface RecordedPhoneText {
  context: PhoneTextContext;
  message: PhoneTextMessage;
  delivery: PhoneTextMessageDelivery;
  tapDeliveries: PhoneTextMessageTapDelivery[];
}

export type PhoneTextReplyResolution =
  | { status: 'selected'; context: PhoneTextContext }
  | { status: 'sole'; context: PhoneTextContext }
  | { status: 'none' }
  | { status: 'multiple'; threads: PhoneTextContext[] };
```

Service methods:

```ts
export class PhoneTextService {
  constructor(private db: Database) {}

  async findOrCreateConversation(input: {
    senderPlayerId: string;
    senderNumberId: string;
    recipientNumberId: string;
  }): Promise<PhoneTextContext>;

  async recordText(input: {
    senderPlayerId: string;
    senderNumberId: string;
    recipientNumberId: string;
    content: string;
    senderDiscordMessageId?: string | null;
  }): Promise<RecordedPhoneText>;

  async recordReply(input: {
    senderPlayerId: string;
    conversationId: string;
    content: string;
    senderDiscordMessageId?: string | null;
  }): Promise<RecordedPhoneText>;

  async setReplyConversation(playerId: string, conversationId: string): Promise<PhoneTextConversation>;
  async resolveReplyConversation(playerId: string): Promise<PhoneTextReplyResolution>;
  async clearReplyConversationForPlayer(playerId: string, conversationId: string): Promise<void>;
  async clearReplyConversationForConversation(conversationId: string): Promise<void>;
  async listConversationsForPlayer(playerId: string, opts?: { limit?: number; includeArchived?: boolean }): Promise<PhoneTextConversationContext[]>;
  async archiveConversation(playerId: string, conversationId: string): Promise<PhoneTextConversation>;
  async getQueuedDeliveriesForPlayer(playerId: string, limit?: number): Promise<Array<PhoneTextMessageDelivery & { message: PhoneTextMessage; thread: PhoneTextConversation }>>;
  async claimDeliveryForSend(deliveryId: string, now?: Date): Promise<PhoneTextMessageDelivery | null>;
  async markDeliveryDelivered(deliveryId: string, recipientDiscordMessageId: string): Promise<void>;
  async markDeliveryFailed(deliveryId: string, reason: string): Promise<void>;
  async sweepStaleTextDeliveryClaims(opts?: { now?: Date; maxAgeMs?: number }): Promise<PhoneTextMessageDelivery[]>;
  async setStaffThread(conversationId: string, discordThreadId: string): Promise<void>;
  async updateStaffMirrorMessage(messageId: string, discordMessageId: string | null): Promise<void>;
  async completeTapDelivery(deliveryId: string, result: { mirrorMessageId?: string | null; error?: string | null }): Promise<void>;
  async sweepStaleTextTapDeliveries(opts?: { now?: Date; maxAgeMs?: number }): Promise<PhoneTextMessageTapDelivery[]>;
  async getConversationTranscript(conversationId: string, viewer: PhoneViewer): Promise<{ thread: PhoneTextConversation; messages: PhoneTextMessage[] } | null>;
}
```

- [ ] **Step 1: Write failing tests for thread creation**

In `packages/api/src/services/phoneTextService.test.ts`:

```ts
describe('PhoneTextService.recordText', () => {
  it('creates one active text conversation for a phone-number pair and reuses it', async () => {
    const db = makeTextDb({
      selectQueues: [
        [{ id: 'from-num', playerId: 'sender', isActive: true, numberRaw: '111', pseudonym: null }],
        [{ id: 'to-num', playerId: 'recipient', isActive: true, numberRaw: '222', pseudonym: null }],
        [{ id: 'sender', characterName: 'Ada', discordId: 'D1', isAlive: true }],
        [{ id: 'recipient', characterName: 'Bram', discordId: 'D2', isAlive: true }],
        [],
        [{ id: 'tap-1' }],
      ],
      insertReturning: [
        [{ id: 'thread-1', numberAId: 'from-num', numberBId: 'to-num', playerAId: 'sender', playerBId: 'recipient', status: 'active' }],
        [{ id: 'message-1', conversationId: 'thread-1', senderPlayerId: 'sender', senderNumberId: 'from-num', content: 'hello' }],
        [{ id: 'delivery-1', messageId: 'message-1', recipientPlayerId: 'recipient', recipientNumberId: 'to-num', status: 'queued' }],
        [{ id: 'tap-delivery-1', messageId: 'message-1', tapId: 'tap-1' }],
      ],
    });

    const svc = new PhoneTextService(db);
    const result = await svc.recordText({
      senderPlayerId: 'sender',
      senderNumberId: 'from-num',
      recipientNumberId: 'to-num',
      content: 'hello',
    });

    expect(result.context.thread.id).toBe('thread-1');
    expect(result.delivery.status).toBe('queued');
    expect(result.tapDeliveries).toHaveLength(1);
  });
});
```

Use a `makeTextDb` helper copied from `phoneService.test.ts`'s `makeDb` shape and extended only as needed.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter @hansard/api test:run -- src/services/phoneTextService.test.ts
```

Expected: FAIL because `phoneTextService.ts` does not exist.

- [ ] **Step 3: Implement minimal `PhoneTextService.recordText`**

Create `packages/api/src/services/phoneTextService.ts` with:

- number lookups by `senderNumberId` and `recipientNumberId`
- active number checks
- sender owns `senderNumberId`
- self-text rejection when both numbers belong to the same player
- alive and character-name checks for sender and recipient
- canonical number-pair sorting
- active thread reuse or insert guarded by a transaction-scoped advisory lock on the sorted number pair
- a `23505` unique-violation fallback that re-selects the active thread if a future code path reaches the insert race without the advisory lock
- message insert
- one recipient delivery insert with `status: 'queued'`
- tap snapshot insert for active taps on either number
- thread `lastMessageAt` update

The advisory lock helper should mirror the existing phone-call locking style:

```ts
async function lockTextThreadPair(db: DbOrTx, numberAId: string, numberBId: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`phone_text:${numberAId}:${numberBId}`}))`);
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
pnpm --filter @hansard/api test:run -- src/services/phoneTextService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add validation tests**

Add tests:

```ts
it('rejects inactive recipient numbers as number_not_found', async () => {
  const svc = new PhoneTextService(makeTextDb({
    selectQueues: [
      [{ id: 'from-num', playerId: 'sender', isActive: true }],
      [{ id: 'to-num', playerId: 'recipient', isActive: false }],
    ],
  }));

  await expect(svc.recordText({
    senderPlayerId: 'sender',
    senderNumberId: 'from-num',
    recipientNumberId: 'to-num',
    content: 'hello',
  })).rejects.toMatchObject({ code: 'number_not_found' });
});

it('rejects self texts between two numbers owned by the same player', async () => {
  const svc = new PhoneTextService(makeTextDb({
    selectQueues: [
      [{ id: 'from-num', playerId: 'sender', isActive: true }],
      [{ id: 'to-num', playerId: 'sender', isActive: true }],
    ],
  }));

  await expect(svc.recordText({
    senderPlayerId: 'sender',
    senderNumberId: 'from-num',
    recipientNumberId: 'to-num',
    content: 'hello',
  })).rejects.toMatchObject({ code: 'self_text' });
});

it('rejects archived threads when replying by selected thread id', async () => {
  const svc = new PhoneTextService(makeTextDb({
    selectQueues: [
      [{ id: 'thread-1', status: 'archived', playerAId: 'sender', playerBId: 'recipient' }],
    ],
  }));

  await expect(svc.recordReply({
    senderPlayerId: 'sender',
    conversationId: 'thread-1',
    content: 'hello',
  })).rejects.toMatchObject({ code: 'invalid_state' });
});
```

- [ ] **Step 6: Implement validation behavior**

Add `PhoneTextServiceError` with codes:

```ts
export type PhoneTextErrorCode =
  | 'number_not_found'
  | 'no_character'
  | 'dead'
  | 'recipient_dead'
  | 'self_text'
  | 'forbidden'
  | 'not_found'
  | 'invalid_state'
  | 'ambiguous_thread';
```

- [ ] **Step 7: Add reply target tests**

Add tests for:

```ts
it('sets a reply target only for a participant in an active thread', async () => {
  const db = makeTextDb({
    selectQueues: [
      [{ id: 'thread-1', status: 'active', playerAId: 'sender', playerBId: 'recipient' }],
    ],
    insertReturning: [[{ playerId: 'sender', conversationId: 'thread-1' }]],
  });
  const svc = new PhoneTextService(db);
  await expect(svc.setReplyConversation('sender', 'thread-1')).resolves.toMatchObject({ id: 'thread-1' });
});

it('falls back to the sole active thread when no explicit reply target exists', async () => {
  const db = makeTextDb({
    selectQueues: [
      [], // no selected reply state
      [{ id: 'thread-1', status: 'active', playerAId: 'sender', playerBId: 'recipient' }],
    ],
  });
  const svc = new PhoneTextService(db);
  await expect(svc.resolveReplyConversation('sender')).resolves.toMatchObject({
    status: 'sole',
    context: { thread: { id: 'thread-1' } },
  });
});

it('returns multiple when no explicit target exists and several active threads are available', async () => {
  const db = makeTextDb({
    selectQueues: [
      [],
      [
        { id: 'thread-1', status: 'active', playerAId: 'sender', playerBId: 'one' },
        { id: 'thread-2', status: 'active', playerAId: 'sender', playerBId: 'two' },
      ],
    ],
  });
  const svc = new PhoneTextService(db);
  await expect(svc.resolveReplyConversation('sender')).resolves.toMatchObject({ status: 'multiple' });
});

it('returns none when the selected reply target was archived and there is no active fallback', async () => {
  const db = makeTextDb({
    selectQueues: [
      [{ playerId: 'sender', conversationId: 'thread-1' }],
      [{ id: 'thread-1', status: 'archived', playerAId: 'sender', playerBId: 'recipient' }],
      [],
    ],
  });
  const svc = new PhoneTextService(db);
  await expect(svc.resolveReplyConversation('sender')).resolves.toEqual({ status: 'none' });
});

it('clears every participant reply state when a thread is archived', async () => {
  const deleted: unknown[] = [];
  const db = makeTextDb({
    selectQueues: [
      [{ id: 'thread-1', status: 'active', playerAId: 'sender', playerBId: 'recipient' }],
    ],
    updateReturning: [[{ id: 'thread-1', status: 'archived' }]],
    deletedWhereArgs: deleted,
  });
  const svc = new PhoneTextService(db);
  await svc.archiveConversation('sender', 'thread-1');
  expect(collectStrings(deleted)).toContain('thread-1');
});
```

- [ ] **Step 8: Implement reply target methods**

Implement `setReplyConversation`, `resolveReplyConversation`, `clearReplyConversationForPlayer`, and `clearReplyConversationForConversation`.

`resolveReplyConversation` must first read the explicit `phone_text_reply_states` row. If it points at an active participant thread, return `{ status: 'selected', context }`. If the selected thread is missing or archived, ignore it and inspect active threads for that player. Return `{ status: 'sole', context }` for exactly one active thread, `{ status: 'multiple', threads }` for more than one, and `{ status: 'none' }` for zero.

`archiveConversation` must call `clearReplyConversationForConversation(conversationId)` in the same transaction after marking the thread archived. Clearing only the archiver's row is not enough because the counterparty may otherwise keep an archived reply target.

- [ ] **Step 9: Add queued delivery tests**

Add tests:

```ts
it('lists queued deliveries for a player oldest first', async () => {
  const db = makeTextDb({
    selectQueues: [[
      { id: 'delivery-1', recipientPlayerId: 'recipient', status: 'queued', createdAt: new Date('2026-05-01T10:00:00Z') },
      { id: 'delivery-2', recipientPlayerId: 'recipient', status: 'queued', createdAt: new Date('2026-05-01T10:01:00Z') },
    ]],
  });
  const svc = new PhoneTextService(db);
  const rows = await svc.getQueuedDeliveriesForPlayer('recipient');
  expect(rows.map((r) => r.id)).toEqual(['delivery-1', 'delivery-2']);
});

it('claims a queued delivery before Discord send and returns null if another worker claimed it', async () => {
  const db = makeTextDb({
    updateReturning: [
      [{ id: 'delivery-1', status: 'delivering', claimedAt: new Date('2026-05-01T10:00:00Z') }],
      [],
    ],
  });
  const svc = new PhoneTextService(db);
  await expect(svc.claimDeliveryForSend('delivery-1', new Date('2026-05-01T10:00:00Z'))).resolves.toMatchObject({
    status: 'delivering',
  });
  await expect(svc.claimDeliveryForSend('delivery-1', new Date('2026-05-01T10:00:01Z'))).resolves.toBeNull();
});

it('marks delivery delivered with the recipient Discord message id', async () => {
  const updated: unknown[] = [];
  const db = makeTextDb({ updateReturning: [[{ id: 'delivery-1' }]], updatedValues: updated });
  const svc = new PhoneTextService(db);
  await svc.markDeliveryDelivered('delivery-1', 'discord-msg-1');
  expect(updated[0]).toMatchObject({ status: 'delivered', recipientDiscordMessageId: 'discord-msg-1' });
});

it('marks delivery failed with a bounded reason', async () => {
  const updated: unknown[] = [];
  const db = makeTextDb({ updateReturning: [[{ id: 'delivery-1' }]], updatedValues: updated });
  const svc = new PhoneTextService(db);
  await svc.markDeliveryFailed('delivery-1', 'x'.repeat(600));
  expect((updated[0] as { failureReason: string }).failureReason).toHaveLength(500);
});

it('sweeps stale text delivery claims back to queued', async () => {
  const db = makeTextDb({
    updateReturning: [[{ id: 'delivery-1', status: 'queued', claimedAt: null }]],
  });
  const svc = new PhoneTextService(db);
  await expect(
    svc.sweepStaleTextDeliveryClaims({ now: new Date('2026-05-01T10:10:00Z'), maxAgeMs: 60_000 }),
  ).resolves.toEqual([{ id: 'delivery-1', status: 'queued', claimedAt: null }]);
});

it('marks stale text tap delivery placeholders failed', async () => {
  const db = makeTextDb({
    updateReturning: [[{ id: 'tap-delivery-1', error: 'relay crashed before delivery' }]],
  });
  const svc = new PhoneTextService(db);
  await expect(
    svc.sweepStaleTextTapDeliveries({ now: new Date('2026-05-01T10:10:00Z'), maxAgeMs: 60_000 }),
  ).resolves.toEqual([{ id: 'tap-delivery-1', error: 'relay crashed before delivery' }]);
});
```

- [ ] **Step 10: Implement queued delivery methods**

Implement delivery methods with `PHONE_TEXT_DELIVERY_BATCH_LIMIT` default and `failureReason.slice(0, 500)`.

`claimDeliveryForSend` must be a conditional update:

```ts
UPDATE phone_text_message_deliveries
SET status = 'delivering', claimed_at = now
WHERE id = deliveryId AND status = 'queued'
RETURNING *
```

`sweepStaleTextDeliveryClaims` should move old `delivering` rows back to `queued` and clear `claimedAt` so a bot crash after claim but before DM does not strand the message forever. Its default cutoff is `PHONE_TEXT_DELIVERY_CLAIM_STALE_MS`.

`getConversationTranscript` must order by `(createdAt, sequenceNo)`, not `createdAt` alone.

- [ ] **Step 11: Run API tests**

Run:

```bash
pnpm --filter @hansard/api test:run -- src/services/phoneTextService.test.ts
pnpm --filter @hansard/api build
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/api/src/services/phoneTextService.ts packages/api/src/services/phoneTextService.test.ts
git commit -m "feat(api): add phone text service"
```

## Task 4: Discord Text Relay

**Files:**
- Create: `packages/bot/src/utils/phoneTextRelay.ts`
- Create: `packages/bot/src/utils/phoneTextRelay.test.ts`
- Modify: `packages/bot/src/utils/phoneRelay.ts`

Relay API:

```ts
export async function relayPhoneText(
  client: Client,
  recorded: RecordedPhoneText,
): Promise<'delivered' | 'queued' | 'failed'>;

export async function flushQueuedPhoneTextsForPlayer(
  client: Client,
  playerId: string,
): Promise<{ delivered: number; failed: number }>;
```

- [ ] **Step 1: Write failing test: recipient on call queues**

In `phoneTextRelay.test.ts`:

```ts
it('does not DM-deliver a text when the recipient currently has an open call', async () => {
  mocks.phoneSvc.findOpenCallForPlayer.mockResolvedValue({ id: 'call-1', status: 'active' });
  const result = await relayPhoneText(client, recordedText());

  expect(result).toBe('queued');
  expect(client.users.fetch).not.toHaveBeenCalledWith('recipient-discord');
  expect(mocks.textSvc.markDeliveryDelivered).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter @hansard/bot test:run -- src/utils/phoneTextRelay.test.ts
```

Expected: FAIL because `phoneTextRelay.ts` does not exist.

- [ ] **Step 3: Implement call-busy gate**

In `relayPhoneText`, instantiate `PhoneService(db)` and call `findOpenCallForPlayer(recorded.context.recipient.playerId)`.

If it returns a call, return `'queued'` without DM delivery. This works for the voicemail nuance because `findOpenCallForPlayer` returns caller-side `voicemail` sessions but not mailbox-owner voicemail sessions.

- [ ] **Step 4: Add delivered-path test**

```ts
it('DM-delivers text when recipient is not on a call', async () => {
  mocks.phoneSvc.findOpenCallForPlayer.mockResolvedValue(null);
  mocks.textSvc.claimDeliveryForSend.mockResolvedValue({ id: 'delivery-1', status: 'delivering' });
  const result = await relayPhoneText(client, recordedText());

  expect(result).toBe('delivered');
  expect(mocks.textSvc.claimDeliveryForSend).toHaveBeenCalledWith('delivery-1', expect.any(Date));
  expect(mocks.textSvc.markDeliveryDelivered).toHaveBeenCalledWith('delivery-1', 'dm-message-1');
});
```

- [ ] **Step 5: Implement DM delivery**

Before sending any recipient DM, call `PhoneTextService.claimDeliveryForSend(recorded.delivery.id, new Date())`. If it returns `null`, another worker claimed or delivered the row; skip the DM and return `'queued'`.

Player DM format:

```ts
const content = `**${senderLabel}:** ${piece}`;
```

Where `senderLabel` is:

```ts
function publicTextNumberLabel(number: { numberRaw: string; pseudonym: string | null }): string {
  return number.pseudonym ? `${number.pseudonym} (${number.numberRaw})` : number.numberRaw;
}
```

Chunk with `PHONE_DM_CHUNK_BUDGET` and store only the first sent DM id on the delivery.

- [ ] **Step 6: Add staff mirror test**

```ts
it('mirrors delivered or queued text messages to a staff thread', async () => {
  mocks.phoneSvc.findOpenCallForPlayer.mockResolvedValue({ id: 'call-1', status: 'active' });
  await relayPhoneText(client, recordedText());

  expect(mocks.textSvc.updateStaffMirrorMessage).toHaveBeenCalledWith('message-1', 'staff-message-1');
});
```

- [ ] **Step 7: Implement staff mirror**

Create or fetch a private staff thread using `PHONE_LOG_CHANNEL_ID`.

Thread naming:

```ts
const threadName = `✉ ${senderName} ↔ ${recipientName}`.slice(0, 95);
```

Embed:

```ts
new EmbedBuilder()
  .setColor(0x4f8fba)
  .setAuthor({ name: senderStaffLabel })
  .setDescription(piece)
  .setFooter({ text: `text to ${recipientStaffLabel}${queued ? ' • queued for recipient' : ''}` })
  .setTimestamp(new Date());
```

Persist `phone_text_conversations.staff_conversation_id` with `PhoneTextService.setStaffThread`.

- [ ] **Step 8: Add tap fan-out test**

```ts
it('delivers text tap copies for tap delivery placeholders', async () => {
  await relayPhoneText(client, recordedText({ tapDeliveries: [{ id: 'tap-delivery-1', tapId: 'tap-1' }] }));
  expect(mocks.textSvc.completeTapDelivery).toHaveBeenCalledWith('tap-delivery-1', expect.objectContaining({
    mirrorMessageId: 'tap-message-1',
  }));
});
```

- [ ] **Step 9: Implement tap fan-out**

Mirror the call relay's tap behavior, but write results to `phone_text_message_tap_deliveries` via `PhoneTextService.completeTapDelivery`.

For each tap placeholder, re-check `PhoneService.isTapActive(tap.id)` immediately before posting the mirror copy. If the tap was revoked between the text-message transaction and Discord fan-out, complete the text tap delivery with `{ error: 'tap revoked before delivery' }` and do not post.

- [ ] **Step 10: Add queued flush test**

```ts
it('flushes queued deliveries after a call ends', async () => {
  mocks.textSvc.getQueuedDeliveriesForPlayer.mockResolvedValue([queuedDelivery()]);
  mocks.textSvc.claimDeliveryForSend.mockResolvedValue({ id: 'delivery-1', status: 'delivering' });
  await flushQueuedPhoneTextsForPlayer(client, 'recipient-player');

  expect(client.users.fetch).toHaveBeenCalledWith('recipient-discord');
  expect(mocks.textSvc.markDeliveryDelivered).toHaveBeenCalledWith('delivery-1', 'dm-message-1');
});
```

- [ ] **Step 11: Implement queued flush**

`flushQueuedPhoneTextsForPlayer` fetches queued deliveries, hydrates each message context, re-checks `PhoneService.findOpenCallForPlayer(playerId)`, and stops if the player is still busy. For each row, call `claimDeliveryForSend` before the DM send; skip rows that return `null` so concurrent flushes cannot double-deliver the same text.

- [ ] **Step 12: Run bot relay tests**

Run:

```bash
pnpm --filter @hansard/bot test:run -- src/utils/phoneTextRelay.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/bot/src/utils/phoneTextRelay.ts packages/bot/src/utils/phoneTextRelay.test.ts
git commit -m "feat(bot): add phone text relay"
```

## Task 5: Freeform DM Routing

**Files:**
- Modify: `packages/bot/src/events/messageCreate.ts`
- Modify: `packages/bot/src/events/messageCreate.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests:

```ts
it('keeps active call DMs on the call path and does not route them as texts', async () => {
  setupActiveCall();
  await handler(makeMessage('this is speech'));

  expect(mocks.svc.recordMessage).toHaveBeenCalled();
  expect(mocks.textSvc.recordReply).not.toHaveBeenCalled();
});

it('routes a freeform DM to the selected text conversation when the player has no open call', async () => {
  setupNoOpenCall();
  mocks.textSvc.resolveReplyConversation.mockResolvedValue({ status: 'selected', context: { thread: { id: 'thread-1' } } });
  mocks.textSvc.recordReply.mockResolvedValue(recordedText());

  await handler(makeMessage('slow reply'));

  expect(mocks.textSvc.recordReply).toHaveBeenCalledWith({
    senderPlayerId: 'player-caller',
    conversationId: 'thread-1',
    content: 'slow reply',
    senderDiscordMessageId: 'discord-message-1',
  });
});

it('does not store a freeform DM when there is no selected text conversation', async () => {
  setupNoOpenCall();
  mocks.textSvc.resolveReplyConversation.mockResolvedValue({ status: 'none' });

  await handler(makeMessage('where does this go'));

  expect(mocks.textSvc.recordReply).not.toHaveBeenCalled();
  expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.stringContaining('/phone conversations'),
  }));
});

it('routes to the sole active text conversation when no explicit reply target exists', async () => {
  setupNoOpenCall();
  mocks.textSvc.resolveReplyConversation.mockResolvedValue({ status: 'sole', context: { thread: { id: 'thread-1' } } });
  mocks.textSvc.recordReply.mockResolvedValue(recordedText());

  await handler(makeMessage('hi back'));

  expect(mocks.textSvc.recordReply).toHaveBeenCalledWith(expect.objectContaining({
    senderPlayerId: 'player-caller',
    conversationId: 'thread-1',
    content: 'hi back',
  }));
});

it('asks the player to switch when several active text conversations exist', async () => {
  setupNoOpenCall();
  mocks.textSvc.resolveReplyConversation.mockResolvedValue({ status: 'multiple', threads: [{ thread: { id: 'thread-1' } }, { thread: { id: 'thread-2' } }] });

  const message = makeMessage('ambiguous reply');
  await handler(message);

  expect(mocks.textSvc.recordReply).not.toHaveBeenCalled();
  expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.stringContaining('/phone switch'),
  }));
});

it('does not let the no-call negative cache bypass text conversation routing', async () => {
  setupNoOpenCall();
  mocks.textSvc.resolveReplyConversation.mockResolvedValue({ status: 'sole', context: { thread: { id: 'thread-1' } } });
  await handler(makeMessage('first text reply'));
  await handler(makeMessage('second text reply within ttl'));

  expect(mocks.textSvc.resolveReplyConversation).toHaveBeenCalledTimes(2);
  expect(mocks.textSvc.recordReply).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @hansard/bot test:run -- src/events/messageCreate.test.ts
```

Expected: FAIL because text mocks are not wired and DM routing has no text path.

- [ ] **Step 3: Add text routing after the existing no-call branch**

In `handleDmMessage`, after `findOpenCallForPlayer(player.id)` returns null and after empty-content handling, call:

```ts
const textSvc = new PhoneTextService(db);
const resolution = await textSvc.resolveReplyConversation(player.id);
if (resolution.status === 'none') {
  rememberNoCall(message.author.id);
  await maybeReplyWithTextThreadHint(message);
  return;
}
if (resolution.status === 'multiple') {
  rememberNoCall(message.author.id);
  await message.reply({
    content: PHONE_TEXT_MULTIPLE_THREADS,
    allowedMentions: { repliedUser: false, parse: [] },
  });
  return;
}

const recorded = await textSvc.recordReply({
  senderPlayerId: player.id,
  conversationId: resolution.context.thread.id,
  content: message.content,
  senderDiscordMessageId: message.id,
});
await relayPhoneText(client, recorded);
```

Do not call the text path before checking for an open call.

The existing `hasFreshNoCallEntry` fast path can no longer short-circuit non-empty DMs before player and text-thread resolution. Remove that fast path for non-empty content; keep it only for empty-content non-call DMs if useful. Only call `rememberNoCall` after `resolveReplyConversation` returns `none` or `multiple`. Also update both existing no-call hint strings, because `messageCreate.ts` currently has the text in the fast path and the DB-lookup path.

- [ ] **Step 4: Update no-call hint text**

Change the hint to mention calls and text conversations:

```ts
"You're not in a call and you don't have a selected text conversation. Use `/phone dial <number>` to call, or `/phone text <number> <message>` to text."
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @hansard/bot test:run -- src/events/messageCreate.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bot/src/events/messageCreate.ts packages/bot/src/events/messageCreate.test.ts
git commit -m "feat(bot): route freeform DMs to phone text conversations"
```

## Task 6: Slash Commands

**Files:**
- Modify: `packages/bot/src/commands/phone/phone.ts`
- Modify: `packages/bot/src/commands/phone/phone.test.ts`

- [ ] **Step 1: Write failing command metadata tests**

Add:

```ts
it('contains text-thread subcommands', () => {
  const subcommands = json.options?.filter((o) => o.type === 1).map((o) => o.name);
  expect(subcommands).toEqual(expect.arrayContaining(['text', 'conversations', 'switch', 'close-conversation']));
});

it('text subcommand accepts number, message, and optional from number', () => {
  const text = json.options?.find((o) => o.type === 1 && o.name === 'text') as { options?: Array<{ name: string }> };
  expect(text.options?.map((o) => o.name)).toEqual(expect.arrayContaining(['number', 'message', 'from']));
});

it('switch and close-conversation expose conversation-id autocomplete', () => {
  const switchCmd = json.options?.find((o) => o.type === 1 && o.name === 'switch') as { options?: Array<{ name: string; autocomplete?: boolean }> };
  const closeCmd = json.options?.find((o) => o.type === 1 && o.name === 'close-conversation') as { options?: Array<{ name: string; autocomplete?: boolean }> };
  expect(switchCmd.options?.find((o) => o.name === 'conversation-id')?.autocomplete).toBe(true);
  expect(closeCmd.options?.find((o) => o.name === 'conversation-id')?.autocomplete).toBe(true);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @hansard/bot test:run -- src/commands/phone/phone.test.ts
```

Expected: FAIL because subcommands do not exist.

- [ ] **Step 3: Add command definitions**

Add:

```ts
.addSubcommand((sub) =>
  sub
    .setName('text')
    .setDescription('Send a persistent phone text message')
    .addStringOption((opt) =>
      opt.setName('number').setDescription('Number to text').setRequired(true).setMaxLength(32),
    )
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Message to send').setRequired(true).setMaxLength(PHONE_TEXT_MESSAGE_MAX_LENGTH),
    )
    .addStringOption((opt) =>
      opt.setName('from').setDescription('Which of your numbers to text from').setRequired(false).setMaxLength(32).setAutocomplete(true),
    ),
)
.addSubcommand((sub) =>
  sub
    .setName('threads')
    .setDescription('List active phone text conversations')
    .addIntegerOption((opt) => opt.setName('page').setDescription('Page number').setMinValue(1).setMaxValue(999).setRequired(false)),
)
.addSubcommand((sub) =>
  sub
    .setName('switch')
    .setDescription('Choose which text conversation freeform DMs reply to')
    .addStringOption((opt) => opt.setName('conversation-id').setDescription('Text conversation id').setRequired(true).setAutocomplete(true)),
)
.addSubcommand((sub) =>
  sub
    .setName('close-conversation')
    .setDescription('Archive a phone text conversation')
    .addStringOption((opt) => opt.setName('conversation-id').setDescription('Text conversation id').setRequired(true).setAutocomplete(true)),
)
```

- [ ] **Step 4: Implement handlers**

Add:

```ts
async function handleText(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = await requirePlayer(interaction);
  if (!player) return;
  const targetNumberInput = interaction.options.getString('number', true);
  const message = interaction.options.getString('message', true);
  const fromNumber = interaction.options.getString('from');
  const ownedNumber = fromNumber
    ? await requireOwnedNumber(interaction, player, fromNumber)
    : (await svc().listMyNumbers(player.id))[0] ?? null;
  if (!ownedNumber) {
    await interaction.editReply({ embeds: [errorEmbed('You need to register a phone number before texting. Try `/phone register`.')] });
    return;
  }
  const recipientNumber = await svc().lookupNumber(targetNumberInput);
  if (!recipientNumber) {
    await interaction.editReply({ embeds: [errorEmbed(PHONE_NUMBER_NOT_FOUND)] });
    return;
  }
  const textSvc = new PhoneTextService(db);
  const recorded = await textSvc.recordText({
    senderPlayerId: player.id,
    senderNumberId: ownedNumber.id,
    recipientNumberId: recipientNumber.id,
    content: message,
  });
  const delivery = await relayPhoneText(interaction.client, recorded);
  await textSvc.setReplyConversation(player.id, recorded.context.thread.id);
  clearNoCallCache(interaction.user.id);
  await interaction.editReply({
    embeds: [successEmbed('Text sent', delivery === 'queued'
      ? `Message saved from **${ownedNumber.numberRaw}**. The recipient is on a call, so it will be delivered when their line is free.`
      : `Message delivered from **${ownedNumber.numberRaw}**. Freeform DMs now reply to this text conversation.`,
    )],
  });
}
```

Add handlers for `conversations`, `switch`, and `close-conversation` using `PhoneTextService.listConversationsForPlayer`, `setReplyConversation`, and `archiveConversation`.
`handleTextSwitch` and `handleText` must both call `clearNoCallCache(interaction.user.id)` after setting the reply thread so a stale no-call/no-thread cache entry cannot bypass the newly selected text conversation.

- [ ] **Step 5: Wire execute switch**

Add cases:

```ts
case 'text':
  await handleText(interaction);
  break;
case 'threads':
  await handleTextThreads(interaction);
  break;
case 'switch':
  await handleTextSwitch(interaction);
  break;
case 'close-conversation':
  await handleTextCloseThread(interaction);
  break;
```

- [ ] **Step 6: Extend autocomplete**

For `text from`, reuse existing owned-number autocomplete.

For `switch conversation-id` and `close-conversation conversation-id`, list active text conversations for the user and return choices:

```ts
{
  name: `${shortId(thread.id)} — ${otherLabel}`,
  value: thread.id,
}
```

- [ ] **Step 7: Run command tests**

Run:

```bash
pnpm --filter @hansard/bot test:run -- src/commands/phone/phone.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/bot/src/commands/phone/phone.ts packages/bot/src/commands/phone/phone.test.ts
git commit -m "feat(bot): add phone text commands"
```

## Task 7: Flush Queued Texts After Calls

**Files:**
- Modify: `packages/bot/src/utils/phoneRelay.ts`
- Modify: `packages/bot/src/services/phoneRingTimeout.ts`
- Modify: `packages/bot/src/services/phoneRingTimeout.test.ts`
- Modify: `packages/bot/src/utils/phoneTextRelay.test.ts`

- [ ] **Step 1: Add test for call-end flushing**

In `phoneTextRelay.test.ts` or `phoneRelay` test coverage:

```ts
it('flushes queued texts for both participants after a call ends', async () => {
  await hangUpAndNotify(client, 'call-1', 'hangup_caller');
  expect(mocks.flushQueuedPhoneTextsForPlayer).toHaveBeenCalledWith(client, 'caller-player');
  expect(mocks.flushQueuedPhoneTextsForPlayer).toHaveBeenCalledWith(client, 'recipient-player');
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter @hansard/bot test:run -- src/utils/phoneRelay.test.ts src/utils/phoneTextRelay.test.ts
```

Expected: FAIL because `hangUpAndNotify` does not flush texts.

- [ ] **Step 3: Flush in `hangUpAndNotify`**

After participant notifications and staff-thread end embed, add:

```ts
for (const player of [context.callerPlayer, context.recipientPlayer]) {
  try {
    await flushQueuedPhoneTextsForPlayer(client, player.id);
  } catch (err) {
    console.error('[phone:relay] failed to flush queued phone texts:', err);
  }
}
```

- [ ] **Step 4: Flush explicit voicemail completion paths**

In `messageCreate.ts`, after `svc.systemEndCall(openCall.id, 'voicemail_left')`, call:

```ts
await flushQueuedPhoneTextsForPlayer(client, player.id);
```

In `phoneRingTimeout.ts`, after abandoned voicemail sessions are ended, call the same helper for the caller.

- [ ] **Step 5: Recover stale text delivery claims and tap placeholders**

Add worker calls in `phoneRingTimeout.ts` alongside the existing tap-delivery reconciliation:

```ts
await new PhoneTextService(db).sweepStaleTextDeliveryClaims();
await new PhoneTextService(db).sweepStaleTextTapDeliveries();
```

Add tests that assert:

```ts
it('recovers stale text delivery claims so queued texts are not stranded after a crash', async () => {
  mocks.textSvc.sweepStaleTextDeliveryClaims.mockResolvedValue([{ id: 'delivery-1' }]);
  await tickPhoneWorkerOnce();
  expect(mocks.textSvc.sweepStaleTextDeliveryClaims).toHaveBeenCalled();
});

it('marks stale text tap delivery placeholders as failed', async () => {
  mocks.textSvc.sweepStaleTextTapDeliveries.mockResolvedValue([{ id: 'tap-delivery-1' }]);
  await tickPhoneWorkerOnce();
  expect(mocks.textSvc.sweepStaleTextTapDeliveries).toHaveBeenCalled();
});
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @hansard/bot test:run -- src/events/messageCreate.test.ts src/utils/phoneTextRelay.test.ts src/services/phoneRingTimeout.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/bot/src/utils/phoneRelay.ts packages/bot/src/services/phoneRingTimeout.ts packages/bot/src/services/phoneRingTimeout.test.ts packages/bot/src/events/messageCreate.ts packages/bot/src/events/messageCreate.test.ts packages/bot/src/utils/phoneTextRelay.test.ts
git commit -m "feat(bot): flush queued texts after phone calls"
```

## Task 8: MCP Read Tools

**Files:**
- Modify: `packages/mcp/src/tools/phones.ts`
- Modify: `packages/mcp/src/tools/register.test.ts` if tool registration snapshots cover phone tools.

- [ ] **Step 1: Add tools**

Add:

- `list_phone_text_conversations`
- `get_phone_text_transcript`

Schemas:

```ts
inputSchema: {
  playerId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
}
```

```ts
inputSchema: {
  conversationId: z.string().uuid(),
}
```

Participant redaction: non-staff can only inspect their own threads and should not see Discord message ids or staff mirror ids. `get_phone_text_transcript` must return `{ thread: null, messages: [] }` for both missing threads and non-participant threads, matching `get_phone_call_transcript`'s no-existence-leak behavior.

- [ ] **Step 2: Run MCP tests**

Run:

```bash
pnpm --filter @hansard/mcp test:run
pnpm --filter @hansard/mcp build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/src/tools/phones.ts packages/mcp/src/tools/register.test.ts
git commit -m "feat(mcp): expose phone text conversation reads"
```

## Task 9: Project Memory

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a concise note**

Add a project-memory note near the phone-system guidance:

```md
### Phone text conversations

Persistent phone text conversations live in `phone_text_*` tables and are separate from live `phone_calls`.
Live calls own freeform Discord DMs: if `PhoneService.findOpenCallForPlayer` returns a ringing, active, or caller-side voicemail session, DM text must stay on the call/voicemail path. Otherwise freeform DMs route to the selected active text conversation, or the sole active text conversation when exactly one exists. Text delivery to a busy recipient is claimed/queued in `phone_text_message_deliveries` and flushed after the call/voicemail session ends; never let the no-call negative cache bypass text-thread routing.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note phone text conversation routing rules"
```

## Task 10: Whole-Repo Verification

**Files:**
- No new source files.

- [ ] **Step 1: Run focused package tests**

Run:

```bash
pnpm --filter @hansard/db test:run -- scripts/migrate-phones.test.ts
pnpm --filter @hansard/api test:run -- src/services/phoneTextService.test.ts
pnpm --filter @hansard/bot test:run -- src/events/messageCreate.test.ts src/commands/phone/phone.test.ts src/utils/phoneTextRelay.test.ts src/services/phoneRingTimeout.test.ts
pnpm --filter @hansard/mcp test:run
```

Expected: PASS.

- [ ] **Step 2: Run package builds**

Run:

```bash
pnpm --filter @hansard/db build
pnpm --filter @hansard/api build
pnpm --filter @hansard/bot build
pnpm --filter @hansard/mcp build
```

Expected: PASS.

- [ ] **Step 3: Run full test suite if time allows**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Manual Discord verification**

Use two test players A and B with registered numbers.

1. A runs `/phone text number:<B-number> message:hello`.
2. B receives a DM text.
3. B replies in DM with `hi`; A receives it.
4. A starts an active `/phone dial` call with another player.
5. B texts A while A is on the active call.
6. Confirm A does not receive the text DM during the call.
7. End A's call.
8. Confirm queued text delivery arrives after the call ends.
9. A runs `/phone conversations`.
10. A runs `/phone switch thread:<conversation-id>`.
11. A freeform DMs the bot and the message routes to that thread.
12. A runs `/phone close-conversation thread:<conversation-id>`.
13. A freeform DMs the bot and receives the "no selected text conversation" hint.

- [ ] **Step 5: Final commit if verification fixes were needed**

```bash
git status --short
git add packages/db/src/schema/phones.ts packages/db/scripts/migrate-phones.ts packages/db/scripts/migrate-phones.test.ts packages/shared/src/constants/phones.ts packages/api/src/services/phoneTextService.ts packages/api/src/services/phoneTextService.test.ts packages/bot/src/utils/phoneTextRelay.ts packages/bot/src/utils/phoneTextRelay.test.ts packages/bot/src/events/messageCreate.ts packages/bot/src/events/messageCreate.test.ts packages/bot/src/commands/phone/phone.ts packages/bot/src/commands/phone/phone.test.ts packages/bot/src/utils/phoneRelay.ts packages/bot/src/services/phoneRingTimeout.ts packages/bot/src/services/phoneRingTimeout.test.ts packages/mcp/src/tools/phones.ts packages/mcp/src/tools/register.test.ts CLAUDE.md
git commit -m "test: verify phone text conversations"
```

## Explicit Non-Goals

- Do not alter the existing `phone_calls` caller/recipient model.
- Do not allow freeform DMs to choose between call speech and text replies while a call is open.
- Do not implement group/conference calls in this pass.
- Do not add web UI for text conversations in this pass.
- Do not deliver attachments, stickers, embeds, or non-text content.
- Slash-command text is capped at `PHONE_TEXT_MESSAGE_MAX_LENGTH`; freeform DM replies may be longer and should be chunked through the existing DM chunking path. This asymmetry is intentional because Discord slash string limits and DM message limits are different surfaces.

## Follow-Up Plan For Conference Calls

After one-to-one text conversations ship, conference calls should be designed as a separate participant-based call model:

- `phone_conferences`
- `phone_conference_participants`
- `phone_conference_messages`
- per-recipient conference delivery rows
- invite/answer/leave controls per participant
- staff thread keyed by conference id

The one-to-one text delivery table intentionally mirrors that future fan-out shape so the later work can reuse queued-delivery logic rather than starting from nothing.

## Self-Review

- Spec coverage: multiple separate one-to-one conversations are covered by `phone_text_conversations`; DM default behavior is covered by selected-or-sole-thread routing; recipient-on-call suppression is covered by relay queueing, delivery claiming, and call-end flushing; conference calls are explicitly deferred.
- Placeholder scan: no implementation step depends on an unspecified table, function, or command. The only intentionally deferred work is listed under non-goals and follow-up plan.
- Review-fix coverage: recipient replies work through the sole-thread fallback; the no-call negative cache cannot bypass text routing; queued delivery flushes claim rows before sending; first-text conversation creation is advisory-lock guarded; transcript reads use `(createdAt, sequenceNo)`; archiving clears both participants' reply states; text tap placeholders have a worker sweep; text tap fan-out re-checks active taps.
- Type consistency: `PhoneTextService`, `RecordedPhoneText`, `PhoneTextReplyResolution`, `relayPhoneText`, `claimDeliveryForSend`, and `flushQueuedPhoneTextsForPlayer` names are used consistently across service, bot relay, command, and event tasks.
