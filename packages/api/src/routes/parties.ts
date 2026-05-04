import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import {
  getParties,
  getPartyById,
  createParty,
  updateParty,
  dissolveParty,
} from '../services/partyService.js';

export default async function partyRoutes(fastify: FastifyInstance) {
  // GET /api/parties — list parties (active by default; ?includeInactive=1 for staff history)
  fastify.get<{ Querystring: { includeInactive?: string } }>(
    '/api/parties',
    { preHandler: [requireAuth] },
    async (request) => {
      const includeInactive = request.query.includeInactive === '1' || request.query.includeInactive === 'true';
      return getParties(fastify.db, { includeInactive });
    },
  );

  // GET /api/parties/:id — party detail with members
  fastify.get<{ Params: { id: string } }>(
    '/api/parties/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const party = await getPartyById(fastify.db, request.params.id);
      if (!party) return reply.status(404).send({ error: 'Party not found' });
      return party;
    },
  );

  // POST /api/parties — create party (staff)
  fastify.post<{
    Body: {
      name: string;
      shortName?: string | null;
      factionId?: string | null;
      leaderId?: string | null;
      ideology?: string | null;
      colour?: string | null;
      discordRoleId?: string | null;
    };
  }>(
    '/api/parties',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      try {
        const party = await createParty(fastify.db, request.body);
        return reply.status(201).send(party);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create party';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // PATCH /api/parties/:id — update party (staff)
  fastify.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      shortName?: string | null;
      factionId?: string | null;
      leaderId?: string | null;
      ideology?: string | null;
      colour?: string | null;
      discordRoleId?: string | null;
      isActive?: boolean;
    };
  }>(
    '/api/parties/:id',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      try {
        const party = await updateParty(fastify.db, request.params.id, request.body);
        if (!party) return reply.status(404).send({ error: 'Party not found' });
        return party;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update party';
        return reply.status(400).send({ error: message });
      }
    },
  );

  // DELETE /api/parties/:id — soft-delete (dissolve) party (staff)
  fastify.delete<{ Params: { id: string } }>(
    '/api/parties/:id',
    { preHandler: [requireAuth, requireStaff] },
    async (request, reply) => {
      const result = await dissolveParty(
        fastify.db,
        request.params.id,
        request.session.user?.id ?? null,
      );
      if (!result) return reply.status(404).send({ error: 'Party not found' });
      return result;
    },
  );
}
