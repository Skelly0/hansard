import type { FastifyRequest, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import '../types.js';

/**
 * Factory that returns a Fastify preHandler hook checking whether
 * the session user holds an office with the given permission.
 *
 * The permission check is currently stubbed — it checks against
 * the `permissions` array stored on the session user. A future
 * implementation will look this up from the DB.
 */
export function requireRole(permission: string): preHandlerAsyncHookHandler {
  return async function checkRole(request: FastifyRequest, reply: FastifyReply) {
    const user = request.session.user;

    if (!user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    // Stub: check the permissions array on the session user.
    // TODO: Replace with DB lookup — query offices held by user,
    // aggregate their permissions, check if `permission` is included.
    const hasPermission = user.permissions?.includes(permission) ?? false;

    if (!hasPermission) {
      return reply.status(403).send({
        error: 'Insufficient permissions',
        required: permission,
      });
    }
  };
}
