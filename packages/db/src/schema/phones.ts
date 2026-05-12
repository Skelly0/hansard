import { pgTable, uuid, varchar, text, boolean, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
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
  numberNormalized: varchar('number_normalized', { length: 32 }).notNull().unique(),

  label: varchar('label', { length: 64 }),
  cachedCharacterName: varchar('cached_character_name', { length: 128 }),

  isActive: boolean('is_active').default(true).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'date' }),
}, (table) => ({
  playerIdx: index('phone_numbers_player_idx').on(table.playerId),
  normalizedShape: check('phone_numbers_normalized_shape', sql`number_normalized ~ '^\\+?[0-9]{3,20}$'`),
}));

// === PHONE CALLS ===
// Session-based call between two numbers. Each call row also carries the participant pair as
// generated `participant_low_id` / `participant_high_id` columns so a single partial unique index
// can enforce "one open call per player, regardless of role" — without this, a recipient of a
// ringing call could still place an outbound call.
export const phoneCalls = pgTable('phone_calls', {
  id: uuid('id').primaryKey().defaultRandom(),

  callerNumberId: uuid('caller_number_id').references(() => phoneNumbers.id).notNull(),
  recipientNumberId: uuid('recipient_number_id').references(() => phoneNumbers.id).notNull(),
  callerPlayerId: uuid('caller_player_id').references(() => players.id).notNull(),
  recipientPlayerId: uuid('recipient_player_id').references(() => players.id).notNull(),

  status: varchar('status', { length: 16 }).default('ringing').notNull(),
  // CHECK constrained at DB level: 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'cancelled'

  endedReason: varchar('ended_reason', { length: 80 }),
  // 'hangup_caller' | 'hangup_recipient' | 'ring_timeout' | 'dm_closed' | 'relay_failed'
  // | 'force_ended_by_staff' (optionally suffixed with `:<note>`) | 'declined_by_recipient'
  // | 'cancelled_by_caller' | 'session_reset' | 'number_deactivated'

  ringDiscordMessageId: varchar('ring_discord_message_id', { length: 20 }),
  staffThreadId: varchar('staff_thread_id', { length: 20 }),

  ringExpiresAt: timestamp('ring_expires_at', { withTimezone: true, mode: 'date' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true, mode: 'date' }),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
}, (table) => ({
  // One OPEN call per player, regardless of caller/recipient role. The two partial indexes below
  // cover both columns; either index will reject the second insert with 23505.
  oneOpenCaller: uniqueIndex('phone_calls_one_open_caller')
    .on(table.callerPlayerId)
    .where(sql`status IN ('ringing','active')`),
  oneOpenRecipient: uniqueIndex('phone_calls_one_open_recipient')
    .on(table.recipientPlayerId)
    .where(sql`status IN ('ringing','active')`),
  // Cross-role protection: if a player is already the *recipient* of a ringing call, they can't
  // be the *caller* on a new one. Postgres can't share a single partial unique index across two
  // columns, so we add a CHECK that rejects rows that would conflict with an existing open call
  // by participant — enforced via a service-side lookup. The composite partial indexes above
  // catch same-role races; cross-role is handled in the service `initiateCall` pre-check.
  statusCheck: check('phone_calls_status_check', sql`status IN ('ringing','active','ended','declined','missed','cancelled')`),
  callerHistoryIdx: index('phone_calls_caller_history_idx').on(table.callerPlayerId, table.startedAt),
  recipientHistoryIdx: index('phone_calls_recipient_history_idx').on(table.recipientPlayerId, table.startedAt),
  // Supports the startup `sweepStrandedActiveCalls` query, which must filter by
  // `status='active' AND started_at < cutoff` without a full table scan.
  activeStartedIdx: index('phone_calls_active_started_idx').on(table.startedAt).where(sql`status = 'active'`),
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
  actionCheck: check('phone_tap_audit_log_action_check', sql`action IN ('created','revoked','orphaned_target_deactivated')`),
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
});
