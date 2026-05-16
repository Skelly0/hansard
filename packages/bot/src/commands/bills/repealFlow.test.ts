import { describe, expect, it, vi } from 'vitest';
import { BillStatus } from '@hansard/shared';
import { repealBill } from './repealFlow.js';

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

describe('repealBill', () => {
  it('flips bill status to repealed and writes audit row when expected status matches', async () => {
    const updateValues: unknown[] = [];
    const insertValues: unknown[] = [];
    const txBillUpdate = makeUpdateChain([
      {
        id: 'bill-1',
        title: 'A Repealable Bill',
        billNumber: 12,
        status: BillStatus.REPEALED,
      },
    ], updateValues);
    const txInsert = makeInsertChain(insertValues);

    const db: any = {
      transaction: vi.fn(async (callback) => callback({
        update: txBillUpdate.update,
        insert: txInsert.insert,
      })),
    };

    const result = await repealBill(db, {
      billId: 'bill-1',
      expectedStatus: BillStatus.ENACTED,
      changedById: 'actor-1',
      actorDiscordId: 'discord-1',
      now: baseDate,
    });

    expect(result.bill.id).toBe('bill-1');
    expect(result.previousStatus).toBe(BillStatus.ENACTED);
    expect(updateValues[0]).toMatchObject({
      status: BillStatus.REPEALED,
      repealedAt: baseDate,
      updatedAt: baseDate,
    });
    expect(insertValues[0]).toMatchObject({
      billId: 'bill-1',
      fromStatus: BillStatus.ENACTED,
      toStatus: BillStatus.REPEALED,
      changedById: 'actor-1',
    });
    expect((insertValues[0] as { notes: string }).notes).toContain('discord-1');
  });

  it('refuses to repeal a bill whose status has drifted', async () => {
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

    await expect(repealBill(db, {
      billId: 'bill-1',
      expectedStatus: BillStatus.ENACTED,
      changedById: 'actor-1',
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).rejects.toThrow(/status changed/i);

    // Audit log must not be written when status guard fails
    expect(insertValues).toHaveLength(0);
  });
});
