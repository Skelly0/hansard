import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDueVotes, startVoteAutoCloseWorker, wakeVoteAutoCloseWorker } from './voteAutoClose';

function selectDue(rows: unknown[] | Promise<unknown[]>) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(rows)),
        })),
      })),
    })),
  };
}

function updateReturning(rows: unknown[]) {
  return {
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

describe('closeDueVotes', () => {
  it('closes overdue open votes and renders reaction results once closed', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const dueElection = {
      id: 'election-1',
      title: 'Bridge Security Act',
      status: 'voting_open',
      votingClosesAt: new Date('2026-05-11T11:59:59.000Z'),
      useReactions: true,
      discordMessageId: 'message-1',
      discordChannelId: 'channel-1',
    };
    const closedElection = { ...dueElection, status: 'voting_closed', updatedAt: now };
    const db = {
      select: vi.fn(() => selectDue([dueElection])),
      update: vi.fn(() => updateReturning([closedElection])),
    };
    const renderReactionResult = vi.fn().mockResolvedValue(undefined);

    const result = await closeDueVotes(db as any, {
      now,
      renderReactionResult,
      limit: 50,
    });

    expect(result.closed).toEqual([
      { id: 'election-1', title: 'Bridge Security Act' },
    ]);
    expect(result.failed).toEqual([]);
    expect(renderReactionResult).toHaveBeenCalledWith(closedElection);
  });

  it('runs the tally callback for linked legislative votes only', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const dueElection = {
      id: 'election-1',
      title: 'Bridge Security Act',
      status: 'voting_open',
      votingClosesAt: new Date('2026-05-11T11:59:59.000Z'),
      useReactions: false,
      type: 'legislative_vote',
      relatedBillId: 'bill-1',
    };
    const closedElection = { ...dueElection, status: 'voting_closed', updatedAt: now };
    const db = {
      select: vi.fn(() => selectDue([dueElection])),
      update: vi.fn(() => updateReturning([closedElection])),
    };
    const tallyElection = vi.fn().mockResolvedValue(undefined);

    await closeDueVotes(db as any, {
      now,
      tallyElection,
      limit: 50,
    });

    expect(tallyElection).toHaveBeenCalledWith(closedElection);
  });

  it('does not run the tally callback for unlinked legislative votes', async () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const dueElection = {
      id: 'election-1',
      title: 'Bridge Security Act',
      status: 'voting_open',
      votingClosesAt: new Date('2026-05-11T11:59:59.000Z'),
      useReactions: false,
      type: 'legislative_vote',
      relatedBillId: null,
    };
    const closedElection = { ...dueElection, status: 'voting_closed', updatedAt: now };
    const db = {
      select: vi.fn(() => selectDue([dueElection])),
      update: vi.fn(() => updateReturning([closedElection])),
    };
    const tallyElection = vi.fn().mockResolvedValue(undefined);

    await closeDueVotes(db as any, {
      now,
      tallyElection,
      limit: 50,
    });

    expect(tallyElection).not.toHaveBeenCalled();
  });
});

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function dbWithSelectQueue(selectRows: Array<unknown[] | Promise<unknown[]>>) {
  const queue = [...selectRows];
  return {
    select: vi.fn(() => selectDue(queue.shift() ?? [])),
    update: vi.fn(() => updateReturning([])),
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.VOTE_AUTO_CLOSE_INTERVAL_MS;
  delete process.env.VOTE_AUTO_CLOSE_IDLE_INTERVAL_MS;
});

describe('startVoteAutoCloseWorker scheduling', () => {
  it('defaults the idle cadence to six hours', async () => {
    vi.useFakeTimers();
    const db = dbWithSelectQueue([[], [], []]);
    const worker = startVoteAutoCloseWorker(db as any, {
      intervalMs: 100,
      runImmediately: true,
      logger: { error: vi.fn(), log: vi.fn() },
    } as any);

    try {
      await flushAsyncWork();
      expect(db.select).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync((6 * 60 * 60 * 1000) - 1);
      expect(db.select).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1);
      expect(db.select).toHaveBeenCalledTimes(4);
    } finally {
      worker.stop();
    }
  });

  it('backs off to the idle interval when there is no vote work', async () => {
    vi.useFakeTimers();
    const db = dbWithSelectQueue([[], [], []]);
    const worker = startVoteAutoCloseWorker(db as any, {
      intervalMs: 100,
      idleIntervalMs: 1_000,
      runImmediately: true,
      logger: { error: vi.fn(), log: vi.fn() },
    } as any);

    try {
      await flushAsyncWork();
      expect(db.select).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(999);
      expect(db.select).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1);
      expect(db.select).toHaveBeenCalledTimes(4);
    } finally {
      worker.stop();
    }
  });

  it('schedules the next check at the next open vote close time when sooner than idle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    const nextClose = new Date('2026-05-11T12:05:00.000Z');
    const db = dbWithSelectQueue([
      [],
      [{ votingClosesAt: nextClose }],
      [],
      [],
    ]);
    const worker = startVoteAutoCloseWorker(db as any, {
      intervalMs: 100,
      idleIntervalMs: 60 * 60 * 1000,
      runImmediately: true,
      logger: { error: vi.fn(), log: vi.fn() },
    } as any);

    try {
      await flushAsyncWork();
      expect(db.select).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(299_999);
      expect(db.select).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1);
      expect(db.select).toHaveBeenCalledTimes(4);
    } finally {
      worker.stop();
    }
  });

  it('runs again promptly when woken during an active tick', async () => {
    vi.useFakeTimers();
    let resolveFirstSelect: (rows: unknown[]) => void = () => undefined;
    const firstSelect = new Promise<unknown[]>((resolve) => {
      resolveFirstSelect = resolve;
    });
    const db = dbWithSelectQueue([
      firstSelect,
      [],
      [],
      [],
    ]);
    const worker = startVoteAutoCloseWorker(db as any, {
      intervalMs: 100,
      idleIntervalMs: 60 * 60 * 1000,
      runImmediately: true,
      logger: { error: vi.fn(), log: vi.fn() },
    } as any);

    try {
      await flushAsyncWork();
      expect(db.select).toHaveBeenCalledTimes(1);

      expect(wakeVoteAutoCloseWorker('test')).toBe(true);
      resolveFirstSelect([]);
      await flushAsyncWork();
      expect(db.select).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(0);
      await flushAsyncWork();
      expect(db.select).toHaveBeenCalledTimes(4);
    } finally {
      worker.stop();
    }
  });
});
