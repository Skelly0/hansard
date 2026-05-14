import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptDir = dirname(fileURLToPath(import.meta.url));

describe('migrate-sessions-table', () => {
  it('creates the sessions table backing @fastify/session', () => {
    const script = readFileSync(join(scriptDir, 'migrate-sessions-table.ts'), 'utf8');

    expect(script).toContain('CREATE TABLE IF NOT EXISTS "sessions"');
    expect(script).toContain('"sid" varchar(128) PRIMARY KEY NOT NULL');
    expect(script).toContain('"sess" jsonb NOT NULL');
    expect(script).toContain('"expires_at" timestamp with time zone NOT NULL');
    expect(script).toContain(
      'CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" ("expires_at")',
    );
  });
});
