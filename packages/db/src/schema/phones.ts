import { pgTable, uuid, varchar, text, boolean, timestamp, bigserial, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { players } from './players';

// === PHONE NUMBERS ===
// Player-owned phone lines. Players can register multiple numbers ("burner", "main", etc.).
// `numberNormalized` is the unique lookup key (digits-only with optional leading `+`);
// `numberRaw` preserves the user's chosen formatting.
//
// `numberNormalized` is constrained at the DB level to `^\+?[0-9]{3,20}$` so application-side
// normalization slips (e.g. NBSP, fullwidth digits) can't bypass uniqueness via Unicode look-alikes.
export const phoneNumbers = pgTable('phone_numbers', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => players.id).notNull(),

  numberRaw: varchar('number_raw', { length: 32 }).notNull(),
  // Uniqueness is enforced on the **active** subset only (see `activeNumberUnique` below) so a
  // player can re-register a number after retiring it, or another player can claim a freed
  // number. Retired rows keep `numberNormalized` in place for call-history lookups.
  numberNormalized: varchar('number_normalized', { length: 32 }).notNull(),

  label: varchar('label', { length: 64 }),
  cachedCharacterName: varchar('cached_character_name', { length: 128 }),

  voicemailEnabled: boolean('voicemail_enabled').default(false).notNull(),
  voicemailIntroMessage: text('voicemail_intro_message'),
  voicemailPostBeepMessage: text('voicemail_post_beep_message'),

  isActive: boolean('is_active').default(true).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'date' }),
}, (table) => ({
  playerIdx: index('phone_numbers_player_idx').on(table.playerId),
  normalizedShape: check('phone_numbers_normalized_shape', sql`number_normalized ~ '^\\+?[0-9]{3,20}$'`),
  // Partial unique index: only one *active* registration per normalized number. Retired rows
  // (`is_active=false`) keep their digits in place for history lookups but don't block a new
  // registration of the same digits. Service code also lookups by `numberNormalized + is_active`
  // so dial routing always hits the active row.
  activeNumberUnique: uniqueIndex('phone_numbers_active_normalized_unique')
    .on(table.numberNormalized)
    .where(sql`is_active = true`),
}));

