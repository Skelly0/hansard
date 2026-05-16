import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('migrate-phone-backfill-marker', () => {
  const source = readFileSync(
    path.join(__dirname, 'migrate-phone-backfill-marker.ts'),
    'utf-8',
  );

  it('wraps the migration in sql.begin', () => {
    expect(source).toMatch(/sql\.begin\(/);
  });

  it('uses ADD COLUMN IF NOT EXISTS for backfilled_at', () => {
    expect(source).toMatch(/ADD COLUMN IF NOT EXISTS\s+backfilled_at/i);
  });

  it('declares the column as TIMESTAMPTZ', () => {
    expect(source).toMatch(/backfilled_at\s+TIMESTAMPTZ/i);
  });

  it('does not mark the column NOT NULL', () => {
    // Match the ALTER line and ensure it has no NOT NULL clause.
    const alterLine = source.match(/ADD COLUMN IF NOT EXISTS\s+backfilled_at[^;]*/i);
    expect(alterLine).toBeTruthy();
    expect(alterLine![0]).not.toMatch(/NOT\s+NULL/i);
  });

  it('supports a --dry-run flag', () => {
    expect(source).toMatch(/--dry-run/);
  });

  it('supports a --validate flag', () => {
    expect(source).toMatch(/--validate/);
  });

  it('queries information_schema.columns during --validate', () => {
    expect(source).toMatch(/information_schema\.columns/i);
  });
});
