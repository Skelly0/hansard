import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

// We hold onto the underlying postgres client per-Database instance so that
// long-running consumers (the MCP server, the bot) can close the pool on
// SIGTERM/SIGINT. Without this, the pool leaks across restarts.
const clientByDb = new WeakMap<Database, Sql>();

export function createDb(connectionString: string): Database {
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });
  clientByDb.set(db, client);
  return db;
}

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Close the underlying connection pool for a Database created via createDb.
 * No-op if the db wasn't created here. Safe to await on shutdown.
 */
export async function closeDb(db: Database): Promise<void> {
  const client = clientByDb.get(db);
  if (!client) return;
  clientByDb.delete(db);
  await client.end({ timeout: 5 });
}

export * from './schema';

import type { players } from './schema/players';
export type Player = typeof players.$inferSelect;
