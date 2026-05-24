import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const EXCLUDED = new Set(['index.ts']);

function listSchemaFiles(): string[] {
  return readdirSync(here)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'))
    .filter((f) => !EXCLUDED.has(f))
    .map((f) => join(here, f));
}

describe('schema shape: timestamp columns', () => {
  it('every timestamp() column declares withTimezone:true', () => {
    const files = listSchemaFiles();
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    const re = /timestamp\(\s*['"](\w+)['"]/g;

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const colName = match[1];
        const window = text.slice(match.index, match.index + 200);
        if (!/withTimezone:\s*true/.test(window)) {
          violations.push(`${file}: timestamp('${colName}') missing withTimezone:true`);
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});

describe('schema shape: simulation clock', () => {
  it('defaults each tick to one year', () => {
    const text = readFileSync(join(here, 'simulation.ts'), 'utf8');

    expect(text).toContain("tickUnit: varchar('tick_unit', { length: 32 }).default('year').notNull()");
  });
});

describe('schema shape: ticket Discord message idempotency', () => {
  it('enforces one ticket message per Discord message id', () => {
    const text = readFileSync(join(here, 'tickets.ts'), 'utf8');

    expect(text).toContain("uniqueIndex('ticket_messages_discord_message_unique')");
    expect(text).toContain('.on(table.ticketId, table.discordMessageId)');
    expect(text).toContain("discord_message_id IS NOT NULL");
  });
});
