import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

describe('migrate-year-tick-unit script', () => {
  it('sets the tick_unit default and existing month clocks to year', () => {
    const script = readFileSync(join(here, 'migrate-year-tick-unit.ts'), 'utf8');

    expect(script).toContain('ALTER TABLE "simulation_clock" ALTER COLUMN "tick_unit" SET DEFAULT \'year\';');
    expect(script).toContain('UPDATE "simulation_clock" SET "tick_unit" = \'year\' WHERE "tick_unit" = \'month\';');
  });
});