// === PHONE CALLS ===
// Session-based call between two numbers. The partial unique indexes below catch same-role
// duplicate opens; PhoneService also takes transaction-scoped advisory locks and checks both
// participant roles before insert so a player cannot be caller in one open call and recipient
// in another.
export const phoneCalls = pgTable('phone_calls', {
  id: uuid('id').primaryKey().defaultRandom(),

  callerNumberId: uuid('caller_number_id').references(() => phoneNumbers.id).notNull(),
  recipientNumberId: uuid('recipient_number_id').references(() => phoneNumbers.id).notNull(),
  callerPlayerId: uuid('caller_player_id').references(() => players.id).notNull(),
  recipientPlayerId: uuid('recipient_player_id').references(() => players.id).notNull(),

  status: varchar('status', { length: 16 }).default('ringing').notNull(),
  // CHECK constrained at DB level:
  // 'ringing' | 'active' | 'voicemail' | 'ended' | 'declined' | 'missed' | 'cancelled'

  endedReason: varchar('ended_reason', { length: 80 }),
  // 'hangup_caller' | 'hangup_recipient' | 'ring_timeout' | 'dm_closed' | 'relay_failed'
  // | 'force_ended_by_staff' (optionally suffixed with `:<note>`) | 'declined_by_recipient'
  // | 'cancelled_by_caller' | 'session_reset' | 'number_deactivated'

  ringDiscordMessageId: varchar('ring_discord_message_id', { length: 20 }),
  staffThreadId: varchar('staff_thread_id', { length: 20 }),

  // Snapshot copied from the recipient number at dial time. The mailbox owner can change
  // their greeting later without rewriting in-flight calls or historic transcripts.
  voicemailEnabled: boolean('voicemail_enabled').default(false).notNull(),
  voicemailIntroMessage: text('voicemail_intro_message'),
  voicemailPostBeepMessage: text('voicemail_post_beep_message'),
  voicemailPeepClaimedAt: timestamp('voicemail_peep_claimed_at', { withTimezone: true, mode: 'date' }),
  voicemailBeepedAt: timestamp('voicemail_beeped_at', { withTimezone: true, mode: 'date' }),

  ringExpiresAt: timestamp('ring_expires_at', { withTimezone: true, mode: 'date' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true, mode: 'date' }),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),

  // Backfill completion marker. NULL means "not yet backfilled" or "backfill
  // crashed mid-call"; set to NOW() by the one-shot
  // `backfill:phone-threads` script only after the call's full historic
  // transcript has been replayed into the staff thread. Distinct from
  // `staffThreadId` (which marks "a thread exists for this pair"). See spec
  // 2026-05-15-phone-log-backfill-design.md.
  backfilledAt: timestamp('backfilled_at', { withTimezone: true, mode: 'date' }),

  // Staff actor for force-end. The `ended_reason` already carries `force_ended_by_staff:<note>`,
  // but the actor's identity must survive on a structured column so the audit trail is
  // queryable without parsing the reason string. Same rogue-staff threat model as
  // `phone_tap_audit_log`. Nullable: only set when the call was force-ended by staff.
  forceEndedById: uuid('force_ended_by_id').references(() => players.id),
}, (table) => ({
  // Same-role duplicate protection for open calls.
  oneOpenCaller: uniqueIndex('phone_calls_one_open_caller')
    .on(table.callerPlayerId)
    .where(sql`status IN ('ringing','active','voicemail')`),
  oneOpenRecipient: uniqueIndex('phone_calls_one_open_recipient')
    .on(table.recipientPlayerId)
    .where(sql`status IN ('ringing','active')`),
  // Cross-role protection is handled in PhoneService with transaction-scoped advisory locks
  // and a participant-wide open-call lookup before insert.
  statusCheck: check('phone_calls_status_check', sql`status IN ('ringing','active','voicemail','ended','declined','missed','cancelled')`),
  callerHistoryIdx: index('phone_calls_caller_history_idx').on(table.callerPlayerId, table.startedAt),
  recipientHistoryIdx: index('phone_calls_recipient_history_idx').on(table.recipientPlayerId, table.startedAt),
  // Supports the startup `sweepStrandedActiveCalls` query, which must filter by
  // `status='active' AND started_at < cutoff` without a full table scan.
  activeStartedIdx: index('phone_calls_active_started_idx').on(table.startedAt).where(sql`status = 'active'`),
  // Supports the ring-timeout worker scan: `status='ringing' AND ring_expires_at <= now()`.
  // Partial on `status='ringing'` so the index only carries the small live-ring working set.
  ringTimeoutIdx: index('phone_calls_ring_timeout_idx')
    .on(table.ringExpiresAt)
    .where(sql`status = 'ringing'`),
}));

// === PHONE MESSAGES ===
// Frozen transcript of every message relayed during a call. The bot is a ledger:
// Discord-side edits/deletes are NOT propagated here.
export const phoneMessages = pgTable('phone_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  callId: uuid('call_id').references(() => phoneCalls.id, { onDelete: 'cascade' }).notNull(),
  senderPlayerId: uuid('sender_player_id').references(() => players.id).notNull(),

  content: text('content').notNull(),

  senderDiscordMessageId: varchar('sender_discord_message_id', { length: 20 }),
  recipientDiscordMessageId: varchar('recipient_discord_message_id', { length: 20 }),
  staffMirrorMessageId: varchar('staff_mirror_message_id', { length: 20 }),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  // Monotonic tiebreaker for transcript ordering. `createdAt` has millisecond resolution and
  // two messages relayed in the same millisecond would otherwise sort non-deterministically.
  // `bigserial` is gap-tolerant and strictly increasing within a table — exactly what an
  // append-only transcript needs. Transcript reads order by `(createdAt, sequenceNo)`.
  sequenceNo: bigserial('sequence_no', { mode: 'number' }).notNull(),
}, (table) => ({
  callIdx: index('phone_messages_call_idx').on(table.callId, table.createdAt),
  // Index for the reconciliation worker that retries deliveries with no recipient_message_id.
  pendingDeliveryIdx: index('phone_messages_pending_delivery_idx')
    .on(table.createdAt)
    .where(sql`recipient_discord_message_id IS NULL`),
}));

// === PHONE THREADS ===
// One private staff thread per unordered pair of players. CHECK constraint enforces the canonical
// ordering so the unique index works without app-side sorting tricks. The service still sorts
// before insert; the CHECK is a belt-and-braces backstop.
export const phoneThreads = pgTable('phone_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerAId: uuid('player_a_id').references(() => players.id).notNull(),
  playerBId: uuid('player_b_id').references(() => players.id).notNull(),
  discordThreadId: varchar('discord_thread_id', { length: 20 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
  pairUnique: uniqueIndex('phone_threads_pair_unique').on(table.playerAId, table.playerBId),
  orderedPair: check('phone_threads_ordered_pair', sql`player_a_id < player_b_id`),
  // One DB row per Discord thread. If a find/create/persist race has two relays both create
  // a Discord thread, the second INSERT trips this and the loser deletes its orphan thread.
  discordThreadUnique: uniqueIndex('phone_threads_discord_thread_unique').on(table.discordThreadId),
}));

