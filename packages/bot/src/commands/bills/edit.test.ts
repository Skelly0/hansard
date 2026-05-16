import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      googleDocUrl: 'https://docs.google.com/document/d/abc123/edit',
    };

    mocks.db.select
      .mockReturnValueOnce(selectRows([googleDocBill]))
      .mockReturnValueOnce(selectRows([{ id: 'player-1' }]));

    await execute(interaction as any);

    expect(mocks.db.update).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain('Only short text-only bills');
  });
});
