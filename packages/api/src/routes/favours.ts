import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import {
  getCategories,
  createCategory,
  updateCategory,
  getPlayerBalances,
  getAllBalances,
  getLeaderboard,
  grantFavours,
  spendFavours,
  removeFavours,
  getHistory,
  getAllHistory,
} from '../services/favourService.js';

/**
 * Favour routes plugin — categories, balances, and transactions.
 */
export default async function favourRoutes(fastify: FastifyInstance) {
  // ============================================================
  // Categories
  // ============================================================

  // GET /api/favours/categories — list all favour categories
  fastify.get(
    '/api/favours/categories',
    { preHandler: [requireAuth] },
    async () => {
      return getCategories(fastify.db);
    },
  );

  // POST /api/favours/categories — create new favour category (staff only)
  fastify.post<{
    Body: {
      name: string;
      shortName?: string;
      description?: string;
      emoji?: string;
      colour?: string;
      spendableOn?: string[];
      sortOrder?: number;
    };
  }>(
    '/api/favours/categories',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const category = await createCategory(fastify.db, request.body);
      return reply.status(201).send(category);
    },
  );

  // PATCH /api/favours/categories/:id — update category (staff only)
  fastify.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      shortName?: string | null;
      description?: string | null;
      emoji?: string | null;
      colour?: string | null;
      spendableOn?: string[] | null;
      isActive?: boolean;
      sortOrder?: number;
    };
  }>(
    '/api/favours/categories/:id',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const category = await updateCategory(fastify.db, request.params.id, request.body);
      if (!category) {
        return reply.status(404).send({ error: 'Favour category not found' });
      }
      return category;
    },
  );

  // DELETE /api/favours/categories/:id — deactivate category (staff only)
  fastify.delete<{ Params: { id: string } }>(
    '/api/favours/categories/:id',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const category = await updateCategory(fastify.db, request.params.id, { isActive: false });
      if (!category) {
        return reply.status(404).send({ error: 'Favour category not found' });
      }
      return category;
    },
  );

  // ============================================================
  // Balances
  // ============================================================

  // GET /api/favours/balances/:playerId — balances for a player
  fastify.get<{ Params: { playerId: string } }>(
    '/api/favours/balances/:playerId',
    { preHandler: [requireAuth] },
    async (request) => {
      return getPlayerBalances(fastify.db, request.params.playerId);
    },
  );

  // GET /api/favours/balances — all players' balances (staff only)
  fastify.get(
    '/api/favours/balances',
    { preHandler: [requireAuth, requireStaff] },
    async () => {
      return getAllBalances(fastify.db);
    },
  );

  // GET /api/favours/leaderboard/:categoryId — top players in a category
  fastify.get<{ Params: { categoryId: string }; Querystring: { limit?: string } }>(
    '/api/favours/leaderboard/:categoryId',
    { preHandler: [requireAuth] },
    async (request) => {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
      return getLeaderboard(fastify.db, request.params.categoryId, limit);
    },
  );

  // ============================================================
  // Transactions
  // ============================================================

  // POST /api/favours/grant — grant favours (staff only)
  fastify.post<{
    Body: {
      playerId: string;
      categoryId: string;
      amount: number;
      reason?: string;
    };
  }>(
    '/api/favours/grant',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      try {
        const transaction = await grantFavours(
          fastify.db,
          request.body.playerId,
          request.body.categoryId,
          request.body.amount,
          request.body.reason ?? null,
          request.session.user!.id,
        );
        return reply.status(201).send(transaction);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Grant failed';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // POST /api/favours/spend — spend favours (staff only)
  fastify.post<{
    Body: {
      playerId: string;
      categoryId: string;
      amount: number;
      reason?: string;
    };
  }>(
    '/api/favours/spend',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      try {
        const transaction = await spendFavours(
          fastify.db,
          request.body.playerId,
          request.body.categoryId,
          request.body.amount,
          request.body.reason ?? null,
          request.session.user!.id,
        );
        return reply.status(201).send(transaction);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Spend failed';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // POST /api/favours/remove — remove favours (staff only)
  fastify.post<{
    Body: {
      playerId: string;
      categoryId: string;
      amount: number;
      reason?: string;
    };
  }>(
    '/api/favours/remove',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      try {
        const transaction = await removeFavours(
          fastify.db,
          request.body.playerId,
          request.body.categoryId,
          request.body.amount,
          request.body.reason ?? null,
          request.session.user!.id,
        );
        return reply.status(201).send(transaction);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Removal failed';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ============================================================
  // History
  // ============================================================

  // GET /api/favours/history/:playerId — transaction history for a player
  fastify.get<{
    Params: { playerId: string };
    Querystring: { categoryId?: string; limit?: string; offset?: string };
  }>(
    '/api/favours/history/:playerId',
    { preHandler: [requireAuth] },
    async (request) => {
      return getHistory(fastify.db, request.params.playerId, {
        categoryId: request.query.categoryId,
        limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
      });
    },
  );

  // GET /api/favours/history — all transactions (staff only)
  fastify.get<{
    Querystring: { categoryId?: string; limit?: string; offset?: string };
  }>(
    '/api/favours/history',
    { preHandler: [requireAuth, requireStaff] },
    async (request) => {
      return getAllHistory(fastify.db, {
        categoryId: request.query.categoryId,
        limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
      });
    },
  );
}
