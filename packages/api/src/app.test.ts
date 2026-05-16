import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { DrizzleSessionStore } from './sessionStore';

describe('buildApp route registration', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it('mounts document routes in the full API app', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/hansard';
    const app = await buildApp();

    try {
      const res = await app.inject('/api/documents');
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Authentication required' });
    } finally {
      await app.close();
    }
  });

  it('mounts message export routes in the full API app', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/hansard';
    const app = await buildApp();

    try {
      const res = await app.inject('/api/messages/export');
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Authentication required' });
    } finally {
      await app.close();
    }
  });

  // Guards the frequent-logout bug: @fastify/session silently falls back to an
  // in-memory store — wiped on every API restart — when no `store` is set.
  it('wires the Postgres-backed session store, not the in-memory default', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/hansard';
    const app = await buildApp();

    try {
      let sessionStore: unknown;
      app.addHook('onRequest', async (request) => {
        sessionStore = request.sessionStore;
      });

      await app.inject('/api/health');

      expect(sessionStore).toBeInstanceOf(DrizzleSessionStore);
    } finally {
      await app.close();
    }
  });
});
