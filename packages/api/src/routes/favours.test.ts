import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import favourRoutes from './favours';
import { FavourTransactionType } from '@hansard/shared';

const auth = vi.hoisted(() => ({
  userId: 'staff-player',
  isStaff: true,
}));

const serviceMocks = vi.hoisted(() => ({
  getCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  getPlayerBalances: vi.fn(),
  getAllBalances: vi.fn(),
  getLeaderboard: vi.fn(),
  grantFavours: vi.fn(),
  spendFavours: vi.fn(),
  removeFavours: vi.fn(),
  getHistory: vi.fn(),
  getAllHistory: vi.fn(),
}));

const notifierMocks = vi.hoisted(() => ({
  notifyFavourAdjustment: vi.fn(),
}));

vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: async (request: any) => {
    request.session = { user: { id: auth.userId } };
    request.player = { id: auth.userId, isStaff: auth.isStaff };
  },
}));

vi.mock('../middleware/requireStaff.js', () => ({
  requireStaff: async (request: any) => {
    request.staffActionLog = true;
  },
}));

vi.mock('../services/favourService.js', () => serviceMocks);

vi.mock('../services/favourAdjustmentNotifier.js', () => ({
  notifyFavourAdjustment: notifierMocks.notifyFavourAdjustment,
}));

async function appWithDb() {
  const app = Fastify({ logger: false });
  app.decorate('db', {} as any);
  await app.register(favourRoutes);
  return app;
}

describe('favour routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.userId = 'staff-player';
    auth.isStaff = true;
    notifierMocks.notifyFavourAdjustment.mockResolvedValue(true);
  });

  it.each([
    {
      route: '/api/favours/grant',
      serviceName: 'grantFavours',
      type: FavourTransactionType.GRANT,
      amount: 5,
    },
    {
      route: '/api/favours/spend',
      serviceName: 'spendFavours',
      type: FavourTransactionType.SPEND,
      amount: -3,
    },
    {
      route: '/api/favours/remove',
      serviceName: 'removeFavours',
      type: FavourTransactionType.REMOVE,
      amount: -2,
    },
  ] as const)('notifies the player when $route adjusts favours', async ({ route, serviceName, type, amount }) => {
    const transaction = {
      id: `tx-${type}`,
      playerId: 'target-player',
      categoryId: 'category-1',
      amount,
      balanceAfter: 12,
      type,
      reason: 'web adjustment',
      grantedById: 'staff-player',
      simTick: null,
      simDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    serviceMocks[serviceName].mockResolvedValue(transaction);
    const app = await appWithDb();

    const res = await app.inject({
      method: 'POST',
      url: route,
      payload: {
        playerId: 'target-player',
        categoryId: 'category-1',
        amount: Math.abs(amount),
        reason: 'web adjustment',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      transaction,
      dmSent: true,
      dmMessage: 'DM sent to player.',
    });
    expect(notifierMocks.notifyFavourAdjustment).toHaveBeenCalledWith({
      db: app.db,
      transaction,
    });

    await app.close();
  });

  it('still returns the committed transaction when the web favour adjustment DM fails', async () => {
    const transaction = {
      id: 'tx-grant',
      playerId: 'target-player',
      categoryId: 'category-1',
      amount: 5,
      balanceAfter: 12,
      type: FavourTransactionType.GRANT,
      reason: null,
      grantedById: 'staff-player',
      simTick: null,
      simDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    serviceMocks.grantFavours.mockResolvedValue(transaction);
    notifierMocks.notifyFavourAdjustment.mockResolvedValue(false);
    const app = await appWithDb();

    const res = await app.inject({
      method: 'POST',
      url: '/api/favours/grant',
      payload: {
        playerId: 'target-player',
        categoryId: 'category-1',
        amount: 5,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      transaction,
      dmSent: false,
      dmMessage: 'DM could not be delivered; check API logs.',
    });

    await app.close();
  });

  it('still returns the committed transaction when the notifier throws unexpectedly', async () => {
    const transaction = {
      id: 'tx-grant',
      playerId: 'target-player',
      categoryId: 'category-1',
      amount: 5,
      balanceAfter: 12,
      type: FavourTransactionType.GRANT,
      reason: null,
      grantedById: 'staff-player',
      simTick: null,
      simDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    serviceMocks.grantFavours.mockResolvedValue(transaction);
    notifierMocks.notifyFavourAdjustment.mockRejectedValue(new Error('Discord is sideways'));
    const app = await appWithDb();

    const res = await app.inject({
      method: 'POST',
      url: '/api/favours/grant',
      payload: {
        playerId: 'target-player',
        categoryId: 'category-1',
        amount: 5,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      transaction,
      dmSent: false,
      dmMessage: 'DM could not be delivered; check API logs.',
    });

    await app.close();
  });

  it('does not notify when a web favour adjustment is rejected', async () => {
    serviceMocks.grantFavours.mockRejectedValue(new Error('Grant amount must be positive'));
    const app = await appWithDb();

    const res = await app.inject({
      method: 'POST',
      url: '/api/favours/grant',
      payload: {
        playerId: 'target-player',
        categoryId: 'category-1',
        amount: 0,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(notifierMocks.notifyFavourAdjustment).not.toHaveBeenCalled();

    await app.close();
  });
});
