import type { FastifyRequest, FastifyReply } from 'fastify';
import '../types.js';

/**
 * Fastify preHandler hook that requires the session user to have isStaff: true.
 * Returns 403 if the user is not staff. Assumes requireAuth has already run.
 */
export async function requireStaff(request: FastifyRequest, reply: FastifyReply) {
  const user = request.session.user;
  if (!user?.isStaff) {
    return reply.status(403).send({ error: 'Staff access required' });
  }
}
