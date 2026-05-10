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
});
