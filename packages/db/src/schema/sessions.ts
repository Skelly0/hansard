import { pgTable, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

// === WEB SESSIONS ===
// Backing store for @fastify/session. Without a persistent store the plugin
// keeps sessions in process memory, so every API restart/redeploy logs every
// web user out. One row per active browser session.
//
// `sid` is the raw (unsigned) session id @fastify/session generates — a
// 32-char base64url string; 128 leaves generous headroom. `sess` holds the
// serialized session object (cookie metadata + `session.user` etc.).
// `expiresAt` mirrors the session cookie's expiry so rows can be indexed for
// cleanup and treated as gone once lapsed.
export const sessions = pgTable(
  'sessions',
  {
    sid: varchar('sid', { length: 128 }).primaryKey(),
    sess: jsonb('sess').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => ({
    expiresAtIdx: index('sessions_expires_at_idx').on(table.expiresAt),
  }),
);
