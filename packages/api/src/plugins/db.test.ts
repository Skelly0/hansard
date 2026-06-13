import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closeDb: vi.fn(),
  createDb: vi.fn(),
  db: {},
}));

vi.mock('@hansard/db', () => ({
  closeDb: mocks.closeDb,
  createDb: mocks.createDb,
}));

const { default: Fastify } = await import('fastify');
const { default: dbPlugin } = await import('./db.js');

describe('dbPlugin', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/hansard';
    mocks.createDb.mockReturnValue(mocks.db);
    mocks.closeDb.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it('closes the Postgres pool when the Fastify app closes', async () => {
    const app = Fastify();
    await app.register(dbPlugin);

    await app.close();

    expect(mocks.closeDb).toHaveBeenCalledWith(mocks.db);
  });
});
