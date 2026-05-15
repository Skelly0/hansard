#!/usr/bin/env tsx
/**
 * Adds the `phone_calls.backfilled_at` column used as the completion-idempotency
 * marker by `pnpm --filter @hansard/bot backfill:phone-threads`.
 *
 *   --dry-run   Print the SQL without executing.
 *   --validate  After applying (or as a standalone check), assert the column exists.
 *
 * Spec: docs/superpowers/specs/2026-05-15-phone-log-backfill-design.md
 */
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const isValidate = process.argv.includes('--validate');

const ALTER_SQL = `
  ALTER TABLE phone_calls
    ADD COLUMN IF NOT EXISTS backfilled_at TIMESTAMPTZ NULL;
`;

const VALIDATE_SQL = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'phone_calls' AND column_name = 'backfilled_at';
`;

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    if (isDryRun) {
      console.log('[dry-run] would execute:');
      console.log(ALTER_SQL.trim());
      return;
    }

    if (!isValidate) {
      console.log('Applying migration: phone_calls.backfilled_at');
      await sql.begin(async (tx) => {
        await tx.unsafe(ALTER_SQL);
      });
      console.log('Done.');
    }

    if (isValidate || !isDryRun) {
      const rows = await sql.unsafe<{ column_name: string; data_type: string; is_nullable: string }[]>(
        VALIDATE_SQL,
      );
      if (rows.length === 0) {
        console.error('Validation FAILED: backfilled_at column not found on phone_calls.');
        process.exit(2);
      }
      const row = rows[0];
      const ok = row.data_type === 'timestamp with time zone' && row.is_nullable === 'YES';
      if (!ok) {
        console.error(
          `Validation FAILED: column exists but shape is unexpected: data_type=${row.data_type}, is_nullable=${row.is_nullable}`,
        );
        process.exit(3);
      }
      console.log('Validation OK: phone_calls.backfilled_at TIMESTAMPTZ NULL exists.');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
