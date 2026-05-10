import { z } from 'zod';
import {
  getCategories,
  getPlayerBalances,
  getLeaderboard,
  getHistory,
} from '@hansard/api/services/favourService';
import { jsonResult, errorResult, safeHandler, type RegisterToolsFn } from './types.js';

export const registerFavourTools: RegisterToolsFn = (server, ctx) => {
  server.registerTool(
    'list_favour_categories',
    {
      description: 'List the configured favour categories (e.g. political capital, social capital).',
      inputSchema: {},
    },
    safeHandler(async () => {
      const categories = await getCategories(ctx.db);
      return jsonResult({ count: categories.length, categories });
    }),
  );

  server.registerTool(
    'get_my_favours',
    {
      description: 'Get the authenticated user\'s favour balances across all categories, plus their recent transaction history.',
      inputSchema: {
        historyLimit: z.number().int().min(0).max(200).optional().describe('How many recent transactions to include. Default 20.'),
      },
    },
    safeHandler(async ({ historyLimit }) => {
      const session = await ctx.session.get();
      const balances = await getPlayerBalances(ctx.db, session.playerId);
      const history = await getHistory(ctx.db, session.playerId, { limit: historyLimit ?? 20 });
      return jsonResult({ playerId: session.playerId, balances, history });
    }),
  );

  server.registerTool(
    'get_favour_leaderboard',
    {
      description: 'Top players by favour balance in a given category.',
      inputSchema: {
        categoryId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).optional().describe('Default 20.'),
      },
    },
    safeHandler(async ({ categoryId, limit }) => {
      const session = await ctx.session.get();
      if (!session.isStaff) {
        return errorResult('Only staff can view favour leaderboards.');
      }
      const rows = await getLeaderboard(ctx.db, categoryId, limit);
      return jsonResult({ count: rows.length, leaderboard: rows });
    }),
  );
};
