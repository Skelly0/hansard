import { describe, expect, it, vi } from 'vitest';
import { BillStatus } from '@hansard/shared';
import { enactBill } from './enactFlow.js';

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

function makeInsertChain(insertValues: unknown[], onInsert?: () => Promise<unknown>) {
  const values = vi.fn((value) => {
    insertValues.push(value);
    return onInsert ? onInsert() : Promise.resolve();
  });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values };
}

describe('enactBill', () => {
  it('flips the bill to enacted and writes the audit row in a single transaction', async () => {
    const updateValues: unknown[] = [];
    const insertValues: unknown[] = [];
    const txBillUpdate = makeUpdateChain([
      {
        id: 'bill-1',
        title: 'Transit Reform Act',
        billNumber: 7,
        status: BillStatus.ENACTED,
        enactedAt: baseDate,
        effectiveAt: baseDate,
      },
    ], updateValues);
    const txInsert = makeInsertChain(insertValues);

    const db: any = {
      transaction: vi.fn(async (callback) => callback({
        update: txBillUpdate.update,
        insert: txInsert.insert,
      })),
    };

    const result = await enactBill(db, {
      billId: 'bill-1',
      expectedStatus: BillStatus.PLAYER_PASSED,
      changedById: 'actor-1',
      actorDiscordId: 'discord-1',
      legislationChannelId: 'law-channel',
      legislationMessageId: 'law-message',
      now: baseDate,
    });

    expect(result.bill).toMatchObject({ id: 'bill-1', status: BillStatus.ENACTED });
    expect(result.previousStatus).toBe(BillStatus.PLAYER_PASSED);
    expect(updateValues[0]).toMatchObject({
      status: BillStatus.ENACTED,
      enactedAt: baseDate,
      effectiveAt: baseDate,
      legislationChannelId: 'law-channel',
      legislationMessageId: 'law-message',
      updatedAt: baseDate,
    });
    expect(insertValues[0]).toMatchObject({
      billId: 'bill-1',
      fromStatus: BillStatus.PLAYER_PASSED,
      toStatus: BillStatus.ENACTED,
      changedById: 'actor-1',
    });
    expect((insertValues[0] as { notes: string }).notes).toContain('discord-1');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('rolls back the bill update when the audit-log insert fails', async () => {
    // Simulate a real Drizzle transaction: when the callback throws, all
    // statements inside it are rolled back. The test asserts that if the
    // audit-log insert fails, the bill update is also surfaced as a failure
    // so callers cannot mistakenly believe the bill was enacted.
    const updateValues: unknown[] = [];
    const insertValues: unknown[] = [];
    const txBillUpdate = makeUpdateChain([
      {
        id: 'bill-1',
        title: 'Transit Reform Act',
        billNumber: 7,
        status: BillStatus.ENACTED,
        enactedAt: baseDate,
        effectiveAt: baseDate,
      },
    ], updateValues);
    const txInsert = makeInsertChain(insertValues, () => Promise.reject(new Error('audit insert exploded')));

    let txCommitted = true;
    const db: any = {
      transaction: vi.fn(async (callback) => {
        try {
          return await callback({
            update: txBillUpdate.update,
            insert: txInsert.insert,
          });
        } catch (err) {
          txCommitted = false;
          throw err;
        }
      }),
    };

    await expect(enactBill(db, {
      billId: 'bill-1',
      expectedStatus: BillStatus.PLAYER_PASSED,
      changedById: 'actor-1',
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).rejects.toThrow('audit insert exploded');

    // The transaction was rolled back (not committed) — both writes are
    // unwound together.
    expect(txCommitted).toBe(false);
    expect(updateValues).toHaveLength(1);
    expect(insertValues).toHaveLength(1);
  });

  it('refuses to enact a bill whose status has drifted', async () => {
    const updateValues: unknown[] = [];
    const insertValues: unknown[] = [];
    const txBillUpdate = makeUpdateChain([], updateValues);
    const txInsert = makeInsertChain(insertValues);

    const db: any = {
      transaction: vi.fn(async (callback) => callback({
        update: txBillUpdate.update,
        insert: txInsert.insert,
      })),
    };

    await expect(enactBill(db, {
      billId: 'bill-1',
      expectedStatus: BillStatus.PLAYER_PASSED,
      changedById: 'actor-1',
      actorDiscordId: 'discord-1',
      now: baseDate,
    })).rejects.toThrow(/its status may have changed/i);
    expect(insertValues).toHaveLength(0);
  });
});
