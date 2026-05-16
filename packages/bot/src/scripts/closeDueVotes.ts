import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import type { Database } from '@hansard/db';
import { closeDb } from '@hansard/db';
import { VoteService } from '@hansard/api/services/voteService';
import { db } from '../db.js';
import { closeDueVotes, listDueOpenVotes } from '../services/voteAutoClose.js';

type CloseDueVotesScriptLogger = Pick<Console, 'log' | 'error'>;

export interface RunCloseDueVotesScriptOptions {
  args?: string[];
  database?: Database;
  logger?: CloseDueVotesScriptLogger;
  closeDatabase?: (database: Database) => Promise<void>;
}

async function getReactionRenderer(args: Set<string>) {
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

export async function runCloseDueVotesScript(
  options: RunCloseDueVotesScriptOptions = {},
): Promise<void> {
  const args = new Set(options.args ?? process.argv.slice(2));
  const database = options.database ?? db;
  const logger = options.logger ?? console;
  const closeDatabase = options.closeDatabase ?? closeDb;
  let renderer: Awaited<ReturnType<typeof getReactionRenderer>> | undefined;

  try {
    if (args.has('--dry-run')) {
      const dueVotes = await listDueOpenVotes(database);
      if (dueVotes.length === 0) {
        logger.log('No overdue open votes found.');
        return;
      }

      logger.log(`Would close ${dueVotes.length} overdue open vote(s):`);
      for (const vote of dueVotes) {
        const closesAt = vote.votingClosesAt.toISOString();
        logger.log(`- ${vote.title} (${vote.id}) closed at ${closesAt}`);
      }
      return;
    }

    renderer = await getReactionRenderer(args);
    const voteService = new VoteService(database);
    const result = await closeDueVotes(database, {
      logger,
      renderReactionResult: renderer?.renderReactionResult,
      tallyElection: async (election) => {
        await voteService.tallyVotes(election.id);
      },
    });

    if (result.closed.length === 0) {
      logger.log('No overdue open votes found.');
    } else {
      logger.log(`Closed ${result.closed.length} overdue open vote(s):`);
      for (const vote of result.closed) {
        logger.log(`- ${vote.title} (${vote.id})`);
      }
    }

    if (result.renderFailed.length > 0) {
      logger.error(`Closed ${result.renderFailed.length} reaction vote(s) but failed to render Discord results:`);
      for (const vote of result.renderFailed) {
        logger.error(`- ${vote.title} (${vote.id}): ${vote.error}`);
      }
      process.exitCode = 1;
    }

    if (result.failed.length > 0) {
      logger.error(`Failed to close ${result.failed.length} overdue vote(s):`);
      for (const vote of result.failed) {
        logger.error(`- ${vote.title} (${vote.id}): ${vote.error}`);
      }
      process.exitCode = 1;
    }
  } finally {
    renderer?.destroy();
    await closeDatabase(database);
  }
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isDirectRun()) {
  runCloseDueVotesScript().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
