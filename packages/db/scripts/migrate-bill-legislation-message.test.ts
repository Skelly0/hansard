import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('migrate-bill-legislation-message', () => {
  const source = readFileSync(
    path.join(__dirname, 'migrate-bill-legislation-message.ts'),
    'utf-8',
  );

  it('wraps the migration in sql.begin', () => {
    expect(source).toMatch(/sql\.begin\(/);
  });

  it('uses ADD COLUMN IF NOT EXISTS for legislation_channel_id', () => {
    expect(source).toMatch(/ADD COLUMN IF NOT EXISTS\s+legislation_channel_id/i);
  });

  it('uses ADD COLUMN IF NOT EXISTS for legislation_message_id', () => {
    expect(source).toMatch(/ADD COLUMN IF NOT EXISTS\s+legislation_message_id/i);
  });

  it('declares both columns as VARCHAR(32) NULL', () => {
    expect(source).toMatch(/legislation_channel_id\s+VARCHAR\(32\)\s+NULL/i);
    expect(source).toMatch(/legislation_message_id\s+VARCHAR\(32\)\s+NULL/i);
  });

  it('does not mark either column NOT NULL', () => {
    const channel = source.match(/legislation_channel_id[^,;]*/i);
    const message = source.match(/legislation_message_id[^,;]*/i);
    expect(channel).toBeTruthy();
    expect(message).toBeTruthy();
    expect(channel![0]).not.toMatch(/NOT\s+NULL/i);
    expect(message![0]).not.toMatch(/NOT\s+NULL/i);
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
