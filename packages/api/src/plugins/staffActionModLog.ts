import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { postApiStaffActionLog } from '../services/modLogService.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXCLUDED_PREFIXES = [
  '/api/auth',
  '/api/health',
];

export default fp(async function staffActionModLogPlugin(fastify: FastifyInstance) {
  fastify.addHook('onResponse', async (request, reply) => {
    if (!shouldLogStaffAction(request, reply)) return;

    try {
      await postApiStaffActionLog({
        actor: request.player,
        method: request.method,
        path: routePath(request),
        statusCode: reply.statusCode,
        payload: request.body,
      });
    } catch (err) {
      request.log.warn({ err }, 'Failed to post API staff action to mod log');
    }
  });
}, { name: 'staff-action-mod-log' });

function shouldLogStaffAction(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return false;
  if (reply.statusCode >= 400) return false;

  const path = routePath(request);
  if (!path.startsWith('/api/')) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;

  return request.staffActionLog === true;
}

function routePath(request: FastifyRequest): string {
  return request.url.split('?')[0] || request.url;
}
