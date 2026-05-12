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

  it('constrains phone_numbers.number_normalized at the DB level', () => {
    expect(script).toContain('"number_normalized" varchar(32) NOT NULL UNIQUE');
    expect(script).toContain('phone_numbers_normalized_shape');
    expect(script).toContain("number_normalized ~ '^\\\\+?[0-9]{3,20}$'");
  });

  it('constrains phone_calls.status to the documented enum values', () => {
    expect(script).toContain('phone_calls_status_check');
    expect(script).toContain("status IN ('ringing','active','ended','declined','missed','cancelled')");
  });

  it('constrains phone_tap_audit_log.action to the documented enum values', () => {
    expect(script).toContain('phone_tap_audit_log_action_check');
    expect(script).toContain("action IN ('created','revoked','orphaned_target_deactivated')");
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
