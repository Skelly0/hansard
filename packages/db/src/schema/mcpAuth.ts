import { pgTable, uuid, varchar, timestamp, integer, boolean, index } from 'drizzle-orm/pg-core';
import { players } from './players';

// === DEVICE-FLOW PAIRING CODES ===
// One row per in-flight `hansard-mcp login` attempt. Created when the CLI
// hits POST /api/auth/device/init; deleted (rotated into mcp_tokens) when the
// user approves it in the browser and the CLI polls successfully.
export const deviceCodes = pgTable('device_codes', {
  // Stored as a sha-256 hash of the device_code returned to the client. The
  // CLI keeps the plaintext; the DB only ever sees the hash. Defends against
  // a read-only DB leak revealing live device codes.
  deviceCodeHash: varchar('device_code_hash', { length: 64 }).primaryKey(),
  userCode: varchar('user_code', { length: 16 }).notNull().unique(),
  // Polling interval the CLI should use, in seconds.
  interval: integer('interval').default(5).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  // Set when the user approves in the browser. Null = pending.
  playerId: uuid('player_id').references(() => players.id),
  approved: boolean('approved').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === LONG-LIVED MCP TOKENS ===
// One row per active CLI session. Bearer-auth credential for /api/auth/mcp/*.
//
// Two expiries:
//  - expiresAt: sliding 90-day window, refreshed on every authenticated call
//    (last_used_at also bumped). Means inactive tokens lapse quickly.
//  - absoluteExpiresAt: hard cap (1 year from creation) regardless of use,
//    so even a constantly-used token eventually rotates.
//
// Tokens are stored as a sha-256 hash; only the CLI ever holds the plaintext.
export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    playerId: uuid('player_id').references(() => players.id).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at').notNull(),
    // Optional human-readable label so users can identify a token in a
    // future revocation UI (e.g. "Claude Desktop on laptop").
    label: varchar('label', { length: 128 }),
  },
  (table) => ({
    // Supports the future "list/revoke my tokens" view in the webapp.
    playerIdIdx: index('mcp_tokens_player_id_idx').on(table.playerId),
  }),
);
