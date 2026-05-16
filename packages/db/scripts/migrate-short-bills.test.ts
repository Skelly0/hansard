import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptDir = dirname(fileURLToPath(import.meta.url));

describe('migrate-short-bills', () => {
  it('adds every bills column needed by short bill submissions', () => {
    const script = readFileSync(join(scriptDir, 'migrate-short-bills.ts'), 'utf8');

    expect(script).toContain('ALTER COLUMN "google_doc_url" DROP NOT NULL');
    for (const column of ['bill_type', 'google_doc_id', 'cached_content', 'cached_at']) {
      expect(script).toContain(`"${column}"`);
    }
  });

  it('backfills google_doc_id from existing google_doc_url values', () => {
    const script = readFileSync(join(scriptDir, 'migrate-short-bills.ts'), 'utf8');

    expect(script).toContain('UPDATE "bills"');
    expect(script).toContain('SET "google_doc_id" = substring("google_doc_url"');
    expect(script).toContain('WHERE "google_doc_id" IS NULL');
    expect(script).toContain('AND "google_doc_url" IS NOT NULL');
  });
});
