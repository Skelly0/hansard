import { describe, it, expect, vi } from 'vitest';
import { grantFavours, spendFavours, removeFavours } from './favourService';
import { FavourTransactionType } from '@hansard/shared';

// ----------------------------------------------------------------
// Helpers for building a chainable Drizzle-like mock.
// ----------------------------------------------------------------

interface SelectStub {
  rows: unknown[];
}

function makeSelectChain(stubs: SelectStub[]): {
  select: ReturnType<typeof vi.fn>;
} {
  let callIndex = 0;
  const select = vi.fn(() => {
    const stub = stubs[callIndex++] ?? { rows: [] };
    const limit = vi.fn().mockResolvedValue(stub.rows);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where, limit });
    return { from };
  });
  return { select };
}

const player = {
  id: 'player-1',
  discordId: '1',
  discordUsername: 'alice',
  characterName: 'Alice',
  isAlive: true,
};

const category = {
  id: 'cat-1',
  name: 'Industry',
  shortName: null,
  description: null,
  emoji: null,
  colour: null,
  spendableOn: null,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('grantFavours', () => {
  it('writes a transaction log row inside the same db.transaction', async () => {
    const balanceRow = {
      id: 'bal-1',
      playerId: player.id,
      categoryId: category.id,
      balance: 5,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const transactionRow = {
      id: 'tx-1',
      playerId: player.id,
      categoryId: category.id,
      amount: 5,
      balanceAfter: 5,
      type: 'grant',
      reason: 'reward',
      grantedById: 'staff-1',
      simTick: null,
      simDate: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    // First two outer selects: player + category.
    const outer = makeSelectChain([{ rows: [player] }, { rows: [category] }]);

    const txInsert = vi.fn();
    // Mocks for the two inserts inside the transaction: upsert balance, then insert log.
    txInsert
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([balanceRow]),
          }),
        }),
      })
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([transactionRow]),
        }),
      });

    const tx = { insert: txInsert, update: vi.fn(), select: vi.fn() };
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx));

    const db: any = {
      select: outer.select,
      transaction,
    };

    const result = await grantFavours(db, player.id, category.id, 5, 'reward', 'staff-1');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result.amount).toBe(5);
    expect(result.type).toBe(FavourTransactionType.GRANT);
    expect(result.balanceAfter).toBe(5);
    // Two inserts: balance upsert + transaction log.
    expect(txInsert).toHaveBeenCalledTimes(2);
  });
});

describe('spendFavours', () => {
  it('throws insufficient-funds without inserting a transaction row when balance is too low', async () => {
    const outer = makeSelectChain([{ rows: [player] }, { rows: [category] }]);

    // Conditional UPDATE returns no rows because balance < amount.
    const updateReturning = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const txUpdate = vi.fn().mockReturnValue({ set: updateSet });

    // Fallback SELECT for current balance, used to build the error message.
    const fallbackLimit = vi.fn().mockResolvedValue([{ balance: 2 }]);
    const fallbackWhere = vi.fn().mockReturnValue({ limit: fallbackLimit });
    const fallbackFrom = vi.fn().mockReturnValue({ where: fallbackWhere });
    const txSelect = vi.fn().mockReturnValue({ from: fallbackFrom });

    const txInsert = vi.fn();

    const tx = { insert: txInsert, update: txUpdate, select: txSelect };
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx));

    const db: any = {
      select: outer.select,
      transaction,
    };

    await expect(
      spendFavours(db, player.id, category.id, 10, 'lobbying', 'staff-1'),
    ).rejects.toThrow(/insufficient/i);

    // The conditional UPDATE was attempted but no INSERT into favour_transactions ran.
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(txInsert).not.toHaveBeenCalled();
  });

  it('decrements balance and writes a SPEND transaction log row on success', async () => {
    const outer = makeSelectChain([{ rows: [player] }, { rows: [category] }]);

    const updateReturning = vi.fn().mockResolvedValue([
      { id: 'bal-1', balance: 7 },
    ]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const txUpdate = vi.fn().mockReturnValue({ set: updateSet });

    const transactionRow = {
      id: 'tx-1',
      playerId: player.id,
      categoryId: category.id,
      amount: -3,
      balanceAfter: 7,
      type: 'spend',
      reason: 'lobbying',
      grantedById: 'staff-1',
      simTick: null,
      simDate: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    const insertReturning = vi.fn().mockResolvedValue([transactionRow]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    const txInsert = vi.fn().mockReturnValue({ values: insertValues });

    const tx = { insert: txInsert, update: txUpdate, select: vi.fn() };
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx));

    const db: any = {
      select: outer.select,
      transaction,
    };

    const result = await spendFavours(db, player.id, category.id, 3, 'lobbying', 'staff-1');

    expect(result.amount).toBe(-3);
    expect(result.balanceAfter).toBe(7);
    expect(result.type).toBe(FavourTransactionType.SPEND);
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(txInsert).toHaveBeenCalledTimes(1);
    // Confirm the insert payload reflects a negative amount and the post-decrement balance.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: -3,
        balanceAfter: 7,
        type: FavourTransactionType.SPEND,
      }),
    );
  });
});

describe('removeFavours', () => {
  it('throws insufficient-funds without inserting a transaction row when balance is too low', async () => {
    const outer = makeSelectChain([{ rows: [player] }, { rows: [category] }]);

    const updateReturning = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const txUpdate = vi.fn().mockReturnValue({ set: updateSet });

    const fallbackLimit = vi.fn().mockResolvedValue([{ balance: 0 }]);
    const fallbackWhere = vi.fn().mockReturnValue({ limit: fallbackLimit });
    const fallbackFrom = vi.fn().mockReturnValue({ where: fallbackWhere });
    const txSelect = vi.fn().mockReturnValue({ from: fallbackFrom });

    const txInsert = vi.fn();

    const tx = { insert: txInsert, update: txUpdate, select: txSelect };
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx));

    const db: any = {
      select: outer.select,
      transaction,
    };

    await expect(
      removeFavours(db, player.id, category.id, 5, 'penalty', 'staff-1'),
    ).rejects.toThrow(/insufficient/i);

    expect(txInsert).not.toHaveBeenCalled();
  });
});
