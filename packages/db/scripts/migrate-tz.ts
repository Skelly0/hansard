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

  const [{ tz }] = await sql<{ tz: string }[]>`SELECT current_setting('TIMEZONE') AS tz`;
  console.log(`Postgres TimeZone setting: ${tz}`);
  if (!tz) throw new Error('Could not determine Postgres timezone');

  const cols = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
    ORDER BY table_name, column_name
  `;

  if (cols.length === 0) {
    console.log('No naive timestamp columns found. Nothing to do.');
    await sql.end();
    return;
  }

  console.log(`Found ${cols.length} naive timestamp columns:`);
  for (const c of cols) console.log(`  ${c.table_name}.${c.column_name}`);

  if (dryRun) {
    console.log('\n--- DRY RUN, would execute ---');
    for (const c of cols) {
      console.log(
        `ALTER TABLE "${c.table_name}" ALTER COLUMN "${c.column_name}" TYPE timestamptz USING "${c.column_name}" AT TIME ZONE '${tz}';`,
      );
    }
    await sql.end();
    return;
  }

  console.log('\nApplying conversions in a transaction...');
  await sql.begin(async (tx) => {
    for (const c of cols) {
      const stmt = `ALTER TABLE "${c.table_name}" ALTER COLUMN "${c.column_name}" TYPE timestamptz USING "${c.column_name}" AT TIME ZONE '${tz}'`;
      console.log(`  ${stmt}`);
      await tx.unsafe(stmt);
    }
  });

  const remaining = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
  `;
  console.log(`\nDone. Remaining naive timestamp columns: ${remaining[0].count}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
