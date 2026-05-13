import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptDir = dirname(fileURLToPath(import.meta.url));

describe('migrate-aging-config', () => {
  it('adds the aging_config column required by simulation aging knobs', () => {
    const script = readFileSync(join(scriptDir, 'migrate-aging-config.ts'), 'utf8');

    expect(script).toContain('ALTER TABLE "simulation_clock"');
    expect(script).toContain('ADD COLUMN IF NOT EXISTS');
    expect(script).toContain('"aging_config"');
    expect(script).toContain('JSONB');
  });
});
