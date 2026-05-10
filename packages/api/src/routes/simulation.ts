import type { FastifyInstance } from 'fastify';
import { eq, desc, and, inArray, type SQL } from 'drizzle-orm';
import { simulationClock, playerEventLog, players } from '@hansard/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import * as simService from '../services/simulationService.js';
import { PUBLIC_PLAYER_EVENT_TYPES } from '../services/playerService.js';

/**
 * Simulation routes — clock management, time advance, ailments, death.
 */
export default async function simulationRoutes(fastify: FastifyInstance) {
  // ============================================================
  // GET /api/simulation/clock — current sim state
  // ============================================================
  fastify.get(
    '/api/simulation/clock',
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const clock = await simService.getClock(fastify.db);
      if (!clock) {
        return reply.status(404).send({ error: 'No simulation clock configured' });
      }
      return clock;
    },
  );

  // ============================================================
  // POST /api/simulation/advance — advance time by N ticks
  // ============================================================
  fastify.post(
    '/api/simulation/advance',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const { ticks = 1, notes } = request.body as { ticks?: number; notes?: string };

      if (ticks < 1 || ticks > 100) {
        return reply.status(400).send({ error: 'Ticks must be between 1 and 100' });
      }

      const userId = request.session.user!.id;

      try {
        const result = await simService.advanceTime(fastify.db, ticks, userId);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to advance time';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ============================================================
  // POST /api/simulation/advance/preview — dry run
  // ============================================================
  fastify.post(
    '/api/simulation/advance/preview',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const { ticks = 1 } = request.body as { ticks?: number };

      if (ticks < 1 || ticks > 100) {
        return reply.status(400).send({ error: 'Ticks must be between 1 and 100' });
      }

      try {
        const result = await simService.previewAdvance(fastify.db, ticks);
        return { preview: true, ...result };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to preview advance';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ============================================================
  // GET /api/simulation/history — time advance log
  // ============================================================
  fastify.get(
    '/api/simulation/history',
    { preHandler: [requireAuth] },
    async (request) => {
      const { limit = 20 } = request.query as { limit?: number };
      return simService.getHistory(fastify.db, Math.min(limit, 100), {
        isStaff: !!request.player?.isStaff,
      });
    },
  );

  // ============================================================
  // PATCH /api/simulation/clock — update clock config
  // ============================================================
  fastify.patch(
    '/api/simulation/clock',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const body = request.body as {
        currentDate?: string;
        tickUnit?: string;
        seasonName?: string;
        isPaused?: boolean;
      };

      const clock = await simService.getClock(fastify.db);
      if (!clock) {
        return reply.status(404).send({ error: 'No simulation clock configured' });
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.currentDate !== undefined) updates.currentDate = body.currentDate;
      if (body.tickUnit !== undefined) updates.tickUnit = body.tickUnit;
      if (body.seasonName !== undefined) updates.seasonName = body.seasonName;
      if (body.isPaused !== undefined) updates.isPaused = body.isPaused;

      await fastify.db
        .update(simulationClock)
        .set(updates)
        .where(eq(simulationClock.id, clock.id));

      const updated = await simService.getClock(fastify.db);
      return updated;
    },
  );

  // ============================================================
  // POST /api/simulation/ailment — manually assign ailment
  // ============================================================
  fastify.post(
    '/api/simulation/ailment',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const { playerId, condition, severity } = request.body as {
        playerId: string;
        condition: string;
        severity: 'minor' | 'major' | 'critical';
      };

      if (!playerId || !condition || !severity) {
        return reply.status(400).send({ error: 'playerId, condition, and severity are required' });
      }

      if (!['minor', 'major', 'critical'].includes(severity)) {
        return reply.status(400).send({ error: 'Severity must be minor, major, or critical' });
      }

      try {
        const result = await simService.manualAilment(
          fastify.db,
          playerId,
          condition,
          severity,
          request.session.user!.id,
        );
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to assign ailment';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ============================================================
  // POST /api/simulation/death — manually kill character
  // ============================================================
  fastify.post(
    '/api/simulation/death',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const body = request.body as {
        playerId: string;
        cause?: string;
        causeOfDeath?: string;
      };
      const playerId = body.playerId;
      const cause = body.cause ?? body.causeOfDeath;

      if (!playerId || !cause) {
        return reply.status(400).send({ error: 'playerId and cause are required' });
      }

      try {
        const result = await simService.manualDeath(
          fastify.db,
          playerId,
          cause,
          request.session.user!.id,
        );
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to kill character';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ============================================================
  // GET /api/simulation/events — recent sim events from playerEventLog
  // ============================================================
  fastify.get<{ Querystring: { limit?: string; eventType?: string } }>(
    '/api/simulation/events',
    { preHandler: [requireAuth] },
    async (request) => {
      const limit = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200);
      const conditions: SQL[] = [];
      if (request.query.eventType) {
        conditions.push(eq(playerEventLog.eventType, request.query.eventType));
      }
      if (!request.player?.isStaff) {
        conditions.push(inArray(playerEventLog.eventType, PUBLIC_PLAYER_EVENT_TYPES));
      }

      const rows = await fastify.db
        .select({
          id: playerEventLog.id,
          playerId: playerEventLog.playerId,
          eventType: playerEventLog.eventType,
          description: playerEventLog.description,
          simTick: playerEventLog.simTick,
          simDate: playerEventLog.simDate,
          isAutomatic: playerEventLog.isAutomatic,
          createdAt: playerEventLog.createdAt,
          characterName: players.characterName,
          discordUsername: players.discordUsername,
        })
        .from(playerEventLog)
        .leftJoin(players, eq(playerEventLog.playerId, players.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(playerEventLog.createdAt))
        .limit(limit);
      return rows;
    },
  );

  // ============================================================
  // POST /api/simulation/heal — remove ailment
  // ============================================================
  fastify.post(
    '/api/simulation/heal',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const { playerId, condition } = request.body as {
        playerId: string;
        condition: string;
      };

      if (!playerId || !condition) {
        return reply.status(400).send({ error: 'playerId and condition are required' });
      }

      try {
        const result = await simService.heal(
          fastify.db,
          playerId,
          condition,
          request.session.user!.id,
        );
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to heal ailment';
        return reply.status(400).send({ error: message });
      }
    },
  );
}