// === PHONE TAPS ===
// Staff-set wiretap on a specific number. Tapped calls get an additional mirror to
// `mirrorChannelId` and/or DM to `mirrorDiscordUserId`. The user-id column is renamed from
// `mirror_user_id` to `mirror_discord_user_id` so the snowflake vs UUID distinction is loud
// at every call site.
export const phoneTaps = pgTable('phone_taps', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetNumberId: uuid('target_number_id').references(() => phoneNumbers.id, { onDelete: 'restrict' }).notNull(),

  createdById: uuid('created_by_id').references(() => players.id).notNull(),
  mirrorChannelId: varchar('mirror_channel_id', { length: 20 }),
  mirrorDiscordUserId: varchar('mirror_discord_user_id', { length: 20 }),
  reason: text('reason'),

  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  revokedById: uuid('revoked_by_id').references(() => players.id),
}, (table) => ({
  activeNumberIdx: index('phone_taps_active_number_idx').on(table.targetNumberId).where(sql`is_active = true`),
  // At most one *active* tap per target number. Without this, two staff tapping the same
  // number produce two active rows and every message mirrors N× — one copy per duplicate tap.
  // Retired rows (`is_active=false`) are excluded so a number can be re-tapped after revoke.
  activeTargetUnique: uniqueIndex('phone_taps_active_target_unique')
    .on(table.targetNumberId)
    .where(sql`is_active = true`),
}));

// === PHONE TAP AUDIT LOG ===
// Denormalized snapshot of the tap configuration at the time of create/revoke. Survives partial
// data loss of the live `phone_taps` row and lets auditors answer "who got copies?" without a
// join. Required by the threat model: "rogue staff member tap-and-untap" must remain reconstructible.
export const phoneTapAuditLog = pgTable('phone_tap_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tapId: uuid('tap_id').references(() => phoneTaps.id, { onDelete: 'restrict' }).notNull(),
  actorId: uuid('actor_id').references(() => players.id).notNull(),
  action: varchar('action', { length: 32 }).notNull(),
  // Denormalized snapshot of tap configuration at action time.
  targetNumberId: uuid('target_number_id'),
  targetNumberNormalized: varchar('target_number_normalized', { length: 32 }),
  mirrorChannelId: varchar('mirror_channel_id', { length: 20 }),
  mirrorDiscordUserId: varchar('mirror_discord_user_id', { length: 20 }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
  actionCheck: check('phone_tap_audit_log_action_check', sql`action IN ('created','revoked','orphaned_target_deactivated','number_deactivated')`),
  // Staff "history of this tap" inspections read every audit row for one tap in time order.
  // Without this they seq-scan the whole audit table.
  tapCreatedIdx: index('phone_tap_audit_log_tap_created_idx').on(table.tapId, table.createdAt),
}));

// === PHONE MESSAGE TAP DELIVERIES ===
// Per-tap fan-out record for each relayed message. Lets staff see who got each copy and
// makes failed mirror sends retriable.
export const phoneMessageTapDeliveries = pgTable('phone_message_tap_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').references(() => phoneMessages.id, { onDelete: 'cascade' }).notNull(),
  tapId: uuid('tap_id').references(() => phoneTaps.id, { onDelete: 'restrict' }).notNull(),
  mirrorMessageId: varchar('mirror_message_id', { length: 20 }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
  // 500-char cap so a Discord stack trace can't bloat the audit table.
  error: varchar('error', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
  tapCreatedIdx: index('phone_message_tap_deliveries_tap_created_idx').on(table.tapId, table.createdAt.desc()),
  // Supports the worker sweep for crash-stranded placeholders: `delivered_at IS NULL AND
  // error IS NULL AND created_at < cutoff`. Partial so the index only carries the small set
  // of in-flight deliveries — completed rows (the overwhelming majority) are excluded.
  pendingIdx: index('phone_message_tap_deliveries_pending_idx')
    .on(table.createdAt)
    .where(sql`delivered_at IS NULL AND error IS NULL`),
}));
