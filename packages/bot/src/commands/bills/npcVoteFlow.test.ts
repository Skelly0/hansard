import { describe, expect, it, vi } from 'vitest';
import { BillStatus } from '@hansard/shared';
import { recordNpcVote } from './npcVoteFlow.js';

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

function makeInsertChain(insertValues: unknown[]) {
  const values = vi.fn((value) => {
    insertValues.push(value);
    return Promise.resolve();
  });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values };
}

describe('recordNpcVote', () => {
  it('flips bill status and writes audit row when expected status matches', async () => {
    const updateValues: unknown[] = [];
    const insertValues: unknown[] = [];
    const txBillUpdate = makeUpdateChain([
      {
        id: 'bill-1',
        title: 'NPC House Bill',
        billNumber: 9,
        status: 'npc_passed',
      },
    ], updateValues);
    const txInsert = makeInsertChain(insertValues);

    const db: any = {
      transaction: vi.fn(async (callback) => callback({
        update: txBillUpdate.update,
        insert: txInsert.insert,
      })),
    };

    const result = await recordNpcVote(db, {
      billId: 'bill-1',
      expectedStatus: BillStatus.PLAYER_PASSED,
      newStatus: 'npc_passed',
      npcVote: {
        status: 'passed',
        tally: { yea: 10, nay: 4, abstain: 1, total: 15 },
        decidedAt: baseDate.toISOString(),
        enteredById: 'actor-1',
      },
      enteredById: 'actor-1',
      notes: 'NPC house vote: 10 yea / 4 nay / 1 abstain',
      now: baseDate,
    });

    expect(result.bill.id).toBe('bill-1');
    expect(result.previousStatus).toBe(BillStatus.PLAYER_PASSED);
    expect(updateValues[0]).toMatchObject({
      status: 'npc_passed',
      updatedAt: baseDate,
    });
    expect(insertValues[0]).toMatchObject({
      billId: 'bill-1',
      fromStatus: BillStatus.PLAYER_PASSED,
      toStatus: 'npc_passed',
      changedById: 'actor-1',
    });
  });

  it('refuses to record an NPC vote when bill status has drifted', async () => {
    const updateValues: unknown[] = [];
    const insertValues: unknown[] = [];
    // Empty array simulates the WHERE id+status guard matching no rows
    const txBillUpdate = makeUpdateChain([], updateValues);
    const txInsert = makeInsertChain(insertValues);

    const db: any = {
      transaction: vi.fn(async (callback) => callback({
        update: txBillUpdate.update,
        insert: txInsert.insert,
      })),
    };

    await expect(recordNpcVote(db, {
      billId: 'bill-1',
      expectedStatus: BillStatus.PLAYER_PASSED,
      newStatus: 'npc_passed',
      npcVote: {
        status: 'passed',
        tally: { yea: 10, nay: 4, abstain: 1, total: 15 },
        decidedAt: baseDate.toISOString(),
        enteredById: 'actor-1',
      },
      enteredById: 'actor-1',
      notes: 'NPC house vote: 10 yea / 4 nay / 1 abstain',
      now: baseDate,
    })).rejects.toThrow(/status changed/i);

    // Audit log must not be written when status guard fails
    expect(insertValues).toHaveLength(0);
  });
});
