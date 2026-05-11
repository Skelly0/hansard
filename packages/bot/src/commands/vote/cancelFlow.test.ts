import { describe, expect, it, vi } from 'vitest';
import { BillStatus, ElectionStatus, ElectionType } from '@hansard/shared';
import { cancelVote } from './cancelFlow.js';

const baseDate = new Date('2026-01-01T00:00:00.000Z');

function openElection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'election-1',
    title: 'Vote on: Transit Reform Act',
    type: ElectionType.LEGISLATIVE_VOTE,
    status: ElectionStatus.VOTING_OPEN,
    relatedBillId: 'bill-1',
    ...overrides,
  };
}

function votingBill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bill-1',
    title: 'Transit Reform Act',
    billNumber: 1,
    status: BillStatus.VOTING,
    playerVoteId: 'election-1',
    playerVoteResult: null,
    playerVoteAt: null,
    ...overrides,
  };
}

function makeSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return { from, where, limit };
}

function makeUpdateChain(returnedRows: unknown[], updateValues: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnedRows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn((value) => {
    updateValues.push(value);
    return { where };
  });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where, returning };
}

function makeInsertChain(insertValues: unknown[]) {
  const values = vi.fn((value) => {
    insertValues.push(value);
    return Promise.resolve();
  });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values };
}

describe('cancelVote', () => {
  it('cancels a linked legislative vote and returns the bill to submitted', async () => {
    const election = openElection();
    const bill = votingBill();
    const actor = { id: 'actor-1' };
    const billSelect = makeSelectChain([bill]);
    const actorSelect = makeSelectChain([actor]);
    const updateValues: unknown[] = [];
    const insertValues: unknown[] = [];
    const txElectionUpdate = makeUpdateChain([
      { id: election.id, title: election.title, status: ElectionStatus.CANCELLED },
    ], updateValues);
    const txBillUpdate = makeUpdateChain([
      { id: bill.id, title: bill.title, billNumber: bill.billNumber, status: BillStatus.SUBMITTED, playerVoteId: null },
    ], updateValues);
    const txInsert = makeInsertChain(insertValues);

    const db: any = {
      select: vi.fn()
        .mockReturnValueOnce({ from: billSelect.from })
        .mockReturnValueOnce({ from: actorSelect.from }),
      transaction: vi.fn(async (callback) => callback({
        update: vi.fn()
          .mockReturnValueOnce(txElectionUpdate.update())
          .mockReturnValueOnce(txBillUpdate.update()),
        insert: txInsert.insert,
      })),
    };

    const result = await cancelVote(db, election as any, {
      actorDiscordId: 'discord-1',
      reason: 'Wrong threshold',
      now: baseDate,
    });

    expect(result.election).toMatchObject({
      id: election.id,
      status: ElectionStatus.CANCELLED,
    });
    expect(result.bill).toMatchObject({
      id: bill.id,
      status: BillStatus.SUBMITTED,
      playerVoteId: null,
    });
    expect(updateValues[0]).toMatchObject({
      status: ElectionStatus.CANCELLED,
      updatedAt: baseDate,
    });
    expect(updateValues[1]).toMatchObject({
      status: BillStatus.SUBMITTED,
      playerVoteId: null,
      playerVoteResult: null,
      playerVoteAt: null,
      updatedAt: baseDate,
    });
    expect(insertValues[0]).toMatchObject({
      billId: bill.id,
      fromStatus: BillStatus.VOTING,
      toStatus: BillStatus.SUBMITTED,
      changedById: actor.id,
    });
    expect((insertValues[0] as { notes: string }).notes).toContain(election.id);
    expect((insertValues[0] as { notes: string }).notes).toContain('Wrong threshold');
  });

  it('cancels a non-bill election without requiring a registered actor', async () => {
    const election = openElection({
      type: ElectionType.REFERENDUM,
      relatedBillId: null,
    });
    const updateValues: unknown[] = [];
    const updatedElection = {
      id: election.id,
      title: election.title,
      status: ElectionStatus.CANCELLED,
    };
    const updateChain = makeUpdateChain([updatedElection], updateValues);

    const db: any = {
      select: vi.fn(),
      update: updateChain.update,
      transaction: vi.fn(),
    };

    const result = await cancelVote(db, election as any, {
      actorDiscordId: 'discord-1',
      now: baseDate,
    });

    expect(result).toEqual({
      election: updatedElection,
      bill: null,
      previousElectionStatus: ElectionStatus.VOTING_OPEN,
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('cancels a standalone legislative vote without looking for a bill', async () => {
    const election = openElection({
      relatedBillId: null,
    });
    const updateValues: unknown[] = [];
    const updatedElection = {
      id: election.id,
      title: election.title,
      status: ElectionStatus.CANCELLED,
    };
    const updateChain = makeUpdateChain([updatedElection], updateValues);

    const db: any = {
      select: vi.fn(),
      update: updateChain.update,
      transaction: vi.fn(),
    };

    const result = await cancelVote(db, election as any, {
      actorDiscordId: 'discord-1',
      now: baseDate,
    });

    expect(result).toEqual({
      election: updatedElection,
      bill: null,
      previousElectionStatus: ElectionStatus.VOTING_OPEN,
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('refuses to cancel certified elections', async () => {
    const db: any = { update: vi.fn(), transaction: vi.fn() };

    await expect(cancelVote(db, openElection({ status: ElectionStatus.CERTIFIED }) as any, {
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).rejects.toThrow('Certified votes cannot be cancelled');
    expect(db.update).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('fails if a non-bill election changes status before cancellation is written', async () => {
    const updateChain = makeUpdateChain([], []);
    const db: any = {
      update: updateChain.update,
      transaction: vi.fn(),
    };

    await expect(cancelVote(db, openElection({
      type: ElectionType.REFERENDUM,
      relatedBillId: null,
    }) as any, {
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).rejects.toThrow('Failed to cancel vote');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rolls back linked legislative cancellation if the bill is no longer attached to the vote', async () => {
    const election = openElection();
    const bill = votingBill();
    const actor = { id: 'actor-1' };
    const billSelect = makeSelectChain([bill]);
    const actorSelect = makeSelectChain([actor]);
    const insertValues: unknown[] = [];
    const txElectionUpdate = makeUpdateChain([
      { id: election.id, title: election.title, status: ElectionStatus.CANCELLED },
    ], []);
    const txBillUpdate = makeUpdateChain([], []);
    const txInsert = makeInsertChain(insertValues);

    const db: any = {
      select: vi.fn()
        .mockReturnValueOnce({ from: billSelect.from })
        .mockReturnValueOnce({ from: actorSelect.from }),
      transaction: vi.fn(async (callback) => callback({
        update: vi.fn()
          .mockReturnValueOnce(txElectionUpdate.update())
          .mockReturnValueOnce(txBillUpdate.update()),
        insert: txInsert.insert,
      })),
    };

    await expect(cancelVote(db, election as any, {
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).rejects.toThrow('Failed to update linked bill status');
    expect(insertValues).toHaveLength(0);
  });
});
