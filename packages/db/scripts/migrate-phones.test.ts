import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptDir = dirname(fileURLToPath(import.meta.url));

describe('migrate-phones', () => {
  const script = readFileSync(join(scriptDir, 'migrate-phones.ts'), 'utf8');

  it('creates all seven phone registry tables', () => {
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_numbers"');
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_calls"');
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_messages"');
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_threads"');
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_taps"');
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_tap_audit_log"');
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "phone_message_tap_deliveries"');
  });

  it('enforces one open call per player via partial unique indexes', () => {
    expect(script).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "phone_calls_one_open_caller"');
    expect(script).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "phone_calls_one_open_recipient"');
    expect(script).toMatch(/WHERE status IN \('ringing','active'\)/);
  });

  it('enforces phone_threads canonical ordering via CHECK and unique index', () => {
    expect(script).toContain('CHECK (player_a_id < player_b_id)');
    expect(script).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "phone_threads_pair_unique"');
  });

  it('constrains phone_numbers.number_normalized shape at the DB level', () => {
    // Uniqueness moved to a partial unique index (active rows only) — see next test.
    expect(script).toContain('"number_normalized" varchar(32) NOT NULL');
    expect(script).not.toContain('"number_normalized" varchar(32) NOT NULL UNIQUE');
    expect(script).toContain('phone_numbers_normalized_shape');
    expect(script).toContain("number_normalized ~ '^\\\\+?[0-9]{3,20}$'");
  });

  it('enforces uniqueness only on active phone numbers (retired digits can be re-registered)', () => {
    // A retired number must not block its own player — or anyone — from claiming it later.
    expect(script).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "phone_numbers_active_normalized_unique"');
    expect(script).toMatch(/ON "phone_numbers" \("number_normalized"\) WHERE is_active = true/);
  });

  it('drops any legacy column-level UNIQUE on phone_numbers.number_normalized', () => {
    // Migration must look up the auto-generated constraint name and drop it so the new
    // partial unique index can take over for upgraded deployments.
    expect(script).toContain('SELECT c.conname INTO uniq_name');
    expect(script).toContain("c.conrelid = '\"phone_numbers\"'::regclass");
    expect(script).toContain("ALTER TABLE \"phone_numbers\" DROP CONSTRAINT %I");
  });

  it('drops standalone legacy unique indexes on phone_numbers.number_normalized too', () => {
    // Some deployments used CREATE UNIQUE INDEX rather than a table constraint. Those
    // indexes also block retired-number reuse and must be removed before the partial index.
    expect(script).toContain('FROM pg_index i');
    expect(script).toContain('DROP INDEX IF EXISTS %I');
    expect(script).toContain('indpred IS NULL');
  });

  it('records the staff force-end actor on phone_calls', () => {
    // Audit column for `forceEndCall` — staff actor uuid must be queryable without parsing
    // `ended_reason`. Nullable: only set when staff force-ended the call.
    expect(script).toContain('ADD COLUMN IF NOT EXISTS "force_ended_by_id" uuid REFERENCES "players"("id")');
  });

  it('keeps the force_ended_by_id FK reference to players when adding the column', () => {
    // L13: the column must carry `REFERENCES "players"("id")` so the staff actor is a real
    // FK, not a loose uuid. Assert the full clause so a future contributor can't silently
    // drop the reference and leave the audit column danging.
    expect(script).toMatch(
      /ADD COLUMN IF NOT EXISTS "force_ended_by_id" uuid REFERENCES "players"\("id"\)/,
    );
  });

  it('casts ended_reason with USING when narrowing to varchar(80) so legacy rows do not abort', () => {
    // H6: an implicit ALTER COLUMN TYPE aborts if any existing row exceeds the new length.
    // Mirror the `error`-column ALTER which already uses substr(...).
    expect(script).toMatch(
      /ALTER COLUMN "ended_reason" TYPE varchar\(80\) USING substr\("ended_reason", 1, 80\)/,
    );
  });

  it('adds a monotonic sequence_no tiebreaker to phone_messages', () => {
    // H4: created_at is millisecond-resolution; transcript ordering needs a strict tiebreaker.
    expect(script).toContain('"sequence_no" bigserial NOT NULL');
    // Legacy deployments get it via an idempotent ADD COLUMN guarded on information_schema.
    expect(script).toContain('ALTER TABLE "phone_messages" ADD COLUMN "sequence_no" bigserial NOT NULL');
    expect(script).toContain("column_name = 'sequence_no'");
  });

  it('enforces at most one active tap per target number', () => {
    // H2: without this, two staff tapping the same number fan out every message N×.
    expect(script).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "phone_taps_active_target_unique"');
    expect(script).toMatch(/ON "phone_taps" \("target_number_id"\)\s*WHERE is_active = true/);
    // Legacy duplicate active taps must be retired before the unique index can be created.
    expect(script).toContain('UPDATE "phone_taps" t');
  });

  it('audits legacy duplicate active taps before retiring them', () => {
    expect(script).toMatch(
      /INSERT INTO "phone_tap_audit_log"[\s\S]*"phone_taps" t[\s\S]*"is_active" = true/,
    );
    expect(script).toContain('Duplicate active tap auto-revoked by migration');
  });

  it('enforces one DB row per Discord thread id', () => {
    // H5/L9: backstops the find/create/persist race so an orphaned thread is detectable.
    expect(script).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "phone_threads_discord_thread_unique"');
    expect(script).toMatch(/ON "phone_threads" \("discord_thread_id"\)/);
  });

  it('indexes ringing calls for the ring-timeout worker scan', () => {
    // L3: the worker filters `status='ringing' AND ring_expires_at <= now()`.
    expect(script).toContain('CREATE INDEX IF NOT EXISTS "phone_calls_ring_timeout_idx"');
    expect(script).toMatch(/ON "phone_calls" \("ring_expires_at"\)\s*WHERE status = 'ringing'/);
  });

  it('indexes phone_tap_audit_log by (tap_id, created_at) for staff history reads', () => {
    // L8: staff "history of this tap" inspections would otherwise seq-scan the audit table.
    expect(script).toContain('CREATE INDEX IF NOT EXISTS "phone_tap_audit_log_tap_created_idx"');
    expect(script).toMatch(/ON "phone_tap_audit_log" \("tap_id", "created_at"\)/);
  });

  it('partial-indexes pending tap deliveries for the crash-stranded sweep', () => {
    // The worker sweep scans `delivered_at IS NULL AND error IS NULL AND created_at < cutoff`.
    expect(script).toContain('CREATE INDEX IF NOT EXISTS "phone_message_tap_deliveries_pending_idx"');
    expect(script).toMatch(
      /ON "phone_message_tap_deliveries" \("created_at"\)\s*WHERE delivered_at IS NULL AND error IS NULL/,
    );
  });

  it('permits the number_deactivated audit action', () => {
    // M5: deactivating a number auto-revokes its taps with a `number_deactivated` audit row.
    expect(script).toContain('number_deactivated');
  });

  it('makes phone_tap_audit_log append-only via a BEFORE UPDATE OR DELETE trigger', () => {
    // M8: defense-in-depth for the rogue-staff threat model — even a compromised app role
    // cannot rewrite or erase audit history.
    expect(script).toContain('CREATE OR REPLACE FUNCTION "phone_tap_audit_log_immutable"()');
    expect(script).toContain('BEFORE UPDATE OR DELETE ON "phone_tap_audit_log"');
    expect(script).toContain('DROP TRIGGER IF EXISTS "phone_tap_audit_log_no_mutate"');
  });

  it('constrains phone_calls.status to the documented enum values', () => {
    expect(script).toContain('phone_calls_status_check');
    expect(script).toContain("status IN ('ringing','active','ended','declined','missed','cancelled')");
  });

  it('constrains phone_tap_audit_log.action to the documented enum values', () => {
    expect(script).toContain('phone_tap_audit_log_action_check');
    expect(script).toContain(
      "action IN ('created','revoked','orphaned_target_deactivated','number_deactivated')",
    );
  });

  it('cascades phone_messages on call deletion (transcript follows the call)', () => {
    expect(script).toMatch(/"call_id" uuid NOT NULL REFERENCES "phone_calls"\("id"\) ON DELETE CASCADE/);
  });

  it('cascades phone_message_tap_deliveries on message deletion', () => {
    expect(script).toMatch(/"message_id" uuid NOT NULL REFERENCES "phone_messages"\("id"\) ON DELETE CASCADE/);
  });

  it('restricts FK deletion on phone_taps + audit log + delivery tap references', () => {
    // We never want a tap row to vanish silently — that would orphan the audit chain.
    expect(script).toMatch(/"target_number_id" uuid NOT NULL REFERENCES "phone_numbers"\("id"\) ON DELETE RESTRICT/);
    expect(script).toMatch(/"tap_id" uuid NOT NULL REFERENCES "phone_taps"\("id"\) ON DELETE RESTRICT/);
  });

  it('denormalizes tap configuration into phone_tap_audit_log', () => {
    // Audit rows must survive partial loss of phone_taps so "who got copies" stays answerable.
    expect(script).toMatch(/"target_number_id" uuid/);
    expect(script).toMatch(/"target_number_normalized" varchar\(32\)/);
    expect(script).toMatch(/"mirror_channel_id" varchar\(20\)/);
    expect(script).toMatch(/"mirror_discord_user_id" varchar\(20\)/);
    expect(script).toContain('ALTER TABLE "phone_tap_audit_log" ADD COLUMN IF NOT EXISTS "target_number_normalized"');
  });

  it('renames mirror_user_id to mirror_discord_user_id idempotently', () => {
    expect(script).toContain('RENAME COLUMN "mirror_user_id" TO "mirror_discord_user_id"');
  });

  it('indexes pending deliveries for the reconciliation worker', () => {
    expect(script).toContain('CREATE INDEX IF NOT EXISTS "phone_messages_pending_delivery_idx"');
    expect(script).toMatch(/WHERE recipient_discord_message_id IS NULL/);
  });

  it('timestamps tap deliveries so failure streaks can be ordered by recency', () => {
    expect(script).toContain('"created_at" timestamptz NOT NULL DEFAULT now()');
    expect(script).toContain('ALTER TABLE "phone_message_tap_deliveries" ADD COLUMN IF NOT EXISTS "created_at"');
    expect(script).toContain('CREATE INDEX IF NOT EXISTS "phone_message_tap_deliveries_tap_created_idx"');
    expect(script).toContain('ON "phone_message_tap_deliveries" ("tap_id", "created_at" DESC)');
  });

  it('indexes active calls for the stranded-call startup sweep', () => {
    expect(script).toContain('CREATE INDEX IF NOT EXISTS "phone_calls_active_started_idx"');
    expect(script).toMatch(/WHERE status = 'active'/);
  });

  it('adds CHECK constraints with NOT VALID so existing violators do not abort the migration', () => {
    // Every ADD CONSTRAINT … CHECK should use NOT VALID. Operators run VALIDATE separately
    // after cleaning up legacy rows.
    expect(script).toMatch(/ADD CONSTRAINT "phone_numbers_normalized_shape"[\s\S]*?NOT VALID/);
    expect(script).toMatch(/ADD CONSTRAINT "phone_calls_status_check"[\s\S]*?NOT VALID/);
    expect(script).toMatch(/ADD CONSTRAINT "phone_threads_ordered_pair"[\s\S]*?NOT VALID/);
    expect(script).toMatch(/ADD CONSTRAINT "phone_tap_audit_log_action_check"[\s\S]*?NOT VALID/);
  });

  it('implements the documented --validate path for NOT VALID constraints', () => {
    expect(script).toContain("const validate = process.argv.includes('--validate')");
    expect(script).toContain('ALTER TABLE "phone_numbers" VALIDATE CONSTRAINT "phone_numbers_normalized_shape"');
    expect(script).toContain('ALTER TABLE "phone_calls" VALIDATE CONSTRAINT "phone_calls_status_check"');
    expect(script).toContain('ALTER TABLE "phone_threads" VALIDATE CONSTRAINT "phone_threads_ordered_pair"');
    expect(script).toContain('ALTER TABLE "phone_tap_audit_log" VALIDATE CONSTRAINT "phone_tap_audit_log_action_check"');
  });

  it('wraps every statement in a single transaction via sql.begin', () => {
    expect(script).toContain('await sql.begin(async (tx)');
    expect(script).toContain('await tx.unsafe(stmt)');
  });

  it('asserts pgcrypto availability for gen_random_uuid on older Postgres versions', () => {
    expect(script).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  });

  it('renames mirror_user_id on phone_tap_audit_log too (not just phone_taps)', () => {
    // Both rename blocks must exist. Match each table independently.
    const renameRegions = script.match(/RENAME COLUMN "mirror_user_id" TO "mirror_discord_user_id"/g);
    expect(renameRegions).not.toBeNull();
    expect(renameRegions!.length).toBeGreaterThanOrEqual(2);
    expect(script).toContain("table_name = 'phone_tap_audit_log' AND column_name = 'mirror_user_id'");
  });

  it('handles the "both columns exist" rename case by copying then dropping', () => {
    // Service code reads mirrorDiscordUserId only; the migration must not leave both columns
    // alive with the legacy one holding the actual data.
    expect(script).toContain('UPDATE "phone_taps" SET "mirror_discord_user_id" = "mirror_user_id"');
    expect(script).toContain('ALTER TABLE "phone_taps" DROP COLUMN "mirror_user_id"');
    expect(script).toContain('UPDATE "phone_tap_audit_log" SET "mirror_discord_user_id"');
  });

  it('bounds phone_message_tap_deliveries.error to varchar(500) to cap audit growth', () => {
    expect(script).toMatch(/"error" varchar\(500\)/);
    // Also narrow legacy `text` columns to the same cap.
    expect(script).toMatch(/ALTER COLUMN "error" TYPE varchar\(500\)/);
  });

  it('provides a rollback path via --rollback --confirm', () => {
    expect(script).toContain("process.argv.includes('--rollback')");
    expect(script).toContain("process.argv.includes('--confirm')");
    expect(script).toMatch(/DROP TABLE IF EXISTS "phone_numbers" CASCADE/);
    expect(script).toMatch(/DROP TABLE IF EXISTS "phone_message_tap_deliveries" CASCADE/);
    expect(script).toMatch(/DROP FUNCTION IF EXISTS "phone_tap_audit_log_immutable"\(\)/);
  });

  it('scopes pg_constraint lookups by conrelid to avoid name collisions across tables', () => {
    expect(script).toMatch(/conrelid = '"phone_numbers"'::regclass/);
    expect(script).toMatch(/conrelid = '"phone_calls"'::regclass/);
    expect(script).toMatch(/conrelid = '"phone_threads"'::regclass/);
  });

  it('verifies the CHECK regex string matches valid numbers and rejects invalid ones (JS-level parity)', () => {
    // Mirrors the DB CHECK so a future contributor cannot accidentally diverge them.
    // The CHECK source string in the migration is exactly `^\+?[0-9]{3,20}$` once JS
    // template-literal escaping resolves.
    const re = new RegExp('^\\+?[0-9]{3,20}$');
    expect(re.test('911')).toBe(true);
    expect(re.test('+15550142')).toBe(true);
    expect(re.test('+44207946095812345')).toBe(true);
    expect(re.test('42')).toBe(false);          // 2 digits — below minimum
    expect(re.test('1'.repeat(21))).toBe(false); // over maximum
    expect(re.test('555\nDROP')).toBe(false);   // anchored both ends
    expect(re.test('5 55')).toBe(false);   // NBSP not a digit
  });

  it('uses idempotent CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS', () => {
    expect(script).not.toMatch(/CREATE TABLE "phone_/);
    expect(script).not.toMatch(/CREATE INDEX "phone_/);
    expect(script).not.toMatch(/CREATE UNIQUE INDEX "phone_/);
  });

  it('supports a dry-run flag', () => {
    expect(script).toContain("process.argv.includes('--dry-run')");
  });

  it('orders dependent tables after their referents', () => {
    const idx = (substr: string) => script.indexOf(substr);
    expect(idx('CREATE TABLE IF NOT EXISTS "phone_numbers"')).toBeLessThan(idx('CREATE TABLE IF NOT EXISTS "phone_calls"'));
    expect(idx('CREATE TABLE IF NOT EXISTS "phone_calls"')).toBeLessThan(idx('CREATE TABLE IF NOT EXISTS "phone_messages"'));
    expect(idx('CREATE TABLE IF NOT EXISTS "phone_numbers"')).toBeLessThan(idx('CREATE TABLE IF NOT EXISTS "phone_taps"'));
    expect(idx('CREATE TABLE IF NOT EXISTS "phone_taps"')).toBeLessThan(idx('CREATE TABLE IF NOT EXISTS "phone_tap_audit_log"'));
    expect(idx('CREATE TABLE IF NOT EXISTS "phone_messages"')).toBeLessThan(idx('CREATE TABLE IF NOT EXISTS "phone_message_tap_deliveries"'));
  });
});
