import { existsSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

const dryRun = process.argv.includes('--dry-run');

const statements = [
  `ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "bill_type" varchar(32) NOT NULL DEFAULT 'google_doc';`,
  `ALTER TABLE "bills" ALTER COLUMN "google_doc_url" DROP NOT NULL;`,
];

async function main() {
  if (dryRun) {
    console.log('--- DRY RUN, would execute ---');
    for (const stmt of statements) {
      console.log(stmt);
    }
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    for (const stmt of statements) {
      console.log('Applying:', stmt);
      await sql.unsafe(stmt);
    }
    console.log('Done. bills now supports short text-only bills.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
