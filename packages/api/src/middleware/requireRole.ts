import type { FastifyRequest, FastifyReply, FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { aggregatePermissionsForPlayer } from '../services/playerService.js';
import '../types.js';

/**
 * Factory that returns a Fastify preHandler hook checking whether
 * the session user holds an office with the given permission.
 *
 * Re-aggregates permissions live from the DB on each request so a
 * permission revocation takes effect immediately, even if the session
 * still carries the stale `permissions` array from login time.
 */
export function requireRole(permission: string): preHandlerAsyncHookHandler {
  return async function checkRole(request: FastifyRequest, reply: FastifyReply) {
    const user = request.session.user;

    if (!user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    if (user.isStaff) return;

    const fastify = request.server as FastifyInstance;
    const livePermissions = await aggregatePermissionsForPlayer(fastify.db, user.id);

    if (!livePermissions.includes(permission)) {
      return reply.status(403).send({
        error: 'Insufficient permissions',
        required: permission,
      });
    }
  };
}
