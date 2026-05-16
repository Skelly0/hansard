#!/usr/bin/env tsx
/**
 * Adds the `bills.legislation_channel_id` and `bills.legislation_message_id`
 * columns used by `/bill enact` to remember its public legislation post so
 * `/bill repeal` can edit the original embed in place.
 *
 *   --dry-run   Print the SQL without executing.
 *   --validate  After applying (or as a standalone check), assert both columns exist.
 *
 * Both columns are nullable: pre-migration enacted bills will not have a
 * stored message ID, and the repeal flow falls back to posting a fresh notice
 * in that case.
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
  ALTER TABLE bills
    ADD COLUMN IF NOT EXISTS legislation_channel_id VARCHAR(32) NULL,
    ADD COLUMN IF NOT EXISTS legislation_message_id VARCHAR(32) NULL;
`;

const VALIDATE_SQL = `
  SELECT column_name, data_type, is_nullable, character_maximum_length
  FROM information_schema.columns
  WHERE table_name = 'bills'
    AND column_name IN ('legislation_channel_id', 'legislation_message_id')
  ORDER BY column_name;
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
      console.log('Applying migration: bills.legislation_channel_id + legislation_message_id');
      await sql.begin(async (tx) => {
        await tx.unsafe(ALTER_SQL);
      });
      console.log('Done.');
    }

    if (isValidate || !isDryRun) {
      const rows = await sql.unsafe<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        character_maximum_length: number | null;
      }[]>(VALIDATE_SQL);
      const expected = new Set(['legislation_channel_id', 'legislation_message_id']);
      const found = new Set(rows.map((r) => r.column_name));
      const missing = [...expected].filter((c) => !found.has(c));
      if (missing.length > 0) {
        console.error(`Validation FAILED: missing column(s) on bills: ${missing.join(', ')}`);
        process.exit(2);
      }
      for (const row of rows) {
        const ok =
          row.data_type === 'character varying' &&
          row.is_nullable === 'YES' &&
          row.character_maximum_length === 32;
        if (!ok) {
          console.error(
            `Validation FAILED: ${row.column_name} shape unexpected: data_type=${row.data_type}, is_nullable=${row.is_nullable}, max_length=${row.character_maximum_length}`,
          );
          process.exit(3);
        }
      }
      console.log('Validation OK: bills.legislation_channel_id + legislation_message_id VARCHAR(32) NULL exist.');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
