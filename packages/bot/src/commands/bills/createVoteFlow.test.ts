import { describe, expect, it, vi } from 'vitest';
import { BillStatus, DEFAULT_VOTE_DURATION_MS } from '@hansard/shared';
import { createLegislativeVoteForBill } from './createVoteFlow.js';

const baseDate = new Date('2026-01-01T00:00:00.000Z');

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

function makeInsertChain(returnedRows: unknown[] | null, insertValues: unknown[], onInsert?: () => Promise<unknown>) {
  const returning = vi.fn().mockResolvedValue(returnedRows ?? []);
  const values = vi.fn((value) => {
    insertValues.push(value);
    if (onInsert) return onInsert();
    if (returnedRows === null) return Promise.resolve();
    return { returning };
  });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, returning };
}

interface TxState {
  electionInsert: ReturnType<typeof makeInsertChain>;
  billUpdate: ReturnType<typeof makeUpdateChain>;
  auditInsert: ReturnType<typeof makeInsertChain>;
}

function setupTx(state: TxState, opts: { auditFails?: boolean } = {}) {
  return {
    insert: vi.fn()
      .mockReturnValueOnce({ values: state.electionInsert.values })
      .mockReturnValueOnce({ values: state.auditInsert.values }),
    update: state.billUpdate.update,
  };
}

describe('createLegislativeVoteForBill', () => {
  it('opens a legislative vote, flips the bill, and writes the audit row atomically', async () => {
    const electionInsertValues: unknown[] = [];
    const billUpdateValues: unknown[] = [];
    const auditInsertValues: unknown[] = [];

    const electionInsert = makeInsertChain(
      [{
        id: 'election-1',
        title: 'Vote on: Transit Reform Act',
        description: 'A bill about transit',
        votingOpensAt: baseDate,
        votingClosesAt: new Date(baseDate.getTime() + DEFAULT_VOTE_DURATION_MS),
      }],
      electionInsertValues,
    );
    const billUpdate = makeUpdateChain(
      [{ id: 'bill-1', status: BillStatus.VOTING, playerVoteId: 'election-1' }],
      billUpdateValues,
    );
    const auditInsert = makeInsertChain(null, auditInsertValues);

    const db: any = {
      transaction: vi.fn(async (callback) => callback({
        insert: vi.fn()
          .mockReturnValueOnce({ values: electionInsert.values })
          .mockReturnValueOnce({ values: auditInsert.values }),
        update: billUpdate.update,
      })),
    };

    const result = await createLegislativeVoteForBill(db, {
      billId: 'bill-1',
      billTitle: 'Transit Reform Act',
      billNumber: 7,
      billSummary: 'A bill about transit',
      expectedStatus: BillStatus.SUBMITTED,
      createdById: 'actor-1',
      now: baseDate,
    });

    expect(result.election.id).toBe('election-1');
    expect(result.bill).toMatchObject({
      id: 'bill-1',
      status: BillStatus.VOTING,
      playerVoteId: 'election-1',
    });
    expect(electionInsertValues[0]).toMatchObject({
      type: 'legislative_vote',
      method: 'yea_nay_abstain',
      relatedBillId: 'bill-1',
      status: 'voting_open',
    });
    expect(billUpdateValues[0]).toMatchObject({
      status: BillStatus.VOTING,
      playerVoteId: 'election-1',
      updatedAt: baseDate,
    });
    expect(auditInsertValues[0]).toMatchObject({
      billId: 'bill-1',
      fromStatus: BillStatus.SUBMITTED,
      toStatus: BillStatus.VOTING,
      changedById: 'actor-1',
    });
    expect((auditInsertValues[0] as { notes: string }).notes).toContain('election-1');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('rolls back the election + bill writes when the audit-log insert fails', async () => {
    const electionInsertValues: unknown[] = [];
    const billUpdateValues: unknown[] = [];
    const auditInsertValues: unknown[] = [];

    const electionInsert = makeInsertChain(
      [{
        id: 'election-1',
        title: 'Vote on: Transit Reform Act',
        description: 'A bill about transit',
        votingOpensAt: baseDate,
        votingClosesAt: new Date(baseDate.getTime() + DEFAULT_VOTE_DURATION_MS),
      }],
      electionInsertValues,
    );
    const billUpdate = makeUpdateChain(
      [{ id: 'bill-1', status: BillStatus.VOTING, playerVoteId: 'election-1' }],
      billUpdateValues,
    );
    const auditInsert = makeInsertChain(
      null,
      auditInsertValues,
      () => Promise.reject(new Error('audit insert exploded')),
    );

    let txCommitted = true;
    const db: any = {
      transaction: vi.fn(async (callback) => {
        try {
          return await callback({
            insert: vi.fn()
              .mockReturnValueOnce({ values: electionInsert.values })
              .mockReturnValueOnce({ values: auditInsert.values }),
            update: billUpdate.update,
          });
        } catch (err) {
          txCommitted = false;
          throw err;
        }
      }),
    };

    await expect(createLegislativeVoteForBill(db, {
      billId: 'bill-1',
      billTitle: 'Transit Reform Act',
      billNumber: 7,
      billSummary: null,
      expectedStatus: BillStatus.SUBMITTED,
      createdById: 'actor-1',
      now: baseDate,
    })).rejects.toThrow('audit insert exploded');

    expect(txCommitted).toBe(false);
    // Both prior writes were attempted, but the transaction wrapper unwinds them.
    expect(electionInsertValues).toHaveLength(1);
    expect(billUpdateValues).toHaveLength(1);
    expect(auditInsertValues).toHaveLength(1);
  });

  it('refuses to create a vote on a bill whose status has drifted', async () => {
    const electionInsertValues: unknown[] = [];
    const billUpdateValues: unknown[] = [];
    const auditInsertValues: unknown[] = [];

    const electionInsert = makeInsertChain(
      [{
        id: 'election-1',
        title: 'Vote on: Transit Reform Act',
        description: 'desc',
        votingOpensAt: baseDate,
        votingClosesAt: new Date(baseDate.getTime() + DEFAULT_VOTE_DURATION_MS),
      }],
      electionInsertValues,
    );
    const billUpdate = makeUpdateChain([], billUpdateValues); // empty rows -> drift
    const auditInsert = makeInsertChain(null, auditInsertValues);

    const db: any = {
      transaction: vi.fn(async (callback) => callback({
        insert: vi.fn()
          .mockReturnValueOnce({ values: electionInsert.values })
          .mockReturnValueOnce({ values: auditInsert.values }),
        update: billUpdate.update,
      })),
    };

    await expect(createLegislativeVoteForBill(db, {
      billId: 'bill-1',
      billTitle: 'Transit Reform Act',
      billNumber: 7,
      billSummary: null,
      expectedStatus: BillStatus.SUBMITTED,
      createdById: 'actor-1',
      now: baseDate,
    })).rejects.toThrow(/may have changed/);

    expect(auditInsertValues).toHaveLength(0);
  });
});
