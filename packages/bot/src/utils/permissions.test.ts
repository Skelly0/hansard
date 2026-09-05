import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock('../db.js', () => ({ db: { select: mocks.select } }));

import { hasPermission } from './permissions.js';

function selectLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function selectJoin(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({ where })),
    })),
    _where: where,
  };
}

/** Render a drizzle WHERE expression to SQL text + bound params. */
function renderWhere(whereArg: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(whereArg as any);
}

// A non-staff API member: no GuildMember instance, no role ids.
const playerMember = { user: { id: 'discord-player' }, roles: [] as string[] };

describe('hasPermission', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('grants a permission held through an active office', async () => {
    const join = selectJoin([{ permissions: ['legislative_leader'] }]);
    mocks.select
      .mockReturnValueOnce(selectLimit([{ isStaff: false }]))
      .mockReturnValueOnce(selectLimit([{ id: 'player-1' }]))
      .mockReturnValueOnce(join);

    await expect(hasPermission(playerMember as any, 'legislative_leader')).resolves.toBe(true);
  });

  it('only honours holdings in offices that are still active', async () => {
    // Mirrors the API's aggregatePermissionsForPlayer regression guard: the
    // office join must filter on offices.is_active, not just an open term.
    const join = selectJoin([]);
    mocks.select
      .mockReturnValueOnce(selectLimit([{ isStaff: false }]))
      .mockReturnValueOnce(selectLimit([{ id: 'player-1' }]))
      .mockReturnValueOnce(join);

    await hasPermission(playerMember as any, 'legislative_leader');

    expect(join._where).toHaveBeenCalledTimes(1);
    const rendered = renderWhere(join._where.mock.calls[0][0]);
    expect(rendered.sql).toMatch(/"is_active"/);
    expect(rendered.params).toContain(true);
  });
});
