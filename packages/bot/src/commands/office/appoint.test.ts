import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  isStaff: vi.fn(),
}));

vi.mock('../../db.js', () => ({ db: { select: mocks.select } }));
vi.mock('../../utils/permissions.js', () => ({ isStaff: mocks.isStaff }));
vi.mock('../../utils/modLog.js', () => ({ postStaffActionLog: vi.fn() }));
vi.mock('./_officeAutocomplete.js', () => ({ autocompleteOffice: vi.fn() }));

import { execute } from './appoint.js';

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

describe('/office appoint permission lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isStaff.mockResolvedValue(false);
  });

  it('only honours appoint_ministers held through an active office', async () => {
    const join = selectJoin([]);
    mocks.select
      .mockReturnValueOnce(selectLimit([{ id: 'player-1' }]))
      .mockReturnValueOnce(join);

    const interaction = {
      user: { id: 'discord-player' },
      member: { user: { id: 'discord-player' }, roles: [] },
      options: { getString: vi.fn().mockReturnValue('Chancellor') },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await execute(interaction as any);

    expect(join._where).toHaveBeenCalledTimes(1);
    const rendered = renderWhere(join._where.mock.calls[0][0]);
    expect(rendered.sql).toMatch(/"is_active"/);
    expect(rendered.params).toContain(true);
    expect(JSON.stringify(interaction.editReply.mock.calls)).toMatch(/appoint_ministers/);
  });
});
