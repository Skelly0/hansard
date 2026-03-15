import type { FastifyRequest, FastifyReply } from 'fastify';
import '../types.js';

/**
 * Fastify preHandler hook that requires a valid session with a user.
 * Returns 401 if not authenticated.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = request.session.user;
  if (!user) {
    return reply.status(401).send({ error: 'Authentication required' });
  }
}
