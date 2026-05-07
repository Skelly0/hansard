import { pgTable, uuid, varchar, timestamp, integer, boolean } from 'drizzle-orm/pg-core';
import { players } from './players';

// === DEVICE-FLOW PAIRING CODES ===
// One row per in-flight `hansard-mcp login` attempt. Created when the CLI
// hits POST /api/auth/device/init; deleted (rotated into mcp_tokens) when the
// user approves it in the browser and the CLI polls successfully.
export const deviceCodes = pgTable('device_codes', {
  deviceCode: varchar('device_code', { length: 64 }).primaryKey(),
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
// Sliding 90-day TTL: last_used_at bumps on every /mcp/me call; expires_at
// is recomputed there. Revoked by /mcp/revoke or by the user via the webapp.
export const mcpTokens = pgTable('mcp_tokens', {
  token: varchar('token', { length: 64 }).primaryKey(),
  playerId: uuid('player_id').references(() => players.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  // Optional human-readable label so users can identify a token in a
  // future revocation UI (e.g. "Claude Desktop on laptop").
  label: varchar('label', { length: 128 }),
});
