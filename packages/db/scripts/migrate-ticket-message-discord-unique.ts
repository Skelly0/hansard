import { existsSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

const dryRun = process.argv.includes('--dry-run');

const createIndexStatement = `CREATE UNIQUE INDEX IF NOT EXISTS "ticket_messages_discord_message_unique"
  ON "ticket_messages" ("ticket_id", "discord_message_id")
  WHERE "discord_message_id" IS NOT NULL;`;

async function main() {
  if (dryRun) {
    console.log('--- DRY RUN, would execute ---');
    console.log(createIndexStatement);
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    const duplicates = await sql<{
      ticket_id: string;
      discord_message_id: string;
      count: string;
    }[]>`
      SELECT ticket_id, discord_message_id, COUNT(*)::text AS count
      FROM ticket_messages
      WHERE discord_message_id IS NOT NULL
      GROUP BY ticket_id, discord_message_id
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, ticket_id, discord_message_id
      LIMIT 20
    `;

    if (duplicates.length > 0) {
      console.error('duplicate ticket Discord message ids found; resolve duplicates before creating ticket_messages_discord_message_unique');
      for (const row of duplicates) {
        console.error(`ticket_id=${row.ticket_id} discord_message_id=${row.discord_message_id} count=${row.count}`);
      }
      process.exit(1);
    }

    console.log('Applying:', createIndexStatement.split('\n')[0]);
    await sql.unsafe(createIndexStatement);
    console.log('Done. ticket_messages_discord_message_unique is present.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
