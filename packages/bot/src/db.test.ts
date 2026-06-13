import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/hansard';

const mocks = vi.hoisted(() => ({
  closeDb: vi.fn(),
  createDb: vi.fn(),
  db: {},
  postgres: vi.fn(),
  rawSql: { end: vi.fn() },
}));

vi.mock('@hansard/db', () => ({
  closeDb: mocks.closeDb,
  createDb: mocks.createDb,
}));

vi.mock('postgres', () => ({
  default: mocks.postgres,
}));

mocks.createDb.mockReturnValue(mocks.db);
mocks.postgres.mockReturnValue(mocks.rawSql);

const dbModule = await import('./db.js');

describe('bot database handles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.closeDb.mockResolvedValue(undefined);
    mocks.rawSql.end.mockResolvedValue(undefined);
  });

  it('closes the Drizzle and raw Postgres pools on shutdown', async () => {
    await dbModule.shutdownDatabase();

    expect(mocks.closeDb).toHaveBeenCalledWith(dbModule.db);
    expect(mocks.rawSql.end).toHaveBeenCalledWith({ timeout: 5 });
  });
});
