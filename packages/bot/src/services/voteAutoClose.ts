import { and, asc, eq, lte } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { elections } from '@hansard/db';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_LIMIT = 50;

type ElectionRow = typeof elections.$inferSelect;

export type ClosedDueVote = {
  id: string;
  title: string;
};

export type FailedDueVote = {
  id: string;
  title: string;
  error: string;
};

export type CloseDueVotesResult = {
  closed: ClosedDueVote[];
  failed: FailedDueVote[];
  renderFailed: FailedDueVote[];
};

export type CloseDueVotesOptions = {
  now?: Date;
  limit?: number;
  renderReactionResult?: (election: ElectionRow) => Promise<void>;
  tallyElection?: (election: ElectionRow) => Promise<void>;
  logger?: Pick<Console, 'error'>;
};

export type ListDueOpenVotesOptions = {
  now?: Date;
  limit?: number;
};

export type VoteAutoCloseWorkerOptions = CloseDueVotesOptions & {
  intervalMs?: number;
  runImmediately?: boolean;
  logger?: Pick<Console, 'error' | 'log'>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveIntervalMs(value: unknown): number {
  if (typeof value !== 'string') return DEFAULT_INTERVAL_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
}

export async function closeDueVotes(
  db: Database,
  options: CloseDueVotesOptions = {},
): Promise<CloseDueVotesResult> {
  const now = options.now ?? new Date();
  const logger = options.logger ?? console;

  const dueVotes = await listDueOpenVotes(db, {
    now,
    limit: options.limit,
  });

  const closed: ClosedDueVote[] = [];
  const failed: FailedDueVote[] = [];
  const renderFailed: FailedDueVote[] = [];

  for (const election of dueVotes) {
    try {
      const [updated] = await db
        .update(elections)
        .set({ status: 'voting_closed', updatedAt: now })
        .where(and(
          eq(elections.id, election.id),
          eq(elections.status, 'voting_open'),
          lte(elections.votingClosesAt, now),
        ))
        .returning();

      if (!updated) continue;

      closed.push({ id: updated.id, title: updated.title });

      if (
        options.renderReactionResult
        && updated.useReactions
        && updated.discordMessageId
        && updated.discordChannelId
      ) {
        try {
          await options.renderReactionResult(updated);
        } catch (error) {
          const failure = { id: updated.id, title: updated.title, error: errorMessage(error) };
          renderFailed.push(failure);
          logger.error(`[vote-auto-close] closed ${updated.id} but failed to render Discord results:`, error);
        }
      }

      // Legislative votes: auto-tally so the linked bill transitions out of
      // `voting`. Without this, /bill-enact rejects bills whose votes closed.
      if (
        options.tallyElection
        && updated.type === 'legislative_vote'
        && updated.relatedBillId
      ) {
        try {
          await options.tallyElection(updated);
        } catch (error) {
          logger.error(`[vote-auto-close] closed ${updated.id} but failed to auto-tally:`, error);
        }
      }
    } catch (error) {
      failed.push({ id: election.id, title: election.title, error: errorMessage(error) });
      logger.error(`[vote-auto-close] failed to close ${election.id}:`, error);
    }
  }

  return { closed, failed, renderFailed };
}

export async function listDueOpenVotes(
  db: Database,
  options: ListDueOpenVotesOptions = {},
): Promise<ElectionRow[]> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, options.limit ?? DEFAULT_BATCH_LIMIT);

  return db
    .select()
    .from(elections)
    .where(and(
      eq(elections.status, 'voting_open'),
      lte(elections.votingClosesAt, now),
    ))
    .orderBy(asc(elections.votingClosesAt))
    .limit(limit);
}

export function startVoteAutoCloseWorker(
  db: Database,
  options: VoteAutoCloseWorkerOptions = {},
): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? resolveIntervalMs(process.env.VOTE_AUTO_CLOSE_INTERVAL_MS);
  const logger = options.logger ?? console;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await closeDueVotes(db, {
        ...options,
        now: new Date(),
        logger,
      });

      if (result.closed.length > 0) {
        logger.log(`[vote-auto-close] closed ${result.closed.length} overdue vote(s)`);
      }
      if (result.failed.length > 0) {
        logger.error(`[vote-auto-close] ${result.failed.length} overdue vote(s) failed to close`);
      }
      if (result.renderFailed.length > 0) {
        logger.error(`[vote-auto-close] ${result.renderFailed.length} closed reaction vote(s) failed to render`);
      }
    } catch (error) {
      logger.error('[vote-auto-close] worker tick failed:', error);
    } finally {
      running = false;
    }
  };

  if (options.runImmediately !== false) {
    void tick();
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  return timer;
}
