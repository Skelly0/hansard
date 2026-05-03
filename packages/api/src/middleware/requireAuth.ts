import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { players } from '@hansard/db';
import '../types.js';

/**
 * Fastify preHandler hook: requires a valid session AND a still-existing player row.
 * Populates request.player for downstream handlers (so they don't refetch).
 *
 * If the player has been deleted between login and this request, destroys the
 * session and returns 401 (prevents FK-violation crashes in mutations).
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = request.session.user;
  if (!user) {
    return reply.status(401).send({ error: 'Authentication required' });
  }

  const fastify = request.server as FastifyInstance;
  const result = await fastify.db.select().from(players).where(eq(players.id, user.id)).limit(1);

  if (result.length === 0) {
    await request.session.destroy();
    return reply.status(401).send({ error: 'Session player no longer exists' });
  }

  request.player = result[0];
}
