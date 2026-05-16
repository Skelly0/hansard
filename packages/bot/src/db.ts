import { createDb, type Database } from '@hansard/db';
import postgres, { type Sql } from 'postgres';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const db: Database = createDb(connectionString);

// Separately-constructed raw postgres-js client for callers that need session-level
// SQL primitives outside the Drizzle layer (advisory locks, LISTEN/NOTIFY, etc.).
// Lives in its own pool so it doesn't share session state with the Drizzle handle.
export const rawSql: Sql = postgres(connectionString);
