import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

describe('repair-ticket-staff-thread-message-visibility script', () => {
  const script = readFileSync(join(here, 'repair-ticket-staff-thread-message-visibility.ts'), 'utf8');

  it('targets Discord-origin public ticket messages', () => {
    expect(script).toContain('tm.discord_message_id IS NOT NULL');
    expect(script).toContain('tm.is_internal = false');
  });

  it('marks repaired ticket messages internal and updates matching audit rows', () => {
    expect(script).toContain('SET is_internal = true');
    expect(script).toContain("SET action = 'internal_note'");
    expect(script).toContain("tal.action = 'commented'");
    expect(script).toContain("tal.new_value ->> 'messageId'");
  });

  it('recalculates every first_response_at from remaining public non-creator messages', () => {
    expect(script).toContain('MIN(tm.created_at)');
    expect(script).toContain('tm.is_internal = false');
    expect(script).toContain('tm.author_id <> t.created_by_id');
    expect(script).toContain('SET first_response_at = public_responses.first_response_at');
    expect(script).toContain('FROM tickets t');
  });

  it('supports dry-run and validation modes', () => {
    expect(script).toContain('--dry-run');
    expect(script).toContain('--validate');
    expect(script).toContain('VALIDATE_SQL');
  });
});
