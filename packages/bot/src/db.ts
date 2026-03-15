import { createDb, type Database } from '@hansard/db';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const db: Database = createDb(connectionString);
