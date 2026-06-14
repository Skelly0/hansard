import { describe, expect, it, vi } from 'vitest';
import { BillStatus } from '@hansard/shared';
import { withdrawSubmittedBill } from './withdrawFlow.js';

const baseDate = new Date('2026-01-01T00:00:00.000Z');

function submittedBill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bill-1',
    title: 'Transit Reform Act',
    billNumber: 7,
    status: BillStatus.SUBMITTED,
    authorId: 'author-1',
    submittedById: 'submitter-1',
    ...overrides,
  };
}

function makeSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return { from, where, limit };
}

function makeJoinedSelectChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  return { from, innerJoin, where };
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

describe('withdrawSubmittedBill', () => {
  it('marks a submitted bill withdrawn when the author withdraws it', async () => {
    expect((BillStatus as Record<string, string>).WITHDRAWN).toBe('withdrawn');

    const bill = submittedBill();
    const actor = { id: 'author-1' };
    const billSelect = makeSelectChain([bill]);
    const actorSelect = makeSelectChain([actor]);
    const updateValues: unknown[] = [];
    const insertValues: unknown[] = [];
    const txBillUpdate = makeUpdateChain([
      { id: bill.id, title: bill.title, billNumber: bill.billNumber, status: 'withdrawn' },
    ], updateValues);
    const txInsert = makeInsertChain(insertValues);

    const db: any = {
      select: vi.fn()
        .mockReturnValueOnce({ from: billSelect.from })
        .mockReturnValueOnce({ from: actorSelect.from }),
      transaction: vi.fn(async (callback) => callback({
        update: txBillUpdate.update,
        insert: txInsert.insert,
      })),
    };

    const result = await withdrawSubmittedBill(db, {
      billId: bill.id,
      actorDiscordId: 'discord-1',
      reason: 'Sponsor pulled it back',
      now: baseDate,
    });

    expect(result.bill).toMatchObject({
      id: bill.id,
      status: 'withdrawn',
    });
    expect(result.previousStatus).toBe(BillStatus.SUBMITTED);
    expect(updateValues[0]).toMatchObject({
      status: 'withdrawn',
      updatedAt: baseDate,
    });
    expect(insertValues[0]).toMatchObject({
      billId: bill.id,
      fromStatus: BillStatus.SUBMITTED,
      toStatus: 'withdrawn',
      changedById: actor.id,
    });
    expect((insertValues[0] as { notes: string }).notes).toContain('Sponsor pulled it back');
  });

  it('allows the original submitter to withdraw a bill submitted on behalf of someone else', async () => {
    const bill = submittedBill();
    const actor = { id: 'submitter-1' };
    const billSelect = makeSelectChain([bill]);
    const actorSelect = makeSelectChain([actor]);
    const txBillUpdate = makeUpdateChain([
      { id: bill.id, title: bill.title, billNumber: bill.billNumber, status: 'withdrawn' },
    ], []);
    const txInsert = makeInsertChain([]);

    const db: any = {
      select: vi.fn()
        .mockReturnValueOnce({ from: billSelect.from })
        .mockReturnValueOnce({ from: actorSelect.from }),
      transaction: vi.fn(async (callback) => callback({
        update: txBillUpdate.update,
        insert: txInsert.insert,
      })),
    };

    await expect(withdrawSubmittedBill(db, {
      billId: bill.id,
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).resolves.toMatchObject({
      bill: { status: 'withdrawn' },
    });
  });

  it('allows a legislative leader to withdraw someone else\'s submitted bill', async () => {
    const bill = submittedBill();
    const actor = { id: 'chancellor-1' };
    const billSelect = makeSelectChain([bill]);
    const actorSelect = makeSelectChain([actor]);
    const permissionSelect = makeJoinedSelectChain([
      { permissions: ['legislative_leader'] },
    ]);
    const updateValues: unknown[] = [];
    const insertValues: unknown[] = [];
    const txBillUpdate = makeUpdateChain([
      { id: bill.id, title: bill.title, billNumber: bill.billNumber, status: 'withdrawn' },
    ], updateValues);
    const txInsert = makeInsertChain(insertValues);

    const db: any = {
      select: vi.fn()
        .mockReturnValueOnce({ from: billSelect.from })
        .mockReturnValueOnce({ from: actorSelect.from })
        .mockReturnValueOnce({ from: permissionSelect.from }),
      transaction: vi.fn(async (callback) => callback({
        update: txBillUpdate.update,
        insert: txInsert.insert,
      })),
    };

    await expect(withdrawSubmittedBill(db, {
      billId: bill.id,
      actorDiscordId: 'chancellor-discord',
      reason: 'Removing it from the order paper',
      now: baseDate,
    })).resolves.toMatchObject({
      bill: { status: 'withdrawn' },
    });

    expect(insertValues[0]).toMatchObject({
      billId: bill.id,
      changedById: actor.id,
      toStatus: 'withdrawn',
    });
  });

  it('refuses to withdraw a bill that is no longer submitted', async () => {
    const billSelect = makeSelectChain([
      submittedBill({ status: BillStatus.VOTING }),
    ]);
    const db: any = {
      select: vi.fn().mockReturnValueOnce({ from: billSelect.from }),
      transaction: vi.fn(),
    };

    await expect(withdrawSubmittedBill(db, {
      billId: 'bill-1',
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).rejects.toThrow('only submitted bills can be withdrawn');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('refuses to withdraw someone else\'s bill', async () => {
    const billSelect = makeSelectChain([submittedBill()]);
    const actorSelect = makeSelectChain([{ id: 'other-player' }]);
    const permissionSelect = makeJoinedSelectChain([]);
    const db: any = {
      select: vi.fn()
        .mockReturnValueOnce({ from: billSelect.from })
        .mockReturnValueOnce({ from: actorSelect.from })
        .mockReturnValueOnce({ from: permissionSelect.from }),
      transaction: vi.fn(),
    };

    await expect(withdrawSubmittedBill(db, {
      billId: 'bill-1',
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).rejects.toThrow('Only the bill author, original submitter, or Chancellor can withdraw it');
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
