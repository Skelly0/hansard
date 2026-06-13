import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { Database } from '@hansard/db';
import { elections } from '@hansard/db';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_IDLE_INTERVAL_MS = 6 * 60 * 60 * 1000;
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
  idleIntervalMs?: number;
  runImmediately?: boolean;
  logger?: Pick<Console, 'error' | 'log'>;
};

export type VoteAutoCloseWorkerHandle = {
  stop: () => void;
  wake: (reason?: string) => boolean;
  unref: () => void;
};

let currentWorker: VoteAutoCloseWorkerHandle | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveIntervalMs(value: unknown): number {
  if (typeof value !== 'string') return DEFAULT_INTERVAL_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
}

function resolvePositiveMs(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function wakeVoteAutoCloseWorker(reason?: string): boolean {
  return currentWorker?.wake(reason) ?? false;
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
      // `voting`. Without this, /bill enact rejects bills whose votes closed.
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

export async function findNextOpenVoteCloseAt(
  db: Database,
  options: { now?: Date } = {},
): Promise<Date | null> {
  const now = options.now ?? new Date();
  const [next] = await db
    .select({ votingClosesAt: elections.votingClosesAt })
    .from(elections)
    .where(and(
      eq(elections.status, 'voting_open'),
      gt(elections.votingClosesAt, now),
    ))
    .orderBy(asc(elections.votingClosesAt))
    .limit(1);
  return next?.votingClosesAt ?? null;
}

export function startVoteAutoCloseWorker(
  db: Database,
  options: VoteAutoCloseWorkerOptions = {},
): VoteAutoCloseWorkerHandle {
  const intervalMs = options.intervalMs ?? resolveIntervalMs(process.env.VOTE_AUTO_CLOSE_INTERVAL_MS);
  const idleIntervalMs = options.idleIntervalMs
    ?? resolvePositiveMs(process.env.VOTE_AUTO_CLOSE_IDLE_INTERVAL_MS, DEFAULT_IDLE_INTERVAL_MS);
  const logger = options.logger ?? console;
  let running = false;
  let stopped = false;
  let wakeRequested = false;
  let timer: NodeJS.Timeout | null = null;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    if (stopped) return;
    clearTimer();
    timer = setTimeout(() => {
      void tick();
    }, Math.max(0, delayMs));
    timer.unref?.();
  };

  const nextDelayFrom = (nextCloseAt: Date | null): number => {
    if (!nextCloseAt) return idleIntervalMs;
    return Math.min(idleIntervalMs, Math.max(0, nextCloseAt.getTime() - Date.now()));
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    let nextDelay = idleIntervalMs;
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
      const didWork = result.closed.length > 0
        || result.failed.length > 0
        || result.renderFailed.length > 0;
      if (didWork) {
        nextDelay = intervalMs;
      } else {
        nextDelay = nextDelayFrom(await findNextOpenVoteCloseAt(db, { now: new Date() }));
      }
    } catch (error) {
      logger.error('[vote-auto-close] worker tick failed:', error);
    } finally {
      running = false;
      if (!stopped) {
        if (wakeRequested) {
          wakeRequested = false;
          schedule(0);
        } else {
          schedule(nextDelay);
        }
      }
    }
  };

  const handle: VoteAutoCloseWorkerHandle = {
    stop: () => {
      stopped = true;
      clearTimer();
      if (currentWorker === handle) currentWorker = null;
    },
    wake: (_reason?: string) => {
      if (stopped) return false;
      if (running) {
        wakeRequested = true;
        return true;
      }
      if (!running) schedule(0);
      return true;
    },
    unref: () => {
      timer?.unref?.();
    },
  };

  currentWorker = handle;

  if (options.runImmediately !== false) {
    void tick();
  } else {
    schedule(idleIntervalMs);
  }

  return handle;
}
