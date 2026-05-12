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
