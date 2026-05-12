import { existsSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

const dryRun = process.argv.includes('--dry-run');
const rollback = process.argv.includes('--rollback');

/**
 * Statements ordered so every FK target exists before its referent and so all CHECK
 * constraints are added with `NOT VALID` — this avoids a table-wide scan + AccessExclusiveLock
 * on production tables that may have pre-migration rows that violate the new shape.
 *
 * After the migration applies the `NOT VALID` constraints, the operator can run
 * `pnpm --filter @hansard/db migrate:phones -- --validate` (or hand-run
 * `ALTER TABLE ... VALIDATE CONSTRAINT ...`) once they've cleaned up offending rows.
 */
const statements: string[] = [
  // gen_random_uuid() is in core on PG13+, pgcrypto on older versions. Idempotent guard.
  `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,

  // === phone_numbers ===
  `CREATE TABLE IF NOT EXISTS "phone_numbers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "player_id" uuid NOT NULL REFERENCES "players"("id"),
    "number_raw" varchar(32) NOT NULL,
    "number_normalized" varchar(32) NOT NULL UNIQUE,
    "label" varchar(64),
    "cached_character_name" varchar(128),
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "deactivated_at" timestamptz
  );`,
  // CHECK added with NOT VALID so pre-existing violating rows don't abort the migration.
  // The CHECK still enforces on every future insert/update; legacy rows can be reconciled later.
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'phone_numbers_normalized_shape'
        AND conrelid = '"phone_numbers"'::regclass
    )
    THEN ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_normalized_shape"
      CHECK (number_normalized ~ '^\\+?[0-9]{3,20}$') NOT VALID;
    END IF;
  END $$;`,
  `CREATE INDEX IF NOT EXISTS "phone_numbers_player_idx" ON "phone_numbers" ("player_id");`,

  // === phone_calls ===
  `CREATE TABLE IF NOT EXISTS "phone_calls" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "caller_number_id" uuid NOT NULL REFERENCES "phone_numbers"("id"),
    "recipient_number_id" uuid NOT NULL REFERENCES "phone_numbers"("id"),
    "caller_player_id" uuid NOT NULL REFERENCES "players"("id"),
    "recipient_player_id" uuid NOT NULL REFERENCES "players"("id"),
    "status" varchar(16) NOT NULL DEFAULT 'ringing',
    "ended_reason" varchar(80),
    "ring_discord_message_id" varchar(20),
    "staff_thread_id" varchar(20),
    "ring_expires_at" timestamptz,
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "answered_at" timestamptz,
    "ended_at" timestamptz
  );`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'phone_calls_status_check'
        AND conrelid = '"phone_calls"'::regclass
    )
    THEN ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_status_check"
      CHECK (status IN ('ringing','active','ended','declined','missed','cancelled')) NOT VALID;
    END IF;
  END $$;`,
  `ALTER TABLE "phone_calls" ALTER COLUMN "ended_reason" TYPE varchar(80);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "phone_calls_one_open_caller"
    ON "phone_calls" ("caller_player_id")
    WHERE status IN ('ringing','active');`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "phone_calls_one_open_recipient"
    ON "phone_calls" ("recipient_player_id")
    WHERE status IN ('ringing','active');`,
  `CREATE INDEX IF NOT EXISTS "phone_calls_caller_history_idx"
    ON "phone_calls" ("caller_player_id", "started_at");`,
  `CREATE INDEX IF NOT EXISTS "phone_calls_recipient_history_idx"
    ON "phone_calls" ("recipient_player_id", "started_at");`,
  // Index for sweepStrandedActiveCalls — only scans active rows, ordered by started_at.
  `CREATE INDEX IF NOT EXISTS "phone_calls_active_started_idx"
    ON "phone_calls" ("started_at")
    WHERE status = 'active';`,

  // === phone_messages ===
  `CREATE TABLE IF NOT EXISTS "phone_messages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "call_id" uuid NOT NULL REFERENCES "phone_calls"("id") ON DELETE CASCADE,
    "sender_player_id" uuid NOT NULL REFERENCES "players"("id"),
    "content" text NOT NULL,
    "sender_discord_message_id" varchar(20),
    "recipient_discord_message_id" varchar(20),
    "staff_mirror_message_id" varchar(20),
    "created_at" timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS "phone_messages_call_idx"
    ON "phone_messages" ("call_id", "created_at");`,
  `CREATE INDEX IF NOT EXISTS "phone_messages_pending_delivery_idx"
    ON "phone_messages" ("created_at")
    WHERE recipient_discord_message_id IS NULL;`,

  // === phone_threads ===
  `CREATE TABLE IF NOT EXISTS "phone_threads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "player_a_id" uuid NOT NULL REFERENCES "players"("id"),
    "player_b_id" uuid NOT NULL REFERENCES "players"("id"),
    "discord_thread_id" varchar(20) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
  );`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'phone_threads_ordered_pair'
        AND conrelid = '"phone_threads"'::regclass
    )
    THEN ALTER TABLE "phone_threads" ADD CONSTRAINT "phone_threads_ordered_pair"
      CHECK (player_a_id < player_b_id) NOT VALID;
    END IF;
  END $$;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "phone_threads_pair_unique"
    ON "phone_threads" ("player_a_id", "player_b_id");`,

  // === phone_taps ===
  `CREATE TABLE IF NOT EXISTS "phone_taps" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_number_id" uuid NOT NULL REFERENCES "phone_numbers"("id") ON DELETE RESTRICT,
    "created_by_id" uuid NOT NULL REFERENCES "players"("id"),
    "mirror_channel_id" varchar(20),
    "mirror_discord_user_id" varchar(20),
    "reason" text,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "revoked_at" timestamptz,
    "revoked_by_id" uuid REFERENCES "players"("id")
  );`,
  // Rename mirror_user_id → mirror_discord_user_id on phone_taps, idempotent. Handles three
  // states: (a) only old column → rename; (b) both columns → copy then drop old; (c) only new
  // column → no-op.
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_taps' AND column_name = 'mirror_user_id')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_taps' AND column_name = 'mirror_discord_user_id')
    THEN ALTER TABLE "phone_taps" RENAME COLUMN "mirror_user_id" TO "mirror_discord_user_id";
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_taps' AND column_name = 'mirror_user_id')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_taps' AND column_name = 'mirror_discord_user_id')
    THEN
      UPDATE "phone_taps" SET "mirror_discord_user_id" = "mirror_user_id" WHERE "mirror_discord_user_id" IS NULL AND "mirror_user_id" IS NOT NULL;
      ALTER TABLE "phone_taps" DROP COLUMN "mirror_user_id";
    END IF;
  END $$;`,
  `CREATE INDEX IF NOT EXISTS "phone_taps_active_number_idx"
    ON "phone_taps" ("target_number_id")
    WHERE is_active = true;`,
  // Index supporting the tap circuit-breaker query (count recent errored deliveries).
  `CREATE INDEX IF NOT EXISTS "phone_taps_consecutive_failure_idx"
    ON "phone_taps" ("id")
    WHERE is_active = true;`,

  // === phone_tap_audit_log ===
  `CREATE TABLE IF NOT EXISTS "phone_tap_audit_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tap_id" uuid NOT NULL REFERENCES "phone_taps"("id") ON DELETE RESTRICT,
    "actor_id" uuid NOT NULL REFERENCES "players"("id"),
    "action" varchar(32) NOT NULL,
    "target_number_id" uuid,
    "target_number_normalized" varchar(32),
    "mirror_channel_id" varchar(20),
    "mirror_discord_user_id" varchar(20),
    "notes" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
  );`,
  `ALTER TABLE "phone_tap_audit_log" ADD COLUMN IF NOT EXISTS "target_number_id" uuid;`,
  `ALTER TABLE "phone_tap_audit_log" ADD COLUMN IF NOT EXISTS "target_number_normalized" varchar(32);`,
  `ALTER TABLE "phone_tap_audit_log" ADD COLUMN IF NOT EXISTS "mirror_channel_id" varchar(20);`,
  `ALTER TABLE "phone_tap_audit_log" ADD COLUMN IF NOT EXISTS "mirror_discord_user_id" varchar(20);`,
  // Parallel rename block for the audit table — same three states as phone_taps.
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_tap_audit_log' AND column_name = 'mirror_user_id')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_tap_audit_log' AND column_name = 'mirror_discord_user_id')
    THEN ALTER TABLE "phone_tap_audit_log" RENAME COLUMN "mirror_user_id" TO "mirror_discord_user_id";
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_tap_audit_log' AND column_name = 'mirror_user_id')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_tap_audit_log' AND column_name = 'mirror_discord_user_id')
    THEN
      UPDATE "phone_tap_audit_log" SET "mirror_discord_user_id" = "mirror_user_id" WHERE "mirror_discord_user_id" IS NULL AND "mirror_user_id" IS NOT NULL;
      ALTER TABLE "phone_tap_audit_log" DROP COLUMN "mirror_user_id";
    END IF;
  END $$;`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'phone_tap_audit_log_action_check'
        AND conrelid = '"phone_tap_audit_log"'::regclass
    )
    THEN ALTER TABLE "phone_tap_audit_log" ADD CONSTRAINT "phone_tap_audit_log_action_check"
      CHECK (action IN ('created','revoked','orphaned_target_deactivated')) NOT VALID;
    END IF;
  END $$;`,

  // === phone_message_tap_deliveries ===
  // `error` is bounded to varchar(500) — Discord stack traces can run multiple KB and we don't
  // need full traces for audit triage; the message is enough.
  `CREATE TABLE IF NOT EXISTS "phone_message_tap_deliveries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "message_id" uuid NOT NULL REFERENCES "phone_messages"("id") ON DELETE CASCADE,
    "tap_id" uuid NOT NULL REFERENCES "phone_taps"("id") ON DELETE RESTRICT,
    "mirror_message_id" varchar(20),
    "delivered_at" timestamptz,
    "error" varchar(500)
  );`,
  // For prior deployments where `error` was `text`, narrow it. Postgres allows a varchar(N)
  // narrowing if no row exceeds N — emit a USING expression that truncates safely.
  `ALTER TABLE "phone_message_tap_deliveries" ALTER COLUMN "error" TYPE varchar(500) USING substr("error", 1, 500);`,
];

