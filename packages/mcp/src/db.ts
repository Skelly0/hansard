import { createDb, type Database } from '@hansard/db';

let cached: Database | null = null;

export function getDb(connectionString: string): Database {
  if (cached) return cached;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required (set in env or in claude_desktop_config.json env block).');
  }
  cached = createDb(connectionString);
  return cached;
}
