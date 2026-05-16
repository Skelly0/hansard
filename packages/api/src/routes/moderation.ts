import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import * as modService from '../services/modService.js';
import type { ModActionType, AppealStatus } from '@hansard/shared';

/**
 * Moderation routes — all staff-only.
 */
export default async function moderationRoutes(fastify: FastifyInstance) {
  // GET /api/moderation/players/:id — mod history for player
  fastify.get<{ Params: { id: string } }>(
    '/api/moderation/players/:id',
    { preHandler: [requireAuth, requireStaff] },
    async (request) => {
      const { id } = request.params;
      const history = await modService.getPlayerModHistory(fastify.db, id);
      return history;
    },
  );

  // POST /api/moderation/actions — create mod action
  fastify.post<{
    Body: {
      targetPlayerId: string;
      type: ModActionType;
      reason: string;
      internalNotes?: string;
      expiresAt?: string;
      ticketId?: string;
    };
  }>(
    '/api/moderation/actions',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const { targetPlayerId, type, reason, internalNotes, expiresAt, ticketId } = request.body;

      if (!targetPlayerId || !type || !reason) {
        return reply.status(400).send({ error: 'targetPlayerId, type, and reason are required' });
      }

      const moderatorId = request.session.user!.id;

      const action = await modService.createAction(fastify.db, {
        targetPlayerId,
        moderatorId,
        type,
        reason,
        internalNotes,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        ticketId,
      });

      return reply.status(201).send(action);
    },
  );

  // PATCH /api/moderation/actions/:id — update (expire, appeal)
  fastify.patch<{
    Params: { id: string };
    Body: {
      isActive?: boolean;
      expiresAt?: string | null;
      appealStatus?: AppealStatus;
      appealReason?: string;
      internalNotes?: string;
    };
  }>(
    '/api/moderation/actions/:id',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const { id } = request.params;
      const { isActive, expiresAt, appealStatus, appealReason, internalNotes } = request.body;

      const reviewerId = request.session.user!.id;

      const updated = await modService.updateAction(fastify.db, id, {
        isActive,
        expiresAt: expiresAt === null ? null : expiresAt ? new Date(expiresAt) : undefined,
        appealStatus,
        appealReason,
        appealReviewedById: appealStatus ? reviewerId : undefined,
        internalNotes,
      });

      if (!updated) {
        return reply.status(404).send({ error: 'Mod action not found' });
      }

      return updated;
    },
  );

  // POST /api/moderation/notes — add note
  fastify.post<{
    Body: {
      targetPlayerId: string;
      content: string;
    };
  }>(
    '/api/moderation/notes',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const { targetPlayerId, content } = request.body;

      if (!targetPlayerId || !content) {
        return reply.status(400).send({ error: 'targetPlayerId and content are required' });
      }

      const authorId = request.session.user!.id;

      const note = await modService.addNote(fastify.db, {
        targetPlayerId,
        authorId,
        content,
      });

      return reply.status(201).send(note);
    },
  );

  // GET /api/moderation/actions — list all (filterable)
  fastify.get<{
    Querystring: {
      type?: ModActionType;
      isActive?: string;
      targetPlayerId?: string;
      moderatorId?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/moderation/actions',
    { preHandler: [requireAuth, requireStaff] },
    async (request) => {
      const { type, isActive, targetPlayerId, moderatorId, limit, offset } = request.query;

      const filters = {
        type,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        targetPlayerId,
        moderatorId,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      };

      const [actions, total] = await Promise.all([
        modService.listActions(fastify.db, filters),
        modService.countActions(fastify.db, filters),
      ]);

      return { data: actions, total };
    },
  );

  // GET /api/moderation/stats — activity stats
  fastify.get(
    '/api/moderation/stats',
    { preHandler: [requireAuth, requireStaff] },
    async () => {
      return modService.getStats(fastify.db);
    },
  );
}
