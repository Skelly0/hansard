import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';

import './types.js';
import { DrizzleSessionStore } from './sessionStore.js';
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
import billRoutes from './routes/bills.js';
import documentRoutes from './routes/documents.js';
import messageExportRoutes from './routes/messageExports.js';

const DEV_SESSION_SECRET = 'hansard-dev-secret-change-me-in-production';

function checkProductionEnv(log: { warn: (msg: string) => void }) {
  if (process.env.NODE_ENV !== 'production') return;

  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (!sessionSecret) {
    throw new Error('[startup] SESSION_SECRET must be set in production');
  }
  if (sessionSecret === DEV_SESSION_SECRET) {
    throw new Error('[startup] SESSION_SECRET must not use the dev default in production');
  }

  const required = [
    'CORS_ORIGIN',
    'DISCORD_REDIRECT_URI',
    'FRONTEND_URL',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
  ];
  for (const key of required) {
    if (!process.env[key]) log.warn(`[startup] ${key} not set — production auth will misbehave`);
  }
}

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
    // Required behind a TLS-terminating proxy (Railway): without this,
    // request.protocol stays 'http' and @fastify/session refuses to set
    // a `secure: true` cookie, breaking login on cross-site deployments.
    trustProxy: true,
  });

  checkProductionEnv(fastify.log);

  const isProd = process.env.NODE_ENV === 'production';

  // --- Plugins ---

  // CORS
  await fastify.register(corsPlugin);

  // Rate limiting
  await fastify.register(rateLimitPlugin);

  // Cookie (required before session)
  await fastify.register(cookie);

  // Database — registered before the session plugin so the Postgres-backed
  // session store can read/write through `fastify.db`.
  await fastify.register(dbPlugin);

  // Session — uses a Postgres-backed store so sessions survive API
  // restarts/redeploys. The default in-memory store drops every session
  // whenever the process recycles (frequent on Railway), which logged web
  // users out every few minutes.
  // Web is served same-origin in production via an nginx reverse proxy
  // (packages/web/nginx.conf.template). Same-origin lets us keep
  // sameSite: 'lax' everywhere — stricter than the previous cross-site
  // 'none' + Brave-defaults problem that bounced users back to /login.
  await fastify.register(session, {
    secret: process.env.SESSION_SECRET || DEV_SESSION_SECRET,
    store: new DrizzleSessionStore(fastify.db),
    cookie: {
      secure: isProd,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    saveUninitialized: false,
  });

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
  await fastify.register(billRoutes);
  await fastify.register(documentRoutes);
  await fastify.register(messageExportRoutes);

  return fastify;
}
