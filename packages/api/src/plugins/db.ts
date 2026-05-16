import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createDb, type Database } from '@hansard/db';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export default fp(async function dbPlugin(fastify: FastifyInstance) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const db = createDb(connectionString);
  fastify.decorate('db', db);
}, { name: 'db' });
