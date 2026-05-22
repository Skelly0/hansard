import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  listOffices,
  getOffice,
  createOffice,
  updateOffice,
  appointToOffice,
  removeFromOffice,
} from '../services/officeService.js';

function withoutPermissionStrings<T extends { permissions?: unknown }>(office: T): Omit<T, 'permissions'> {
  const { permissions: _permissions, ...publicOffice } = office;
  return publicOffice;
}

/**
 * Office routes plugin — office management and appointments.
 */
export default async function officeRoutes(fastify: FastifyInstance) {
  // GET /api/offices — list all offices with current holders
  fastify.get(
    '/api/offices',
    { preHandler: [requireAuth] },
    async (request) => {
      const offices = await listOffices(fastify.db);
      if (request.player?.isStaff) return offices;
      return offices.map(withoutPermissionStrings);
    },
  );

  // GET /api/offices/:id — office details + full holder history
  fastify.get<{ Params: { id: string } }>(
    '/api/offices/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const office = await getOffice(fastify.db, request.params.id);
      if (!office) {
        return reply.status(404).send({ error: 'Office not found' });
      }
      if (!request.player?.isStaff) {
        return withoutPermissionStrings(office);
      }
      return office;
    },
  );

  // POST /api/offices — create office (staff only)
  fastify.post<{
    Body: {
      name: string;
      tier: string;
      factionId?: string;
      maxHolders?: number;
      permissions?: string[];
      filledBy?: string;
      appointableBy?: string;
      requiresConfirmation?: boolean;
      discordRoleId?: string;
      sortOrder?: number;
    };
  }>(
    '/api/offices',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const office = await createOffice(fastify.db, request.body);
      return reply.status(201).send(office);
    },
  );

  // PATCH /api/offices/:id — update office config (staff only)
  fastify.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      tier?: string;
      factionId?: string | null;
      maxHolders?: number;
      permissions?: string[];
      filledBy?: string;
      appointableBy?: string | null;
      requiresConfirmation?: boolean;
      discordRoleId?: string | null;
      isActive?: boolean;
      sortOrder?: number;
    };
  }>(
    '/api/offices/:id',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const office = await updateOffice(fastify.db, request.params.id, request.body);
      if (!office) {
        return reply.status(404).send({ error: 'Office not found' });
      }
      return office;
    },
  );

  // POST /api/offices/:id/appoint — appoint player (requires appoint_ministers permission)
  fastify.post<{
    Params: { id: string };
    Body: {
      playerId: string;
    };
  }>(
    '/api/offices/:id/appoint',
    { preHandler: [requireAuth, requireRole('appoint_ministers')] },
    async (request, reply) => {
      request.staffActionLog = true;
      try {
        const result = await appointToOffice(
          fastify.db,
          request.params.id,
          request.body.playerId,
          request.session.user!.id,
        );
        return reply.status(201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Appointment failed';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // POST /api/offices/:id/remove — remove holder (requires appoint_ministers permission)
  fastify.post<{
    Params: { id: string };
    Body: {
      reason?: string;
    };
  }>(
    '/api/offices/:id/remove',
    { preHandler: [requireAuth, requireRole('appoint_ministers')] },
    async (request, reply) => {
      request.staffActionLog = true;
      try {
        const result = await removeFromOffice(
          fastify.db,
          request.params.id,
          request.session.user!.id,
          request.body.reason,
        );
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Removal failed';
        return reply.status(400).send({ error: message });
      }
    },
  );
}
