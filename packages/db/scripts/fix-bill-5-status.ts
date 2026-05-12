/**
 * One-shot data fix: mark Bill #B-005 (Public Safety Ordinance) as
 * `player_passed` so it can be enacted via `/bill-enact`.
 *
 * Context: B-005 went through three amendment votes (custom type, no
 * relatedBillId) but never had a `legislative_vote` created against it,
 * so the bill stayed in `submitted` with `playerVoteId = null`. The
 * staff treat the amendments as the bill's passage and want to enact
 * it without forcing a 24h passage vote now.
 *
 * Run with --dry-run to print the planned SQL without executing.
 */
import { existsSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

const dryRun = process.argv.includes('--dry-run');
const BILL_NUMBER = 5;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    const [bill] = await sql<{
      id: string;
      title: string;
      status: string;
      author_id: string;
    }[]>`
      SELECT id, title, status, author_id
      FROM bills
      WHERE bill_number = ${BILL_NUMBER}
      LIMIT 1
    `;

    if (!bill) {
      console.error(`Bill #B-${String(BILL_NUMBER).padStart(3, '0')} not found.`);
      process.exit(1);
    }

    if (bill.status === 'player_passed' || bill.status === 'npc_passed') {
      console.log(`Bill "${bill.title}" already in status ${bill.status}; no change.`);
      return;
    }

    if (bill.status === 'enacted' || bill.status === 'active') {
      console.log(`Bill "${bill.title}" already ${bill.status}; no change.`);
      return;
    }

    const fromStatus = bill.status;

    if (dryRun) {
      console.log('--- DRY RUN ---');
      console.log(`Would update bill ${bill.id} ("${bill.title}") from ${fromStatus} -> player_passed`);
      console.log(`Would insert bill_status_log row attributing change to author ${bill.author_id}`);
      return;
    }

    await sql.begin(async (tx) => {
      await tx`
        UPDATE bills
        SET
          status = 'player_passed',
          player_vote_result = 'passed',
          player_vote_at = NOW(),
          npc_vote_required = FALSE,
          npc_vote = NULL,
          updated_at = NOW()
        WHERE id = ${bill.id}
      `;

      await tx`
        INSERT INTO bill_status_log (bill_id, from_status, to_status, changed_by_id, notes)
        VALUES (
          ${bill.id},
          ${fromStatus},
          'player_passed',
          ${bill.author_id},
          'Manual fix: bill treated as passed after amendment votes; no legislative_vote was created.'
        )
      `;
    });

    console.log(`Bill "${bill.title}" moved from ${fromStatus} -> player_passed.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
