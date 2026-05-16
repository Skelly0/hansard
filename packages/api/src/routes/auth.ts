import type { FastifyInstance } from 'fastify';
import authPlugin from '../plugins/auth.js';

/**
 * Auth routes plugin — registers the Discord OAuth2 flow routes.
 */
export default async function authRoutes(fastify: FastifyInstance) {
  await fastify.register(authPlugin);
}
