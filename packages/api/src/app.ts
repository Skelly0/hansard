import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';

import './types.js';
import corsPlugin from './plugins/cors.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import dbPlugin from './plugins/db.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import playerRoutes from './routes/players.js';
import simulationRoutes from './routes/simulation.js';
import officeRoutes from './routes/offices.js';
import partyRoutes from './routes/parties.js';
import favourRoutes from './routes/favours.js';
import ticketRoutes from './routes/tickets.js';
import moderationRoutes from './routes/moderation.js';
import votingRoutes from './routes/voting.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  // --- Plugins ---

  // CORS
  await fastify.register(corsPlugin);

  // Rate limiting
  await fastify.register(rateLimitPlugin);

  // Cookie (required before session)
  await fastify.register(cookie);

  // Session
  await fastify.register(session, {
    secret: process.env.SESSION_SECRET || 'hansard-dev-secret-change-me-in-production',
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    saveUninitialized: false,
  });

  // Database
  await fastify.register(dbPlugin);

  // --- Health check ---
  fastify.get('/api/health', async () => ({
    status: 'ok',
    name: process.env.BOT_DISPLAY_NAME || 'Hansard',
  }));

  // --- Routes ---
  await fastify.register(authRoutes);
  await fastify.register(dashboardRoutes);
  await fastify.register(playerRoutes);
  await fastify.register(simulationRoutes);
  await fastify.register(officeRoutes);
  await fastify.register(partyRoutes);
  await fastify.register(favourRoutes);
  await fastify.register(ticketRoutes);
  await fastify.register(moderationRoutes);
  await fastify.register(votingRoutes);

  return fastify;
}
