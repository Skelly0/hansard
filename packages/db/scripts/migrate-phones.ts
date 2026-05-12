import { existsSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

const dryRun = process.argv.includes('--dry-run');

const statements: string[] = [
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
  `CREATE INDEX IF NOT EXISTS "phone_numbers_player_idx" ON "phone_numbers" ("player_id");`,

  // === phone_calls ===
  `CREATE TABLE IF NOT EXISTS "phone_calls" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "caller_number_id" uuid NOT NULL REFERENCES "phone_numbers"("id"),
    "recipient_number_id" uuid NOT NULL REFERENCES "phone_numbers"("id"),
    "caller_player_id" uuid NOT NULL REFERENCES "players"("id"),
    "recipient_player_id" uuid NOT NULL REFERENCES "players"("id"),
    "status" varchar(16) NOT NULL DEFAULT 'ringing',
    "ended_reason" varchar(64),
    "ring_discord_message_id" varchar(20),
    "staff_thread_id" varchar(20),
    "ring_expires_at" timestamptz,
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "answered_at" timestamptz,
    "ended_at" timestamptz
  );`,
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

  // === phone_threads ===
  // CHECK constraint enforces canonical ordering so the unique index works without
  // app-side sorting on every lookup.
  `CREATE TABLE IF NOT EXISTS "phone_threads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "player_a_id" uuid NOT NULL REFERENCES "players"("id"),
    "player_b_id" uuid NOT NULL REFERENCES "players"("id"),
    "discord_thread_id" varchar(20) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "phone_threads_ordered_pair" CHECK (player_a_id < player_b_id)
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "phone_threads_pair_unique"
    ON "phone_threads" ("player_a_id", "player_b_id");`,

  // === phone_taps ===
  `CREATE TABLE IF NOT EXISTS "phone_taps" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_number_id" uuid NOT NULL REFERENCES "phone_numbers"("id"),
    "created_by_id" uuid NOT NULL REFERENCES "players"("id"),
    "mirror_channel_id" varchar(20),
    "mirror_user_id" varchar(20),
    "reason" text,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "revoked_at" timestamptz,
    "revoked_by_id" uuid REFERENCES "players"("id")
  );`,
  `CREATE INDEX IF NOT EXISTS "phone_taps_active_number_idx"
    ON "phone_taps" ("target_number_id")
    WHERE is_active = true;`,

  // === phone_tap_audit_log ===
  `CREATE TABLE IF NOT EXISTS "phone_tap_audit_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tap_id" uuid NOT NULL REFERENCES "phone_taps"("id"),
    "actor_id" uuid NOT NULL REFERENCES "players"("id"),
    "action" varchar(32) NOT NULL,
    "notes" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
  );`,

  // === phone_message_tap_deliveries ===
  `CREATE TABLE IF NOT EXISTS "phone_message_tap_deliveries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "message_id" uuid NOT NULL REFERENCES "phone_messages"("id") ON DELETE CASCADE,
    "tap_id" uuid NOT NULL REFERENCES "phone_taps"("id"),
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
    console.log('Done. Phone registry tables present.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
