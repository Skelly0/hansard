import { pgTable, uuid, varchar, integer, boolean, timestamp, text, jsonb } from 'drizzle-orm/pg-core';
import { players } from './players';

// The simulation clock tracks in-game time independently of real time.
// Staff advance time via /time advance command.
// Each tick can represent whatever unit the season uses (days, weeks, months, years).

export const simulationClock = pgTable('simulation_clock', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Current in-game date
  currentDate: varchar('current_date', { length: 32 }).notNull(),  // flexible format, e.g. "Year 4, Month 3" or "1923-06-15"
  currentTick: integer('current_tick').default(0).notNull(),         // monotonic counter

  // Configuration
  tickUnit: varchar('tick_unit', { length: 32 }).default('month').notNull(),  // 'day' | 'week' | 'month' | 'year'
  startDate: varchar('start_date', { length: 32 }).notNull(),

  // Season metadata
  seasonName: varchar('season_name', { length: 128 }).notNull(),
  isPaused: boolean('is_paused').default(false).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// Log of every time advancement -- what happened each tick
export const timeAdvanceLog = pgTable('time_advance_log', {
  id: uuid('id').primaryKey().defaultRandom(),

  fromTick: integer('from_tick').notNull(),
  toTick: integer('to_tick').notNull(),
  fromDate: varchar('from_date', { length: 32 }).notNull(),
  toDate: varchar('to_date', { length: 32 }).notNull(),

  advancedById: uuid('advanced_by_id').references(() => players.id).notNull(),

  // Summary of what happened during this tick
  summary: jsonb('summary').$type<{
    deaths: string[];           // player IDs who died
    ailments: string[];         // player IDs who got new ailments
    aged: number;               // how many players aged
    // TODO: economy changes, popsim shifts
  }>(),

  notes: text('notes'),         // staff can add context
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});
