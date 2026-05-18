import { z } from 'zod';
import {
  getCategories,
  getPlayerBalances,
  getLeaderboard,
  getHistory,
  getAllHistory,
} from '@hansard/api/services/favourService';
import { jsonResult, errorResult, safeHandler, type RegisterToolsFn } from './types.js';

const favourTransactionTypeSchema = z.enum(['grant', 'spend', 'remove', 'transfer', 'system']);

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

  server.registerTool(
    'get_favour_transaction_ledger',
    {
      description: 'Staff-only: list the global favour transaction ledger across all players. Use this to prove historical grants, spends, removals, amounts, grantors, categories, and simulation context.',
      inputSchema: {
        playerId: z.string().uuid().optional().describe('Limit results to transactions for this player.'),
        categoryId: z.string().uuid().optional().describe('Limit results to one favour category.'),
        type: favourTransactionTypeSchema.optional().describe('Limit results to a transaction type, e.g. grant.'),
        grantedById: z.string().uuid().optional().describe('Limit results to transactions initiated by this staff player.'),
        limit: z.number().int().min(1).max(500).optional().describe('Maximum transactions to return. Default 100.'),
        offset: z.number().int().min(0).optional().describe('Number of matching transactions to skip. Default 0.'),
      },
    },
    safeHandler(async ({ playerId, categoryId, type, grantedById, limit, offset }) => {
      const session = await ctx.session.get();
      if (!session.isStaff) {
        return errorResult('Only staff can view the global favour transaction ledger.');
      }

      const transactions = await getAllHistory(ctx.db, {
        playerId,
        categoryId,
        type,
        grantedById,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return jsonResult({ count: transactions.length, transactions });
    }),
  );
};
