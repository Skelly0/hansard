import { pgTable, uuid, varchar, text, integer, boolean, timestamp, serial, jsonb, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { players } from './players';

export const ticketCategories = pgTable('ticket_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  emoji: varchar('emoji', { length: 8 }),
  colour: varchar('colour', { length: 7 }),

  // Which staff roles can see/handle this category
  assignableRoles: jsonb('assignable_roles').$type<string[]>().default([]),

  // Custom status pipeline for this category
  // If null, uses the default pipeline
  customPipeline: jsonb('custom_pipeline').$type<{
    statuses: { key: string; label: string; colour: string }[];
    transitions: Record<string, string[]>;  // which statuses can transition to which
  }>(),

  // Template fields players must fill out
  formTemplate: jsonb('form_template').$type<{
    fields: {
      key: string;
      label: string;
      type: 'text' | 'textarea' | 'select' | 'number' | 'date';
      required: boolean;
      options?: string[];  // for select type
      placeholder?: string;
    }[];
  }>(),

  sortOrder: integer('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: serial('number'),  // human-readable ticket number: #001, #002, etc.

  categoryId: uuid('category_id').references(() => ticketCategories.id).notNull(),

  // Who
  createdById: uuid('created_by_id').references(() => players.id).notNull(),
  assignedToId: uuid('assigned_to_id').references(() => players.id),

  // What
  title: varchar('title', { length: 256 }).notNull(),
  description: text('description').notNull(),
  formData: jsonb('form_data'),  // filled-in template fields

  // Status
  status: varchar('status', { length: 32 }).default('open').notNull(),
  priority: varchar('priority', { length: 16 }).default('normal').notNull(),  // low, normal, high, urgent

  // Relationships
  parentTicketId: uuid('parent_ticket_id').references((): AnyPgColumn => tickets.id, { onDelete: 'set null' }),
  linkedTicketIds: jsonb('linked_ticket_ids').$type<string[]>().default([]),

  // Discord
  discordChannelId: varchar('discord_channel_id', { length: 20 }),
  discordThreadId: varchar('discord_thread_id', { length: 20 }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull().$onUpdate(() => new Date()),
  firstResponseAt: timestamp('first_response_at', { withTimezone: true, mode: 'date' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),

  // Tags for filtering
  tags: jsonb('tags').$type<string[]>().default([]),
});

export const ticketMessages = pgTable('ticket_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').references(() => tickets.id).notNull(),
  authorId: uuid('author_id').references(() => players.id).notNull(),

  content: text('content').notNull(),
  isInternal: boolean('is_internal').default(false).notNull(),  // staff-only notes

  // If synced from Discord
  discordMessageId: varchar('discord_message_id', { length: 20 }),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }),
}, (table) => ({
  discordMessageUnique: uniqueIndex('ticket_messages_discord_message_unique')
    .on(table.ticketId, table.discordMessageId)
    .where(sql`discord_message_id IS NOT NULL`),
}));

export const ticketAuditLog = pgTable('ticket_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').references(() => tickets.id).notNull(),
  actorId: uuid('actor_id').references(() => players.id).notNull(),

  action: varchar('action', { length: 64 }).notNull(),
  // e.g. 'created', 'assigned', 'status_changed', 'priority_changed', 'commented', 'closed'

  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});
