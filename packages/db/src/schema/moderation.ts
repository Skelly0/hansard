import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { players } from './players';
import { tickets } from './tickets';

export const modActions = pgTable('mod_actions', {
  id: uuid('id').primaryKey().defaultRandom(),

  targetPlayerId: uuid('target_player_id').references(() => players.id).notNull(),
  moderatorId: uuid('moderator_id').references(() => players.id).notNull(),

  type: varchar('type', { length: 32 }).notNull(),
  // 'note' | 'verbal_warning' | 'formal_warning' | 'mute' | 'temporary_suspension' | 'permanent_ban'

  reason: text('reason').notNull(),
  internalNotes: text('internal_notes'),       // staff-only context

  // For timed actions
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').default(true).notNull(),

  // If appealed
  appealStatus: varchar('appeal_status', { length: 16 }),
  // null | 'pending' | 'accepted' | 'denied'
  appealReason: text('appeal_reason'),
  appealReviewedById: uuid('appeal_reviewed_by_id').references(() => players.id),

  // Related ticket (if the mod action came from a ticket)
  ticketId: uuid('ticket_id').references(() => tickets.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const modNotes = pgTable('mod_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetPlayerId: uuid('target_player_id').references(() => players.id).notNull(),
  authorId: uuid('author_id').references(() => players.id).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
