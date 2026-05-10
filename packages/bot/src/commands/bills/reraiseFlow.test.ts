import { describe, expect, it, vi } from 'vitest';
import { BillStatus, ElectionStatus, ElectionType } from '@hansard/shared';
import { reraiseBillForVote } from './reraiseFlow.js';

const baseDate = new Date('2026-01-01T00:00:00.000Z');

function votingBill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bill-1',
    title: 'Transit Reform Act',
    billNumber: 1,
    authorId: 'author-1',
    status: BillStatus.VOTING,
    playerVoteId: 'election-1',
    playerVoteResult: null,
    playerVoteAt: null,
    ...overrides,
  };
}

function linkedElection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'election-1',
    title: 'Vote on: Transit Reform Act',
    type: ElectionType.LEGISLATIVE_VOTE,
    status: ElectionStatus.VOTING_CLOSED,
    relatedBillId: 'bill-1',
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

describe('reraiseBillForVote', () => {
  it('cancels the linked legislative vote and returns the bill to submitted', async () => {
    const bill = votingBill();
    const election = linkedElection();
    const actor = { id: 'actor-1' };

    const billSelect = makeSelectChain([bill]);
    const electionSelect = makeSelectChain([election]);
    const actorSelect = makeSelectChain([actor]);
    const updateValues: unknown[] = [];
    const insertValues: unknown[] = [];
    const txElectionUpdate = makeUpdateChain([
      { id: election.id, status: ElectionStatus.CANCELLED, relatedBillId: bill.id },
    ], updateValues);
    const txBillUpdate = makeUpdateChain([
      { id: bill.id, status: BillStatus.SUBMITTED, playerVoteId: null },
    ], updateValues);
    const txInsert = makeInsertChain(insertValues);

    const db: any = {
      select: vi.fn()
        .mockReturnValueOnce({ from: billSelect.from })
        .mockReturnValueOnce({ from: electionSelect.from })
        .mockReturnValueOnce({ from: actorSelect.from }),
      transaction: vi.fn(async (callback) => callback({
        update: vi.fn()
          .mockReturnValueOnce(txElectionUpdate.update())
          .mockReturnValueOnce(txBillUpdate.update()),
        insert: txInsert.insert,
      })),
    };

    const result = await reraiseBillForVote(db, {
      billId: bill.id,
      actorDiscordId: 'discord-1',
      reason: 'Wrong majority threshold',
      now: baseDate,
    });

    expect(result.bill).toMatchObject({
      id: bill.id,
      status: BillStatus.SUBMITTED,
      playerVoteId: null,
    });
    expect(result.election).toMatchObject({
      id: election.id,
      status: ElectionStatus.CANCELLED,
    });
    expect(db.select).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: expect.anything(),
      title: expect.anything(),
      billNumber: expect.anything(),
      status: expect.anything(),
      playerVoteId: expect.anything(),
    }));
    expect(db.select.mock.calls[0]?.[0]).not.toHaveProperty('billType');
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
    expect((insertValues[0] as { notes: string }).notes).toContain('Wrong majority threshold');
  });

  it('refuses to re-raise a certified legislative vote', async () => {
    const billSelect = makeSelectChain([votingBill()]);
    const electionSelect = makeSelectChain([
      linkedElection({ status: ElectionStatus.CERTIFIED }),
    ]);
    const db: any = {
      select: vi.fn()
        .mockReturnValueOnce({ from: billSelect.from })
        .mockReturnValueOnce({ from: electionSelect.from }),
      transaction: vi.fn(),
    };

    await expect(reraiseBillForVote(db, {
      billId: 'bill-1',
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).rejects.toThrow('Certified legislative votes cannot be re-raised');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('requires a bill with a linked player vote', async () => {
    const billSelect = makeSelectChain([
      votingBill({ status: BillStatus.SUBMITTED, playerVoteId: null }),
    ]);
    const db: any = {
      select: vi.fn().mockReturnValueOnce({ from: billSelect.from }),
      transaction: vi.fn(),
    };

    await expect(reraiseBillForVote(db, {
      billId: 'bill-1',
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).rejects.toThrow('Bill does not have a linked player vote');
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
