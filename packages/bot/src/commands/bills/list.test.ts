import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  createPaginatedEmbed: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock('../../utils/pagination.js', () => ({
  createPaginatedEmbed: mocks.createPaginatedEmbed,
}));

import command from './list.js';

describe('/bill-list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ orderBy: mocks.orderBy });
    mocks.orderBy.mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockResolvedValue([
      {
        id: 'bill-1',
        billNumber: 12,
        title: 'Roads and Bridges Act',
        status: 'submitted',
        submittedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
  });

  it('selects only the fields it renders so old bill schema columns do not break listing', async () => {
    const interaction = {
      deferReply: vi.fn(),
      options: {
        getString: vi.fn().mockReturnValue(null),
        getUser: vi.fn().mockReturnValue(null),
      },
      user: { id: 'discord-user-1' },
    };

    await command.execute(interaction as any);

    expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.anything(),
      billNumber: expect.anything(),
      title: expect.anything(),
      status: expect.anything(),
      submittedAt: expect.anything(),
    }));
    expect(mocks.createPaginatedEmbed).toHaveBeenCalled();
  });
});
