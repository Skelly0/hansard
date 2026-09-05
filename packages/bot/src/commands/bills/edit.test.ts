import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  isStaff: vi.fn(),
}));

vi.mock('../../db.js', () => ({ db: mocks.db }));

vi.mock('../../utils/permissions.js', () => ({
  isStaff: mocks.isStaff,
}));

import { execute } from './edit.js';

/** Render a drizzle WHERE expression to SQL text + bound params. */
function renderWhere(whereArg: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(whereArg as any);
}

function selectRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

function makeInteraction(field: string, value: string) {
  return {
    guild: {
      members: {
        cache: {
          get: vi.fn().mockReturnValue({ id: 'guild-member-1' }),
        },
      },
    },
    user: { id: 'discord-user-1' },
    options: {
      getString: vi.fn((name: string) => {
        if (name === 'bill') return 'B-003';
        if (name === 'field') return field;
        if (name === 'value') return value;
        return null;
      }),
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/bill edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReset();
    mocks.db.update.mockReset();
    mocks.isStaff.mockResolvedValue(false);
  });

  it('edits the cached text for a short bill', async () => {
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const interaction = makeInteraction('text', '  New short bill text.  ');
    const shortBill = {
      id: 'bill-1',
      billNumber: 3,
      title: 'Public Parks Act',
      authorId: 'player-1',
      billType: 'short',
      status: 'submitted',
      cachedContent: 'Old bill text',
    };

    mocks.db.select
      .mockReturnValueOnce(selectRows([shortBill]))
      .mockReturnValueOnce(selectRows([{ id: 'player-1' }]));
    mocks.db.update.mockReturnValue({ set });

    await execute(interaction as any);

    expect(mocks.db.update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      cachedContent: 'New short bill text.',
      cachedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    }));
  });

  it('refuses to edit text for Google Doc bills', async () => {
    const interaction = makeInteraction('text', 'New document text');
    const googleDocBill = {
      id: 'bill-2',
      billNumber: 4,
      title: 'Housing Reform Act',
      authorId: 'player-1',
      billType: 'google_doc',
      status: 'submitted',
      googleDocUrl: 'https://docs.google.com/document/d/abc123/edit',
    };

    mocks.db.select
      .mockReturnValueOnce(selectRows([googleDocBill]))
      .mockReturnValueOnce(selectRows([{ id: 'player-1' }]));

    await execute(interaction as any);

    expect(mocks.db.update).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain('Only short text-only bills');
  });


  const enactedShortBill = {
    id: 'bill-9',
    billNumber: 9,
    title: 'Harbour Dues Act',
    authorId: 'player-1',
    billType: 'short',
    status: 'enacted',
    cachedContent: 'The harbour dues are set at 2%.',
  };

  it('refuses author edits once a bill has left submission', async () => {
    const interaction = makeInteraction('text', 'The harbour dues are set at 90%.');

    mocks.db.select
      .mockReturnValueOnce(selectRows([enactedShortBill]))
      .mockReturnValueOnce(selectRows([{ id: 'player-1' }]));

    await execute(interaction as any);

    expect(mocks.db.update).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.editReply.mock.calls)).toMatch(/staff/i);
  });

  it('refuses author title edits once a bill has left submission', async () => {
    const interaction = makeInteraction('title', 'Harbour Dues (Repeal) Act');

    mocks.db.select
      .mockReturnValueOnce(selectRows([enactedShortBill]))
      .mockReturnValueOnce(selectRows([{ id: 'player-1' }]));

    await execute(interaction as any);

    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it('lets staff edit a bill after enactment', async () => {
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const interaction = makeInteraction('text', 'The harbour dues are set at 3%.');
    mocks.isStaff.mockResolvedValue(true);

    mocks.db.select
      .mockReturnValueOnce(selectRows([enactedShortBill]))
      .mockReturnValueOnce(selectRows([{ id: 'someone-else' }]));
    mocks.db.update.mockReturnValue({ set });

    await execute(interaction as any);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      cachedContent: 'The harbour dues are set at 3%.',
    }));
  });

  it('pins non-staff edits to the bill status that was checked', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const interaction = makeInteraction('summary', 'Sets harbour dues.');

    mocks.db.select
      .mockReturnValueOnce(selectRows([{ ...enactedShortBill, status: 'submitted' }]))
      .mockReturnValueOnce(selectRows([{ id: 'player-1' }]));
    mocks.db.update.mockReturnValue({ set });

    await execute(interaction as any);

    expect(where).toHaveBeenCalledTimes(1);
    const rendered = renderWhere(where.mock.calls[0][0]);
    expect(rendered.sql).toMatch(/"status"/);
    expect(rendered.params).toContain('submitted');
  });
});
