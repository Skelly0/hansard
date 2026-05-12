import { existsSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

const dryRun = process.argv.includes('--dry-run');

const statements: string[] = [
  // === phone_numbers ===
  // CHECK constraint anchors the normalized format at the DB level. The regex matches
  // `PHONE_NUMBER_REGEX` from @hansard/shared/constants/phones.ts.
  `CREATE TABLE IF NOT EXISTS "phone_numbers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "player_id" uuid NOT NULL REFERENCES "players"("id"),
    "number_raw" varchar(32) NOT NULL,
    "number_normalized" varchar(32) NOT NULL UNIQUE,
    "label" varchar(64),
    "cached_character_name" varchar(128),
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "deactivated_at" timestamptz,
    CONSTRAINT "phone_numbers_normalized_shape" CHECK (number_normalized ~ '^\\+?[0-9]{3,20}$')
  );`,
  // Idempotent re-add of the CHECK in case the table predated this migration.
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phone_numbers_normalized_shape')
    THEN ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_normalized_shape"
      CHECK (number_normalized ~ '^\\+?[0-9]{3,20}$');
    END IF;
  END $$;`,
  `CREATE INDEX IF NOT EXISTS "phone_numbers_player_idx" ON "phone_numbers" ("player_id");`,

  // === phone_calls ===
  // CHECK constraint anchors the status enum at the DB level so a typo'd status string
  // is rejected by Postgres rather than slipping through to break reads.
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
    "ended_at" timestamptz,
    CONSTRAINT "phone_calls_status_check" CHECK (status IN ('ringing','active','ended','declined','missed','cancelled'))
  );`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phone_calls_status_check')
    THEN ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_status_check"
      CHECK (status IN ('ringing','active','ended','declined','missed','cancelled'));
    END IF;
  END $$;`,
  // Some prior deployments may have a varchar(64) ended_reason; widen idempotently.
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
  // Index for the reconciliation worker that retries pending deliveries.
  `CREATE INDEX IF NOT EXISTS "phone_messages_pending_delivery_idx"
    ON "phone_messages" ("created_at")
    WHERE recipient_discord_message_id IS NULL;`,

  // === phone_threads ===
  `CREATE TABLE IF NOT EXISTS "phone_threads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "player_a_id" uuid NOT NULL REFERENCES "players"("id"),
    "player_b_id" uuid NOT NULL REFERENCES "players"("id"),
    "discord_thread_id" varchar(20) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "phone_threads_ordered_pair" CHECK (player_a_id < player_b_id)
  );`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phone_threads_ordered_pair')
    THEN ALTER TABLE "phone_threads" ADD CONSTRAINT "phone_threads_ordered_pair"
      CHECK (player_a_id < player_b_id);
    END IF;
  END $$;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "phone_threads_pair_unique"
    ON "phone_threads" ("player_a_id", "player_b_id");`,

  // === phone_taps ===
  // ON DELETE RESTRICT on target_number_id: a tap blocks number hard-deletion (we expect
  // soft-delete via is_active). The audit log carries denormalized fields so we don't strictly
  // need the live row, but keeping it around is the safer default.
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
  // Rename mirror_user_id → mirror_discord_user_id if present from a prior deployment.
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_taps' AND column_name = 'mirror_user_id')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'phone_taps' AND column_name = 'mirror_discord_user_id')
    THEN ALTER TABLE "phone_taps" RENAME COLUMN "mirror_user_id" TO "mirror_discord_user_id";
    END IF;
  END $$;`,
  `CREATE INDEX IF NOT EXISTS "phone_taps_active_number_idx"
    ON "phone_taps" ("target_number_id")
    WHERE is_active = true;`,

  // === phone_tap_audit_log ===
  // Denormalized snapshot. The CHECK lists every action the service may emit.
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
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "phone_tap_audit_log_action_check" CHECK (action IN ('created','revoked','orphaned_target_deactivated'))
  );`,
  // Idempotent re-add for prior deployments that had this table without the denorm columns.
  `ALTER TABLE "phone_tap_audit_log" ADD COLUMN IF NOT EXISTS "target_number_id" uuid;`,
  `ALTER TABLE "phone_tap_audit_log" ADD COLUMN IF NOT EXISTS "target_number_normalized" varchar(32);`,
  `ALTER TABLE "phone_tap_audit_log" ADD COLUMN IF NOT EXISTS "mirror_channel_id" varchar(20);`,
  `ALTER TABLE "phone_tap_audit_log" ADD COLUMN IF NOT EXISTS "mirror_discord_user_id" varchar(20);`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phone_tap_audit_log_action_check')
    THEN ALTER TABLE "phone_tap_audit_log" ADD CONSTRAINT "phone_tap_audit_log_action_check"
      CHECK (action IN ('created','revoked','orphaned_target_deactivated'));
    END IF;
  END $$;`,

  // === phone_message_tap_deliveries ===
  `CREATE TABLE IF NOT EXISTS "phone_message_tap_deliveries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "message_id" uuid NOT NULL REFERENCES "phone_messages"("id") ON DELETE CASCADE,
    "tap_id" uuid NOT NULL REFERENCES "phone_taps"("id") ON DELETE RESTRICT,
    "mirror_message_id" varchar(20),
    "delivered_at" timestamptz,
    "error" text
  );`,
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
      console.log('Applying:', stmt.split('\n')[0]);
      await sql.unsafe(stmt);
    }
    console.log(`Done. Applied ${statements.length} statements. Phone registry tables present.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