const rollbackStatements: string[] = [
  // Reverse FK order: deliveries → audit_log → taps → threads → messages → calls → numbers.
  `DROP TABLE IF EXISTS "phone_message_tap_deliveries" CASCADE;`,
  `DROP TABLE IF EXISTS "phone_tap_audit_log" CASCADE;`,
  `DROP TABLE IF EXISTS "phone_taps" CASCADE;`,
  `DROP TABLE IF EXISTS "phone_threads" CASCADE;`,
  `DROP TABLE IF EXISTS "phone_messages" CASCADE;`,
  `DROP TABLE IF EXISTS "phone_calls" CASCADE;`,
  `DROP TABLE IF EXISTS "phone_numbers" CASCADE;`,
];

async function main() {
  const toRun = rollback ? rollbackStatements : statements;

  if (dryRun) {
    console.log(rollback ? '--- DRY RUN ROLLBACK ---' : '--- DRY RUN, would execute ---');
    for (const stmt of toRun) {
      console.log(stmt);
    }
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  if (rollback && !process.argv.includes('--confirm')) {
    console.error('Rollback requires --confirm to proceed. This DROPs every phone_* table CASCADE.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    // Wrap the whole migration in a single transaction so a partial failure rolls back. Every
    // statement is DDL on its own table or a DO $$ block; PG supports transactional DDL.
    await sql.begin(async (tx) => {
      for (const stmt of toRun) {
        console.log('Applying:', stmt.split('\n')[0]);
        await tx.unsafe(stmt);
      }
    });
    console.log(rollback
      ? `Done. Dropped ${toRun.length} phone tables.`
      : `Done. Applied ${toRun.length} statements. Phone registry tables present.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
