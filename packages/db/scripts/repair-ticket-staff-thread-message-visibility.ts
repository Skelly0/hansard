#!/usr/bin/env tsx
/**
 * Repairs ticket-thread messages imported from raw Discord thread traffic before
 * those messages were classified as internal by source.
 *
 * By policy, normal messages typed directly in the private ticket thread are
 * staff-thread records. Explicit public replies use `/ticket reply` or the web
 * reply form and do not carry a human Discord message id.
 *
 *   --dry-run   Print how many rows would be repaired, then exit.
 *   --validate  Assert there are no remaining public Discord-origin ticket
 *               messages.
 */
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const isValidate = process.argv.includes('--validate');

const CANDIDATE_COUNT_SQL = `
  SELECT COUNT(*)::int AS count
  FROM ticket_messages tm
  WHERE tm.discord_message_id IS NOT NULL
    AND tm.is_internal = false;
`;

const REPAIR_MESSAGES_SQL = `
  UPDATE ticket_messages tm
  SET is_internal = true
  WHERE tm.discord_message_id IS NOT NULL
    AND tm.is_internal = false;
`;

const REPAIR_AUDIT_SQL = `
  UPDATE ticket_audit_log tal
  SET action = 'internal_note'
  FROM ticket_messages tm
  WHERE tal.action = 'commented'
    AND tal.new_value ->> 'messageId' = tm.id::text
    AND tm.discord_message_id IS NOT NULL
    AND tm.is_internal = true;
`;

const RECALCULATE_FIRST_RESPONSE_SQL = `
  WITH public_responses AS (
    SELECT
      t.id AS ticket_id,
      MIN(tm.created_at) AS first_response_at
    FROM tickets t
    LEFT JOIN ticket_messages tm
      ON tm.ticket_id = t.id
      AND tm.is_internal = false
      AND tm.author_id <> t.created_by_id
    GROUP BY t.id
  )
  UPDATE tickets t
  SET first_response_at = public_responses.first_response_at
  FROM public_responses
  WHERE t.id = public_responses.ticket_id;
`;

const VALIDATE_SQL = CANDIDATE_COUNT_SQL;

async function countCandidates(sql: postgres.Sql): Promise<number> {
  const [row] = await sql.unsafe<{ count: number }[]>(CANDIDATE_COUNT_SQL);
  return row?.count ?? 0;
}

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    const candidateCount = await countCandidates(sql);

    if (isDryRun) {
      console.log(`[dry-run] would repair ${candidateCount} Discord-origin public ticket message(s).`);
      console.log(REPAIR_MESSAGES_SQL.trim());
      console.log(REPAIR_AUDIT_SQL.trim());
      console.log(RECALCULATE_FIRST_RESPONSE_SQL.trim());
      return;
    }

    if (!isValidate) {
      console.log(`Repairing ${candidateCount} Discord-origin public ticket message(s).`);
      await sql.begin(async (tx) => {
        await tx.unsafe(REPAIR_MESSAGES_SQL);
        await tx.unsafe(REPAIR_AUDIT_SQL);
        await tx.unsafe(RECALCULATE_FIRST_RESPONSE_SQL);
      });
      console.log('Done.');
    }

    if (isValidate || !isDryRun) {
      const [row] = await sql.unsafe<{ count: number }[]>(VALIDATE_SQL);
      const remaining = row?.count ?? 0;
      if (remaining > 0) {
        console.error(`Validation FAILED: ${remaining} Discord-origin public ticket message(s) remain.`);
        process.exit(2);
      }
      console.log('Validation OK: no Discord-origin public ticket messages remain.');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
