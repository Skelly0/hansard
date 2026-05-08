import { pgTable, uuid, varchar, text, integer, boolean, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { players } from './players';

// === FAVOUR CATEGORIES ===
// Political groups of interest that players can accumulate favours with.
// Staff create these per season -- e.g. "Military Establishment", "Merchant Guild",
// "Church", "Provincial Landowners", "Urban Workers", etc.
export const favourCategories = pgTable('favour_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  shortName: varchar('short_name', { length: 32 }),
  description: text('description'),
  emoji: varchar('emoji', { length: 8 }),         // for Discord embeds
  colour: varchar('colour', { length: 7 }),        // hex colour

  // What can favours with this group be spent on? (descriptive, not enforced by bot)
  spendableOn: jsonb('spendable_on').$type<string[]>(),
  // e.g. ['military appointments', 'trade deals', 'intelligence']

  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// === PLAYER FAVOUR BALANCES ===
// Current balance per player per category. Denormalised for fast reads.
export const favourBalances = pgTable('favour_balances', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  categoryId: uuid('category_id').references(() => favourCategories.id).notNull(),
  balance: integer('balance').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => ({
  playerCategoryUnique: uniqueIndex('favour_balances_player_category_unique').on(table.playerId, table.categoryId),
}));

// === FAVOUR TRANSACTION LOG ===
// Every grant, spend, and removal is logged.
export const favourTransactions = pgTable('favour_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  categoryId: uuid('category_id').references(() => favourCategories.id).notNull(),

  amount: integer('amount').notNull(),              // positive = grant, negative = spend/remove
  balanceAfter: integer('balance_after').notNull(),  // running balance after this transaction

  type: varchar('type', { length: 32 }).notNull(),
  // 'grant'   -- staff gives favours to player
  // 'spend'   -- player spends favours (staff processes)
  // 'remove'  -- staff removes favours (penalty, correction, etc.)
  // 'transfer' -- player-to-player transfer (if allowed, future)
  // 'system'  -- automatic grant/removal (e.g. from time advance events, future)

  reason: varchar('reason', { length: 512 }),        // why this transaction happened

  // Who initiated it
  grantedById: uuid('granted_by_id').references(() => players.id),  // staff member, or null for system

  // Context
  simTick: integer('sim_tick'),
  simDate: varchar('sim_date', { length: 32 }),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});
