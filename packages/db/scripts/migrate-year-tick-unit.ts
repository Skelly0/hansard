import { existsSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

const dryRun = process.argv.includes('--dry-run');

const statements = [
  `ALTER TABLE "simulation_clock" ALTER COLUMN "tick_unit" SET DEFAULT 'year';`,
  `UPDATE "simulation_clock" SET "tick_unit" = 'year' WHERE "tick_unit" = 'month';`,
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
    console.log('Done. simulation_clock.tick_unit now defaults to year and legacy month clocks were updated.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
