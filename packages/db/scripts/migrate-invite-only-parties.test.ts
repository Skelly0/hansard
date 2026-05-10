import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptDir = dirname(fileURLToPath(import.meta.url));

describe('migrate-invite-only-parties', () => {
  it('adds the invite-only flag required by party membership gates', () => {
    const script = readFileSync(join(scriptDir, 'migrate-invite-only-parties.ts'), 'utf8');

    expect(script).toContain('ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "is_invite_only"');
    expect(script).toContain('boolean NOT NULL DEFAULT false');
  });
});
