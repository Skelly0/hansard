import { describe, expect, it, vi } from 'vitest';
import { closeDueVotes } from './voteAutoClose';

function selectDue(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(rows),
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
