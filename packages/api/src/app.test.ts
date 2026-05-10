import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';

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
});
