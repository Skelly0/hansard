import 'dotenv/config';

import { closeDb } from '@hansard/db';
import { db } from '../db.js';
import { closeDueVotes, listDueOpenVotes } from '../services/voteAutoClose.js';

const args = new Set(process.argv.slice(2));

async function getReactionRenderer() {
  if (!args.has('--render-discord')) return undefined;

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is required when using --render-discord');
  }

  const [{ Events }, { client }, { renderReactionResult }] = await Promise.all([
    import('discord.js'),
    import('../client.js'),
    import('../commands/vote/close.js'),
  ]);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for Discord client readiness'));
    }, 30_000);

    client.once(Events.ClientReady, () => {
      clearTimeout(timeout);
      resolve();
    });

    client.login(token).catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  return {
    renderReactionResult,
    destroy: () => client.destroy(),
  };
}

async function main() {
  if (args.has('--dry-run')) {
    const dueVotes = await listDueOpenVotes(db);
    if (dueVotes.length === 0) {
      console.log('No overdue open votes found.');
      return;
    }

    console.log(`Would close ${dueVotes.length} overdue open vote(s):`);
    for (const vote of dueVotes) {
      const closesAt = vote.votingClosesAt.toISOString();
      console.log(`- ${vote.title} (${vote.id}) closed at ${closesAt}`);
    }
    return;
  }

  const renderer = await getReactionRenderer();
  try {
    const result = await closeDueVotes(db, {
      logger: console,
      renderReactionResult: renderer?.renderReactionResult,
    });

    if (result.closed.length === 0) {
      console.log('No overdue open votes found.');
    } else {
      console.log(`Closed ${result.closed.length} overdue open vote(s):`);
      for (const vote of result.closed) {
        console.log(`- ${vote.title} (${vote.id})`);
      }
    }

    if (result.renderFailed.length > 0) {
      console.error(`Closed ${result.renderFailed.length} reaction vote(s) but failed to render Discord results:`);
      for (const vote of result.renderFailed) {
        console.error(`- ${vote.title} (${vote.id}): ${vote.error}`);
      }
      process.exitCode = 1;
    }

    if (result.failed.length > 0) {
      console.error(`Failed to close ${result.failed.length} overdue vote(s):`);
      for (const vote of result.failed) {
        console.error(`- ${vote.title} (${vote.id}): ${vote.error}`);
      }
      process.exitCode = 1;
    }
  } finally {
    renderer?.destroy();
  }
}

try {
  await main();
} finally {
  await closeDb(db);
}
