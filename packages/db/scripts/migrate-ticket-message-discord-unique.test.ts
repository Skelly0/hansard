import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

describe('migrate-ticket-message-discord-unique script', () => {
  const script = readFileSync(join(here, 'migrate-ticket-message-discord-unique.ts'), 'utf8');

  it('creates the partial unique index for Discord-origin ticket messages', () => {
    expect(script).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ticket_messages_discord_message_unique"');
    expect(script).toContain('ON "ticket_messages" ("ticket_id", "discord_message_id")');
    expect(script).toContain('WHERE "discord_message_id" IS NOT NULL');
  });

  it('checks for pre-existing duplicates before creating the index', () => {
    expect(script).toContain('duplicate ticket Discord message ids found');
    expect(script).toContain('GROUP BY ticket_id, discord_message_id');
    expect(script).toContain('HAVING COUNT(*) > 1');
  });
});
