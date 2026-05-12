import { pgTable, uuid, varchar, text, boolean, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { players } from './players';

// === PHONE NUMBERS ===
// Player-owned phone lines. Players can register multiple numbers ("burner", "main", etc.).
// Numbers are player-chosen strings. `numberNormalized` is the unique lookup key
// (digits-only with optional leading `+`); `numberRaw` preserves the user's chosen formatting.
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
}));

// === PHONE CALLS ===
// Session-based call between two numbers. One open call (ringing|active) per player at a time —
// enforced by the partial unique indexes below.
export const phoneCalls = pgTable('phone_calls', {
  id: uuid('id').primaryKey().defaultRandom(),

  callerNumberId: uuid('caller_number_id').references(() => phoneNumbers.id).notNull(),
  recipientNumberId: uuid('recipient_number_id').references(() => phoneNumbers.id).notNull(),
  callerPlayerId: uuid('caller_player_id').references(() => players.id).notNull(),
  recipientPlayerId: uuid('recipient_player_id').references(() => players.id).notNull(),

  status: varchar('status', { length: 16 }).default('ringing').notNull(),
  // 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'cancelled'

  endedReason: varchar('ended_reason', { length: 64 }),
  // 'hangup_caller' | 'hangup_recipient' | 'ring_timeout' | 'dm_closed' | 'relay_failed'
  // | 'force_ended_by_staff' | 'declined_by_recipient' | 'cancelled_by_caller'

  ringDiscordMessageId: varchar('ring_discord_message_id', { length: 20 }),
  staffThreadId: varchar('staff_thread_id', { length: 20 }),

  ringExpiresAt: timestamp('ring_expires_at', { withTimezone: true, mode: 'date' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true, mode: 'date' }),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
}, (table) => ({
  // Only one OPEN call (ringing or active) per player at a time. Caught as 23505 in service.
  oneOpenCaller: uniqueIndex('phone_calls_one_open_caller')
    .on(table.callerPlayerId)
    .where(sql`status IN ('ringing','active')`),
  oneOpenRecipient: uniqueIndex('phone_calls_one_open_recipient')
    .on(table.recipientPlayerId)
    .where(sql`status IN ('ringing','active')`),
  callerHistoryIdx: index('phone_calls_caller_history_idx').on(table.callerPlayerId, table.startedAt),
  recipientHistoryIdx: index('phone_calls_recipient_history_idx').on(table.recipientPlayerId, table.startedAt),
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
}));

// === PHONE THREADS ===
// One private staff thread per unordered pair of players. Reused across all calls between
// the same two players. CHECK constraint enforces the canonical ordering so the unique index
// works without app-side sorting tricks.
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
// `mirrorChannelId` (defaults to PHONE_TAP_CHANNEL_ID env) and/or DM to `mirrorUserId`.
// `mirrorUserId` is a raw Discord snowflake, not a player UUID, so taps can target in-character
// intel officers without dragging them into the players table.
export const phoneTaps = pgTable('phone_taps', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetNumberId: uuid('target_number_id').references(() => phoneNumbers.id).notNull(),

  createdById: uuid('created_by_id').references(() => players.id).notNull(),
  mirrorChannelId: varchar('mirror_channel_id', { length: 20 }),
  mirrorUserId: varchar('mirror_user_id', { length: 20 }),
  reason: text('reason'),

  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  revokedById: uuid('revoked_by_id').references(() => players.id),
}, (table) => ({
  activeNumberIdx: index('phone_taps_active_number_idx').on(table.targetNumberId).where(sql`is_active = true`),
}));

// === PHONE TAP AUDIT LOG ===
// Every tap creation/revocation is logged so a rogue staff member can't silently tap-and-untap.
export const phoneTapAuditLog = pgTable('phone_tap_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tapId: uuid('tap_id').references(() => phoneTaps.id).notNull(),
  actorId: uuid('actor_id').references(() => players.id).notNull(),
  action: varchar('action', { length: 32 }).notNull(),  // 'created' | 'revoked'
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// === PHONE MESSAGE TAP DELIVERIES ===
// Per-tap fan-out record for each relayed message. Lets staff see who got each copy and
// makes failed mirror sends retriable.
export const phoneMessageTapDeliveries = pgTable('phone_message_tap_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').references(() => phoneMessages.id, { onDelete: 'cascade' }).notNull(),
  tapId: uuid('tap_id').references(() => phoneTaps.id).notNull(),
  mirrorMessageId: varchar('mirror_message_id', { length: 20 }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
  error: text('error'),
});
