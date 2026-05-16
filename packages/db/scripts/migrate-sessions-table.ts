import { existsSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

const dryRun = process.argv.includes('--dry-run');

// CREATE TABLE / INDEX IF NOT EXISTS makes this idempotent — safe to re-run.
// This backs @fastify/session; without it sessions live in process memory and
// every API restart logs every web user out.
const statements = [
  `CREATE TABLE IF NOT EXISTS "sessions" (
    "sid" varchar(128) PRIMARY KEY NOT NULL,
    "sess" jsonb NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" ("expires_at");`,
];

async function main() {
  if (dryRun) {
    console.log('--- DRY RUN, would execute ---');
    for (const stmt of statements) {
      console.log(stmt);
    }
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    for (const stmt of statements) {
      console.log('Applying:', stmt);
      await sql.unsafe(stmt);
    }
    console.log('Done. sessions table present — web sessions now survive API restarts.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
