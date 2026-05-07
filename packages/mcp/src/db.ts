import { createDb, closeDb, type Database } from '@hansard/db';

let cached: Database | null = null;

export function getDb(connectionString: string): Database {
  if (cached) return cached;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required (set in env or in claude_desktop_config.json env block).');
  }
  cached = createDb(connectionString);
  return cached;
}

/**
 * Close the cached pool. Called from the shutdown handler in server.ts so
 * Claude Desktop restarts don't leak Postgres connections.
 */
export async function shutdownDb(): Promise<void> {
  if (!cached) return;
  const db = cached;
  cached = null;
  await closeDb(db);
}
