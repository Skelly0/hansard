/**
 * One-shot cleanup for player rows leaked by
 * packages/bot/scripts/backfillPhoneThreads.test.ts before that test suite
 * marked and removed its own fixtures.
 *
 * Default mode is dry-run. Pass --confirm to delete the listed candidate rows.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

const confirm = process.argv.includes('--confirm');
const BACKFILL_FIXTURE_BASE_PATTERN = '(P[345][AB]|[AB]([1-9]|1[0-4]|10_[0-4]))';
const BACKFILL_FIXTURE_USERNAME_PATTERN = `^${BACKFILL_FIXTURE_BASE_PATTERN}$`;
const BACKFILL_FIXTURE_CHARACTER_NAME_PATTERN = `^${BACKFILL_FIXTURE_BASE_PATTERN}-[0-9]+-[0-9a-z]+-[0-9]+$`;
const BACKUP_DIR = process.env.DB_BACKUP_DIR ?? 'db-backups';

type CandidatePlayer = {
  id: string;
  discord_username: string;
  character_name: string;
  registered_at: Date;
};

function backupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function createDatabaseBackup(url: string): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = join(BACKUP_DIR, `pre-backfill-phone-fixture-cleanup-${backupTimestamp()}.dump`);
  const result = spawnSync('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    backupPath,
    '--dbname',
    url,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr || result.stdout || 'pg_dump failed without output';
    throw new Error(`Database backup failed; aborting cleanup.\n${detail}`);
  }

  return backupPath;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    const candidates = await sql<CandidatePlayer[]>`
      SELECT id, discord_username, character_name, registered_at
      FROM players
      WHERE discord_username ~ ${BACKFILL_FIXTURE_USERNAME_PATTERN}
        AND character_name ~ ${BACKFILL_FIXTURE_CHARACTER_NAME_PATTERN}
      ORDER BY registered_at DESC
    `;

    if (candidates.length === 0) {
      console.log('No leaked backfill phone test player rows found.');
      return;
    }

    console.log(`Found ${candidates.length} leaked backfill phone test player row(s):`);
    for (const row of candidates.slice(0, 100)) {
      console.log(`  ${row.id}  ${row.discord_username}  ${row.character_name}  ${row.registered_at.toISOString()}`);
    }
    if (candidates.length > 100) {
      console.log(`  ...and ${candidates.length - 100} more`);
    }

    if (!confirm) {
      console.log('\nDry run only. Re-run with --confirm to delete exactly these candidate rows and their phone fixture data.');
      return;
    }

    console.log(`\nCreating database backup in ${BACKUP_DIR} before deleting anything...`);
    const backupPath = createDatabaseBackup(url);
    console.log(`Backup created: ${backupPath}`);

    const ids = candidates.map((row) => row.id);

    await sql.begin(async (tx) => {
      const trx = tx as unknown as typeof sql;
      await trx`
        DELETE FROM phone_message_tap_deliveries
        WHERE message_id IN (
          SELECT pm.id
          FROM phone_messages pm
          INNER JOIN phone_calls pc ON pc.id = pm.call_id
          WHERE pc.caller_player_id = ANY(${ids}::uuid[])
             OR pc.recipient_player_id = ANY(${ids}::uuid[])
        )
        OR tap_id IN (
          SELECT pt.id
          FROM phone_taps pt
          LEFT JOIN phone_numbers pn ON pn.id = pt.target_number_id
          WHERE pn.player_id = ANY(${ids}::uuid[])
             OR pt.created_by_id = ANY(${ids}::uuid[])
             OR pt.revoked_by_id = ANY(${ids}::uuid[])
        )
      `;
      await trx`
        DELETE FROM phone_tap_audit_log
        WHERE actor_id = ANY(${ids}::uuid[])
           OR tap_id IN (
             SELECT pt.id
             FROM phone_taps pt
             LEFT JOIN phone_numbers pn ON pn.id = pt.target_number_id
             WHERE pn.player_id = ANY(${ids}::uuid[])
                OR pt.created_by_id = ANY(${ids}::uuid[])
                OR pt.revoked_by_id = ANY(${ids}::uuid[])
           )
      `;
      await trx`
        DELETE FROM phone_taps
        WHERE target_number_id IN (
          SELECT id FROM phone_numbers WHERE player_id = ANY(${ids}::uuid[])
        )
        OR created_by_id = ANY(${ids}::uuid[])
        OR revoked_by_id = ANY(${ids}::uuid[])
      `;
      await trx`
        DELETE FROM phone_threads
        WHERE player_a_id = ANY(${ids}::uuid[])
           OR player_b_id = ANY(${ids}::uuid[])
      `;
      await trx`
        DELETE FROM phone_messages
        WHERE call_id IN (
          SELECT id
          FROM phone_calls
          WHERE caller_player_id = ANY(${ids}::uuid[])
             OR recipient_player_id = ANY(${ids}::uuid[])
        )
      `;
      await trx`
        DELETE FROM phone_calls
        WHERE caller_player_id = ANY(${ids}::uuid[])
           OR recipient_player_id = ANY(${ids}::uuid[])
           OR force_ended_by_id = ANY(${ids}::uuid[])
           OR caller_number_id IN (
             SELECT id FROM phone_numbers WHERE player_id = ANY(${ids}::uuid[])
           )
           OR recipient_number_id IN (
             SELECT id FROM phone_numbers WHERE player_id = ANY(${ids}::uuid[])
           )
      `;
      await trx`
        DELETE FROM phone_numbers
        WHERE player_id = ANY(${ids}::uuid[])
      `;
      await trx`
        DELETE FROM player_event_log
        WHERE player_id = ANY(${ids}::uuid[])
           OR triggered_by_id = ANY(${ids}::uuid[])
      `;
      await trx`
        DELETE FROM players
        WHERE id = ANY(${ids}::uuid[])
      `;
    });

    console.log(`Deleted ${candidates.length} leaked backfill phone test player row(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
