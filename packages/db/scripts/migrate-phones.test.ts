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
    // Both ringing and active must be in the predicate, otherwise a caller could spam-dial.
    expect(script).toMatch(/WHERE status IN \('ringing','active'\)/);
  });

  it('enforces phone_threads canonical ordering via CHECK and unique index', () => {
    expect(script).toContain('CHECK (player_a_id < player_b_id)');
    expect(script).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "phone_threads_pair_unique"');
  });

  it('uniquely indexes phone_numbers.number_normalized', () => {
    expect(script).toContain('"number_normalized" varchar(32) NOT NULL UNIQUE');
  });

  it('uses idempotent CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS', () => {
    // No bare CREATE TABLE without IF NOT EXISTS
    expect(script).not.toMatch(/CREATE TABLE "phone_/);
    expect(script).not.toMatch(/CREATE INDEX "phone_/);
    expect(script).not.toMatch(/CREATE UNIQUE INDEX "phone_/);
  });

  it('supports a dry-run flag', () => {
    expect(script).toContain("process.argv.includes('--dry-run')");
  });
});
