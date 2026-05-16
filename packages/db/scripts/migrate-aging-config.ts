import postgres from 'postgres';

process.loadEnvFile('../../.env');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // ADD COLUMN IF NOT EXISTS makes this idempotent — safe to re-run.
  const stmt = `ALTER TABLE "simulation_clock" ADD COLUMN IF NOT EXISTS "aging_config" JSONB;`;

  if (dryRun) {
    console.log('--- DRY RUN, would execute ---');
    console.log(stmt);
    await sql.end();
    return;
  }

  console.log('Applying:', stmt);
  await sql.unsafe(stmt);
  console.log('Done. simulation_clock.aging_config present (nullable, defaults handled in code).');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
